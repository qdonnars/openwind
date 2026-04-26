from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from openwind_data.adapters.base import (
    ForecastBundle,
    SeaPoint,
    SeaSeries,
    WindPoint,
    WindSeries,
)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"

DEFAULT_MODEL = "meteofrance_arome_france"

# Ordered fallback when caller passes model="auto": from highest-resolution /
# shortest-horizon to lowest / longest. AROME captures Med thermals at 1.3 km
# but only ~48 h; ICON-EU covers ~5 d; GFS covers ~16 d.
AUTO_MODEL = "auto"
AUTO_FALLBACK_CHAIN: tuple[str, ...] = (
    "meteofrance_arome_france",
    "icon_eu",
    "gfs_seamless",
)

_WIND_VARS = "wind_speed_10m,wind_direction_10m,wind_gusts_10m"
_MARINE_VARS = "wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height"

CACHE_TTL = timedelta(minutes=30)
# Lat/lon rounding for cache key — 2dp ≈ 1.1 km, matches AROME native grid (~1.3 km).
# Two waypoints in the same AROME cell share a cache entry.
GRID_DECIMALS = 2
# When fetching uncached, prefetch this many days from the start so that subsequent
# calls with later `departure` windows in the same forecast issue still hit cache.
FETCH_HORIZON_DAYS = 7


@dataclass(frozen=True, slots=True)
class _CacheKey:
    lat_round: float
    lon_round: float
    models: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _CacheEntry:
    fetched_at: datetime
    fetch_start: datetime
    fetch_end: datetime
    bundle: ForecastBundle


class OpenMeteoAdapter:
    """Fetches wind (multi-model) and sea state from Open-Meteo's keyless APIs.

    All inputs and outputs are in UTC. Caller is responsible for any local-timezone
    rendering downstream.

    Cache: 30 min in-memory keyed on rounded lat/lon (2 decimals, ~1.1 km, matches
    AROME native grid) and the sorted set of models. The cache stores the widest
    [start, end] ever requested for a given key and slices on read; subsequent
    requests that fall inside a cached window are served without an HTTP call,
    even if the requested time window differs from the original.

    Default model is AROME (Mediterranean focus, high-resolution capture of thermal
    and local winds).
    """

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        *,
        timeout: float = 10.0,
    ) -> None:
        self._client = client
        self._timeout = timeout
        self._cache: dict[_CacheKey, _CacheEntry] = {}

    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle:
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("start and end must be timezone-aware datetimes")
        start_utc = start.astimezone(UTC)
        end_utc = end.astimezone(UTC)
        if end_utc <= start_utc:
            raise ValueError("end must be strictly after start")

        models = models or [DEFAULT_MODEL]
        key = _CacheKey(
            lat_round=round(lat, GRID_DECIMALS),
            lon_round=round(lon, GRID_DECIMALS),
            models=tuple(sorted(models)),
        )
        now = datetime.now(UTC)
        cached = self._cache.get(key)
        if (
            cached is not None
            and (now - cached.fetched_at) < CACHE_TTL
            and cached.fetch_start <= start_utc
            and cached.fetch_end >= end_utc
        ):
            return _slice_bundle(cached.bundle, start_utc, end_utc, now)

        # Fetch a wide window so future calls with later `departure` can be served
        # from cache. If a stale-but-narrower entry exists, widen to cover both.
        fetch_start = start_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        fetch_end = max(end_utc, start_utc + timedelta(days=FETCH_HORIZON_DAYS))
        if cached is not None:
            fetch_start = min(fetch_start, cached.fetch_start)
            fetch_end = max(fetch_end, cached.fetch_end)

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            wind_tasks = [
                self._fetch_wind(client, lat, lon, fetch_start, fetch_end, m) for m in models
            ]
            sea_task = self._fetch_sea(client, lat, lon, fetch_start, fetch_end)
            results = await asyncio.gather(*wind_tasks, sea_task)
        finally:
            if owns_client:
                await client.aclose()

        wind_series_list: list[WindSeries] = list(results[:-1])
        sea_series: SeaSeries = results[-1]
        full_bundle = ForecastBundle(
            lat=lat,
            lon=lon,
            start=fetch_start,
            end=fetch_end,
            wind_by_model={w.model: w for w in wind_series_list},
            sea=sea_series,
            requested_at=now,
        )
        self._cache[key] = _CacheEntry(
            fetched_at=now,
            fetch_start=fetch_start,
            fetch_end=fetch_end,
            bundle=full_bundle,
        )
        return _slice_bundle(full_bundle, start_utc, end_utc, now)

    async def _fetch_wind(
        self,
        client: httpx.AsyncClient,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        model: str,
    ) -> WindSeries:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": _WIND_VARS,
            "wind_speed_unit": "kn",
            "models": model,
            "timezone": "UTC",
            "start_date": start.date().isoformat(),
            "end_date": end.date().isoformat(),
        }
        resp = await client.get(FORECAST_URL, params=params)
        resp.raise_for_status()
        return _parse_wind(resp.json(), model, start, end)

    async def _fetch_sea(
        self,
        client: httpx.AsyncClient,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
    ) -> SeaSeries:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": _MARINE_VARS,
            "timezone": "UTC",
            "start_date": start.date().isoformat(),
            "end_date": end.date().isoformat(),
        }
        resp = await client.get(MARINE_URL, params=params)
        resp.raise_for_status()
        return _parse_sea(resp.json(), start, end)


