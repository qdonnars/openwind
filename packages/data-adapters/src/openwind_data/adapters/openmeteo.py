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

_WIND_VARS = "wind_speed_10m,wind_direction_10m,wind_gusts_10m"
_MARINE_VARS = "wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height"

CACHE_TTL = timedelta(minutes=30)


@dataclass(frozen=True, slots=True)
class _CacheKey:
    lat_round: float
    lon_round: float
    start: datetime
    end: datetime
    models: tuple[str, ...]


class OpenMeteoAdapter:
    """Fetches wind (multi-model) and sea state from Open-Meteo's keyless APIs.

    All inputs and outputs are in UTC. Caller is responsible for any local-timezone
    rendering downstream.

    Cache: 30 min in-memory keyed on rounded lat/lon (4 decimals), the time range,
    and the sorted set of models requested. Default model is AROME (per the
    Mediterranean focus and high resolution capture of thermal/local winds).
    """

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        *,
        timeout: float = 10.0,
    ) -> None:
        self._client = client
        self._timeout = timeout
        self._cache: dict[_CacheKey, tuple[datetime, ForecastBundle]] = {}

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
            lat_round=round(lat, 4),
            lon_round=round(lon, 4),
            start=start_utc,
            end=end_utc,
            models=tuple(sorted(models)),
        )
        now = datetime.now(UTC)
        cached = self._cache.get(key)
        if cached is not None and (now - cached[0]) < CACHE_TTL:
            return cached[1]

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            wind_tasks = [self._fetch_wind(client, lat, lon, start_utc, end_utc, m) for m in models]
            sea_task = self._fetch_sea(client, lat, lon, start_utc, end_utc)
            results = await asyncio.gather(*wind_tasks, sea_task)
        finally:
            if owns_client:
                await client.aclose()

        wind_series_list: list[WindSeries] = list(results[:-1])
        sea_series: SeaSeries = results[-1]
        bundle = ForecastBundle(
            lat=lat,
            lon=lon,
            start=start_utc,
            end=end_utc,
            wind_by_model={w.model: w for w in wind_series_list},
            sea=sea_series,
            requested_at=now,
        )
        self._cache[key] = (now, bundle)
        return bundle

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
