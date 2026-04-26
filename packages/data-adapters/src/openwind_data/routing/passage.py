"""Passage time + complexity estimation along a polyline of waypoints.

V1 design choices:

- **Single-pass approximation** (challenge #7): we do not iterate until convergence
  on segment timings. We first lay out per-segment mid-times using a constant
  heuristic speed (6 kn), fetch wind at each mid-time/mid-position, then compute
  the actual speed and accumulate true durations. The bias is bounded for typical
  Mediterranean passages because the wind window we hit is shifted by at most a
  few hours, which is well within the temporal correlation length of the forecast.
- **Efficiency factor 0.75** (challenge #8): polars are ORC theoretical maxima.
  Real-world cruising (sail trim, comfort margins, sea state, helmsman, currents)
  costs ~25%. See `docs/boat-archetypes.md`. Override via the `efficiency` arg.
- **Wind only** (no wave-driven slow-down in V1). Sea state feeds `warnings`,
  not `boat_speed`.
- **No tack handling**: TWA in [0, 180] only; polars are symmetric.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from openwind_data.adapters.base import MarineDataAdapter, WindPoint
from openwind_data.adapters.openmeteo import DEFAULT_MODEL, OpenMeteoAdapter
from openwind_data.routing.archetypes import get_polar, lookup_polar
from openwind_data.routing.geometry import (
    Point,
    midpoint,
    normalize_twa,
    segment_route,
)

HEURISTIC_SPEED_KN = 6.0
WIND_FETCH_WINDOW = timedelta(hours=3)
MIN_BOAT_SPEED_KN = 0.5  # floor to avoid division blow-up in extreme stalls

STRONG_WIND_THRESHOLD_KN = 25.0
LIGHT_WIND_THRESHOLD_KN = 4.0


@dataclass(frozen=True, slots=True)
class SegmentReport:
    start: Point
    end: Point
    distance_nm: float
    bearing_deg: float
    start_time: datetime
    end_time: datetime
    tws_kn: float
    twd_deg: float
    twa_deg: float
    polar_speed_kn: float
    boat_speed_kn: float
    duration_h: float


@dataclass(frozen=True, slots=True)
class PassageReport:
    archetype: str
    departure_time: datetime
    arrival_time: datetime
    duration_h: float
    distance_nm: float
    efficiency: float
    model: str
    segments: tuple[SegmentReport, ...]
    warnings: tuple[str, ...] = field(default_factory=tuple)


def _closest_wind_point(points: tuple[WindPoint, ...], target: datetime) -> WindPoint:
    if not points:
        raise ValueError("no wind data points returned for segment")
    return min(points, key=lambda p: abs((p.time - target).total_seconds()))


async def estimate_passage(
    waypoints: list[Point],
    departure_time: datetime,
    boat_archetype: str,
    *,
    efficiency: float = 0.75,
    segment_length_nm: float = 5.0,
    adapter: MarineDataAdapter | None = None,
    model: str = DEFAULT_MODEL,
    heuristic_speed_kn: float = HEURISTIC_SPEED_KN,
) -> PassageReport:
    """Estimate a passage's per-segment timing, speed, and warnings.

    Args:
        waypoints: ordered list of route waypoints (>=2 points).
        departure_time: timezone-aware datetime; converted to UTC internally.
        boat_archetype: one of the registry names (see `list_archetypes()`).
        efficiency: multiplier on polar speeds; default 0.75 (cruising).
        segment_length_nm: target sub-segment length in NM.
        adapter: any `MarineDataAdapter` (defaults to a fresh `OpenMeteoAdapter`).
        model: wind model name as understood by the adapter.
        heuristic_speed_kn: speed used for the single-pass timing estimate.
    """
    if departure_time.tzinfo is None:
        raise ValueError("departure_time must be timezone-aware")
    if not 0.0 < efficiency <= 1.0:
        raise ValueError("efficiency must be in (0, 1]")

    polar = get_polar(boat_archetype)
    segments = segment_route(waypoints, segment_length_nm)
    departure_utc = departure_time.astimezone(UTC)

    heuristic_speed_kn = max(heuristic_speed_kn, MIN_BOAT_SPEED_KN)
    seg_mid_times: list[datetime] = []
    cumulative = timedelta(0)
    for seg in segments:
        seg_h = seg.distance_nm / heuristic_speed_kn
        seg_mid_times.append(departure_utc + cumulative + timedelta(hours=seg_h / 2))
        cumulative += timedelta(hours=seg_h)

    seg_mid_points = [midpoint(s.start, s.end) for s in segments]

    own_adapter = adapter is None
    fetch_adapter: MarineDataAdapter = adapter or OpenMeteoAdapter()
    try:
        bundles = await asyncio.gather(
            *[
                fetch_adapter.fetch(
                    pt.lat,
                    pt.lon,
                    mid - WIND_FETCH_WINDOW / 2,
                    mid + WIND_FETCH_WINDOW / 2,
                    models=[model],
                )
                for pt, mid in zip(seg_mid_points, seg_mid_times, strict=True)
            ]
        )
    finally:
        if own_adapter and hasattr(fetch_adapter, "aclose"):
            await fetch_adapter.aclose()  # pragma: no cover

    reports: list[SegmentReport] = []
    cumulative_actual = timedelta(0)
    max_tws = 0.0
    min_boat_speed = float("inf")
    for seg, mid_time, mid_pt, bundle in zip(
        segments, seg_mid_times, seg_mid_points, bundles, strict=True
    ):
        wind_series = bundle.wind_by_model.get(model)
        if wind_series is None:
            raise RuntimeError(
                f"adapter returned no wind series for model {model!r} at "
                f"({mid_pt.lat:.4f}, {mid_pt.lon:.4f})"
            )
        wp = _closest_wind_point(wind_series.points, mid_time)
        twa = normalize_twa(twd=wp.direction_deg, course=seg.bearing_deg)
        polar_speed = lookup_polar(polar, wp.speed_kn, twa)
        boat_speed = max(polar_speed * efficiency, MIN_BOAT_SPEED_KN)
        seg_duration = timedelta(hours=seg.distance_nm / boat_speed)
        seg_start = departure_utc + cumulative_actual
        seg_end = seg_start + seg_duration
        cumulative_actual += seg_duration
        max_tws = max(max_tws, wp.speed_kn)
        min_boat_speed = min(min_boat_speed, boat_speed)
        reports.append(
            SegmentReport(
                start=seg.start,
                end=seg.end,
                distance_nm=seg.distance_nm,
                bearing_deg=seg.bearing_deg,
                start_time=seg_start,
                end_time=seg_end,
                tws_kn=wp.speed_kn,
                twd_deg=wp.direction_deg,
                twa_deg=twa,
                polar_speed_kn=polar_speed,
                boat_speed_kn=boat_speed,
                duration_h=seg_duration.total_seconds() / 3600.0,
            )
        )

    warnings: list[str] = []
    if max_tws >= STRONG_WIND_THRESHOLD_KN:
        warnings.append(f"vent fort: TWS max {max_tws:.0f} kn (≥{STRONG_WIND_THRESHOLD_KN:.0f})")
    if min_boat_speed < LIGHT_WIND_THRESHOLD_KN:
        warnings.append(f"vent faible: vitesse mini {min_boat_speed:.1f} kn — passage très lent")

    arrival = departure_utc + cumulative_actual
    total_distance = sum(s.distance_nm for s in segments)
    return PassageReport(
        archetype=boat_archetype,
        departure_time=departure_utc,
        arrival_time=arrival,
        duration_h=cumulative_actual.total_seconds() / 3600.0,
        distance_nm=total_distance,
        efficiency=efficiency,
        model=model,
        segments=tuple(reports),
        warnings=tuple(warnings),
    )