def _slice_bundle(
    bundle: ForecastBundle, start: datetime, end: datetime, requested_at: datetime
) -> ForecastBundle:
    """Return a view of ``bundle`` restricted to [start, end]."""
    sliced_winds = {
        model: WindSeries(
            model=series.model,
            points=tuple(p for p in series.points if start <= p.time <= end),
        )
        for model, series in bundle.wind_by_model.items()
    }
    sliced_sea = SeaSeries(points=tuple(p for p in bundle.sea.points if start <= p.time <= end))
    return ForecastBundle(
        lat=bundle.lat,
        lon=bundle.lon,
        start=start,
        end=end,
        wind_by_model=sliced_winds,
        sea=sliced_sea,
        requested_at=requested_at,
    )


def _parse_wind(data: dict[str, Any], model: str, start: datetime, end: datetime) -> WindSeries:
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    speeds = hourly.get("wind_speed_10m") or []
    dirs = hourly.get("wind_direction_10m") or []
    gusts = hourly.get("wind_gusts_10m") or []
    points: list[WindPoint] = []
    for t, s, d, g in zip(times, speeds, dirs, gusts, strict=True):
        ts = _parse_iso_utc(t)
        if not (start <= ts <= end):
            continue
        if s is None or d is None:
            continue
        points.append(
            WindPoint(
                time=ts,
                speed_kn=float(s),
                direction_deg=float(d),
                gust_kn=_opt_float(g),
            )
        )
    return WindSeries(model=model, points=tuple(points))


def _parse_sea(data: dict[str, Any], start: datetime, end: datetime) -> SeaSeries:
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    h = hourly.get("wave_height") or []
    p = hourly.get("wave_period") or []
    d = hourly.get("wave_direction") or []
    wwh = hourly.get("wind_wave_height") or []
    swh = hourly.get("swell_wave_height") or []
    points: list[SeaPoint] = []
    for t, h_, p_, d_, wwh_, swh_ in zip(times, h, p, d, wwh, swh, strict=True):
        ts = _parse_iso_utc(t)
        if not (start <= ts <= end):
            continue
        points.append(
            SeaPoint(
                time=ts,
                wave_height_m=_opt_float(h_),
                wave_period_s=_opt_float(p_),
                wave_direction_deg=_opt_float(d_),
                wind_wave_height_m=_opt_float(wwh_),
                swell_wave_height_m=_opt_float(swh_),
            )
        )
    return SeaSeries(points=tuple(points))


def _parse_iso_utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    return float(v)
