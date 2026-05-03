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
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from openwind_data.adapters.base import (
    ForecastHorizonError,
    MarineDataAdapter,
    SeaPoint,
    WindPoint,
)
from openwind_data.adapters.openmeteo import (
    AUTO_FALLBACK_CHAIN,
    AUTO_MODEL,
    DEFAULT_MODEL,
    OpenMeteoAdapter,
)
from openwind_data.routing.archetypes import BoatPolar, get_polar, lookup_polar
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
MODERATE_SEA_HS_M = 1.5  # >= 1.5m: "mer formee" warning
ROUGH_SEA_HS_M = 2.5     # >= 2.5m: "forte mer" warning

PREWARM_MIN_SPEED_KN = 2.0  # conservative floor to upper-bound passage duration for cache prewarm
MAX_SWEEP_WINDOWS = 336  # 14 days x 24h hard cap

# Wave derate — see README "References" section for sources.
WAVE_DERATE_K = 0.05
WAVE_DERATE_P = 1.75
WAVE_DERATE_FLOOR = 0.5


def wave_derate(hs_m: float, twa_deg: float) -> float:
    """Multiplicative speed factor in waves; returns 1.0 in flat water.

    Form: ``max(floor, 1 - k * Hs^p * f(TWA))`` with ``f(TWA) = cos²(TWA/2)``
    peaking head-seas (TWA=0) and zero down-seas (TWA=180). Defaults
    ``k=0.05``, ``p=1.75``, ``floor=0.5`` see README for sourcing.
    """
    if hs_m < 0:
        raise ValueError("hs_m must be >= 0")
    angular_factor = math.cos(math.radians(twa_deg / 2)) ** 2
    return max(WAVE_DERATE_FLOOR, 1.0 - WAVE_DERATE_K * hs_m**WAVE_DERATE_P * angular_factor)


def best_vmg_upwind(polar: BoatPolar, tws_kn: float) -> tuple[float, float]:
    """Return (optimal_twa_deg, polar_speed_kn) that maximises VMG upwind.

    Sweeps TWA in [30, 90] deg to find the angle maximising polar(twa) * cos(twa).
    Returns the optimal TWA and the polar speed at that angle (not the VMG value
    itself), so the caller can compute the tacking-geometry correction:
      effective_speed = polar_speed * cos(optimal_twa - segment_twa)
    """
    best_twa, best_speed, best_vmg = 45.0, 0.0, 0.0
    for twa_int in range(30, 91):
        twa = float(twa_int)
        sp = lookup_polar(polar, tws_kn, twa)
        vmg = sp * math.cos(math.radians(twa))
        if vmg > best_vmg:
            best_vmg = vmg
            best_twa = twa
            best_speed = sp
    return best_twa, best_speed


def _categorize_twa(twa_deg: float) -> str:
    if twa_deg < 45.0:
        return "pres"
    elif twa_deg < 90.0:
        return "travers"
    elif twa_deg < 135.0:
        return "largue"
    else:
        return "portant"


def _build_conditions_summary(report: PassageReport) -> dict:
    tws = [s.tws_kn for s in report.segments]
    counts: dict[str, int] = {}
    for s in report.segments:
        cat = _categorize_twa(s.twa_deg)
        counts[cat] = counts.get(cat, 0) + 1
    predominant = max(counts, key=lambda k: counts[k])
    hs = [s.hs_m for s in report.segments if s.hs_m is not None]
    return {
        "tws_min_kn": round(min(tws), 1),
        "tws_max_kn": round(max(tws), 1),
        "predominant_sail_angle": predominant,
        # Both bounds so consumers (web table, MCP App widget) can render a
        # range like "0.3-0.6m" instead of a single max value. PR #69 added
        # hs_min_m but it was dropped by the squash-merge — restored here.
        "hs_min_m": round(min(hs), 2) if hs else None,
        "hs_max_m": round(max(hs), 2) if hs else None,
    }


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
    hs_m: float | None = None
    wave_derate_factor: float = 1.0


@dataclass(frozen=True, slots=True)
class PassageReport:
    archetype: str
    departure_time: datetime
    arrival_time: datetime
    duration_h: float
    distance_nm: float
    efficiency: float
    model: str  # The model actually used (resolved from "auto" if applicable).
    segments: tuple[SegmentReport, ...]
    warnings: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class EtaPassagePlan:
    """Result of an ETA-driven passage solve.

    Backward-resolved: each segment's end_time is fixed (the next segment's
    start, or `target_arrival` for the last segment), and its duration is
    computed from the wind sampled at a heuristic mid-time. So
    `report.arrival_time == target_arrival` exactly by construction (modulo
    timedelta microsecond drift).
    """

    report: PassageReport
    target_arrival: datetime


def _closest_wind_point(points: tuple[WindPoint, ...], target: datetime) -> WindPoint:
    if not points:
        raise ValueError("no wind data points returned for segment")
    return min(points, key=lambda p: abs((p.time - target).total_seconds()))


def _closest_sea_hs(points: tuple[SeaPoint, ...], target: datetime) -> float | None:
    valid = [p for p in points if p.wave_height_m is not None]
    if not valid:
        return None
    return min(valid, key=lambda p: abs((p.time - target).total_seconds())).wave_height_m


async def estimate_passage(
    waypoints: list[Point],
    departure_time: datetime,
    boat_archetype: str,
    *,
    efficiency: float = 0.75,
    segment_length_nm: float = 10.0,
    adapter: MarineDataAdapter | None = None,
    model: str = DEFAULT_MODEL,
    heuristic_speed_kn: float = HEURISTIC_SPEED_KN,
    use_wave_correction: bool = False,
) -> PassageReport:
    """Estimate a passage's per-segment timing, speed, and warnings.

    Args:
        waypoints: ordered list of route waypoints (>=2 points).
        departure_time: timezone-aware datetime; converted to UTC internally.
        boat_archetype: one of the registry names (see `list_archetypes()`).
        efficiency: multiplier on polar speeds. Reference table:
            - ``0.85`` racing trim (clean hull, fresh sails, attentive crew)
            - ``0.75`` cruising (default — sail trim, comfort margins, helm)
            - ``0.65`` loaded family cruising (water/fuel/gear, fouled hull)
            - ``0.55`` heavy seas, neglected hull, short-handed
        segment_length_nm: target sub-segment length in NM. Default 10 nm
            balances precision and Open-Meteo request budget — Med wind
            gradients <10 nm are rare offshore. Drop to 5 for tight coastal
            work; raise to 20 for long offshore legs.
        adapter: any `MarineDataAdapter` (defaults to a fresh `OpenMeteoAdapter`).
        model: wind model name. Pass ``"auto"`` to try AROME → ICON → GFS in
            order and use the first one whose horizon covers the passage.
            The model actually used is reported in ``PassageReport.model``.
        heuristic_speed_kn: speed used for the single-pass timing estimate.
        use_wave_correction: if True, multiply boat speed by ``wave_derate(Hs, TWA)``
            using sea state from the bundle. Default False keeps V1 timings.

    Raises:
        ForecastHorizonError: if the chosen model's horizon does not cover the
            passage time (and ``model != "auto"``, or all auto candidates fail).
    """
    if departure_time.tzinfo is None:
        raise ValueError("departure_time must be timezone-aware")
    if not 0.0 < efficiency <= 1.0:
        raise ValueError("efficiency must be in (0, 1]")

    if model == AUTO_MODEL:
        last_err: ForecastHorizonError | None = None
        for candidate in AUTO_FALLBACK_CHAIN:
            try:
                return await _estimate_with_model(
                    waypoints,
                    departure_time,
                    boat_archetype,
                    efficiency=efficiency,
                    segment_length_nm=segment_length_nm,
                    adapter=adapter,
                    model=candidate,
                    heuristic_speed_kn=heuristic_speed_kn,
                    use_wave_correction=use_wave_correction,
                )
            except ForecastHorizonError as exc:
                last_err = exc
                continue
        assert last_err is not None
        raise last_err
    return await _estimate_with_model(
        waypoints,
        departure_time,
        boat_archetype,
        efficiency=efficiency,
        segment_length_nm=segment_length_nm,
        adapter=adapter,
        model=model,
        heuristic_speed_kn=heuristic_speed_kn,
        use_wave_correction=use_wave_correction,
    )


async def _estimate_with_model(
    waypoints: list[Point],
    departure_time: datetime,
    boat_archetype: str,
    *,
    efficiency: float,
    segment_length_nm: float,
    adapter: MarineDataAdapter | None,
    model: str,
    heuristic_speed_kn: float,
    use_wave_correction: bool,
) -> PassageReport:
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
    for seg, mid_time, _mid_pt, bundle in zip(
        segments, seg_mid_times, seg_mid_points, bundles, strict=True
    ):
        wind_series = bundle.wind_by_model.get(model)
        if wind_series is None or not wind_series.points:
            raise ForecastHorizonError(model, mid_time)
        wp = _closest_wind_point(wind_series.points, mid_time)
        twa = normalize_twa(twd=wp.direction_deg, course=seg.bearing_deg)
        polar_speed = lookup_polar(polar, wp.speed_kn, twa)
        opt_twa, opt_polar_speed = best_vmg_upwind(polar, wp.speed_kn)
        if twa < opt_twa:
            # Sailor tacks at optimal VMG angle; effective speed toward destination:
            #   v_eff = polar(opt) * cos(opt - twa)
            # At twa=0 reduces to VMG_pure_upwind; at twa->opt transitions smoothly.
            effective_polar = opt_polar_speed * math.cos(math.radians(opt_twa - twa))
        else:
            effective_polar = polar_speed
        # Always surface Hs from the bundle so callers see sea state, even if
        # wave correction is off. Derate only applies when explicitly requested.
        hs_m = _closest_sea_hs(bundle.sea.points, mid_time)
        derate = 1.0
        if use_wave_correction and hs_m is not None:
            derate = wave_derate(hs_m, twa)
        boat_speed = max(effective_polar * efficiency * derate, MIN_BOAT_SPEED_KN)
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
                hs_m=hs_m,
                wave_derate_factor=derate,
            )
        )

    warnings: list[str] = []
    if max_tws >= STRONG_WIND_THRESHOLD_KN:
        warnings.append(f"vent fort: TWS max {max_tws:.0f} kn (≥{STRONG_WIND_THRESHOLD_KN:.0f})")
    if min_boat_speed < LIGHT_WIND_THRESHOLD_KN:
        warnings.append(f"vent faible: vitesse mini {min_boat_speed:.1f} kn : passage très lent")
    hs_values = [s.hs_m for s in reports if s.hs_m is not None]
    if hs_values:
        hs_max = max(hs_values)
        if hs_max >= ROUGH_SEA_HS_M:
            warnings.append(f"forte mer: Hs max {hs_max:.1f} m (≥{ROUGH_SEA_HS_M:.1f})")
        elif hs_max >= MODERATE_SEA_HS_M:
            warnings.append(f"mer formée: Hs max {hs_max:.1f} m (≥{MODERATE_SEA_HS_M:.1f})")

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


async def _estimate_backward_with_model(
    waypoints: list[Point],
    target_arrival: datetime,
    boat_archetype: str,
    *,
    efficiency: float,
    segment_length_nm: float,
    adapter: MarineDataAdapter | None,
    model: str,
    heuristic_speed_kn: float,
    use_wave_correction: bool,
) -> PassageReport:
    """Mirror of `_estimate_with_model` anchored at arrival, solving backward.

    Walks segments from last to first: each segment's end_time is fixed (the
    next segment's start_time, or `target_arrival` for the last segment), and
    its actual duration is computed from the wind sampled at a mid-time guess.
    By construction, the resulting report has `arrival_time == target_arrival`
    exactly (modulo timedelta microsecond drift), so no fixed-point iteration
    is needed. Mid-time guesses use `heuristic_speed_kn` like the forward path,
    same temporal-correlation argument applies.
    """
    polar = get_polar(boat_archetype)
    segments = segment_route(waypoints, segment_length_nm)
    target_utc = target_arrival.astimezone(UTC)

    heuristic_speed_kn = max(heuristic_speed_kn, MIN_BOAT_SPEED_KN)
    seg_mid_times: list[datetime] = [target_utc] * len(segments)
    cumulative_back = timedelta(0)
    for idx in range(len(segments) - 1, -1, -1):
        seg_h = segments[idx].distance_nm / heuristic_speed_kn
        seg_mid_times[idx] = target_utc - cumulative_back - timedelta(hours=seg_h / 2)
        cumulative_back += timedelta(hours=seg_h)

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

    # Backward pass: walk segments in reverse, anchoring end_time at arrival.
    reverse_reports: list[SegmentReport] = []
    end_time = target_utc
    min_boat_speed = float("inf")
    for seg, mid_time, bundle in zip(
        reversed(segments), reversed(seg_mid_times), reversed(bundles), strict=True
    ):
        wind_series = bundle.wind_by_model.get(model)
        if wind_series is None or not wind_series.points:
            raise ForecastHorizonError(model, mid_time)
        wp = _closest_wind_point(wind_series.points, mid_time)
        twa = normalize_twa(twd=wp.direction_deg, course=seg.bearing_deg)
        polar_speed = lookup_polar(polar, wp.speed_kn, twa)
        opt_twa, opt_polar_speed = best_vmg_upwind(polar, wp.speed_kn)
        if twa < opt_twa:
            effective_polar = opt_polar_speed * math.cos(math.radians(opt_twa - twa))
        else:
            effective_polar = polar_speed
        hs_m = _closest_sea_hs(bundle.sea.points, mid_time)
        derate = 1.0
        if use_wave_correction and hs_m is not None:
            derate = wave_derate(hs_m, twa)
        boat_speed = max(effective_polar * efficiency * derate, MIN_BOAT_SPEED_KN)
        seg_duration = timedelta(hours=seg.distance_nm / boat_speed)
        seg_start = end_time - seg_duration
        min_boat_speed = min(min_boat_speed, boat_speed)
        reverse_reports.append(
            SegmentReport(
                start=seg.start,
                end=seg.end,
                distance_nm=seg.distance_nm,
                bearing_deg=seg.bearing_deg,
                start_time=seg_start,
                end_time=end_time,
                tws_kn=wp.speed_kn,
                twd_deg=wp.direction_deg,
                twa_deg=twa,
                polar_speed_kn=polar_speed,
                boat_speed_kn=boat_speed,
                duration_h=seg_duration.total_seconds() / 3600.0,
                hs_m=hs_m,
                wave_derate_factor=derate,
            )
        )
        end_time = seg_start

    reports = list(reversed(reverse_reports))
    departure = reports[0].start_time
    duration = target_utc - departure

    warnings: list[str] = []
    max_tws = max(r.tws_kn for r in reports)
    if max_tws >= STRONG_WIND_THRESHOLD_KN:
        warnings.append(f"vent fort: TWS max {max_tws:.0f} kn (≥{STRONG_WIND_THRESHOLD_KN:.0f})")
    if min_boat_speed < LIGHT_WIND_THRESHOLD_KN:
        warnings.append(f"vent faible: vitesse mini {min_boat_speed:.1f} kn : passage très lent")
    hs_values = [r.hs_m for r in reports if r.hs_m is not None]
    if hs_values:
        hs_max = max(hs_values)
        if hs_max >= ROUGH_SEA_HS_M:
            warnings.append(f"forte mer: Hs max {hs_max:.1f} m (≥{ROUGH_SEA_HS_M:.1f})")
        elif hs_max >= MODERATE_SEA_HS_M:
            warnings.append(f"mer formée: Hs max {hs_max:.1f} m (≥{MODERATE_SEA_HS_M:.1f})")

    total_distance = sum(s.distance_nm for s in segments)
    return PassageReport(
        archetype=boat_archetype,
        departure_time=departure,
        arrival_time=target_utc,
        duration_h=duration.total_seconds() / 3600.0,
        distance_nm=total_distance,
        efficiency=efficiency,
        model=model,
        segments=tuple(reports),
        warnings=tuple(warnings),
    )


async def estimate_passage_windows(
    waypoints: list[Point],
    earliest_departure: datetime,
    latest_departure: datetime,
    boat_archetype: str,
    *,
    sweep_interval_hours: int = 1,
    efficiency: float = 0.75,
    segment_length_nm: float = 10.0,
    adapter: MarineDataAdapter | None = None,
    model: str = AUTO_MODEL,
    use_wave_correction: bool = False,
) -> list[PassageReport]:
    """Simulate multiple departure windows for a fixed route.

    Fetches weather data once (prewarm) then sweeps over departure times from
    ``earliest_departure`` to ``latest_departure`` every ``sweep_interval_hours``,
    returning one ``PassageReport`` per window. All simulations after the first
    are cache hits API cost is identical to a single ``estimate_passage`` call.

    Args:
        waypoints: ordered route waypoints (>=2 points).
        earliest_departure: start of sweep window (timezone-aware).
        latest_departure: end of sweep window (timezone-aware, inclusive).
        boat_archetype: one of the registry names (see ``list_archetypes()``).
        sweep_interval_hours: spacing between departure windows (default 1h).
        efficiency: multiplier on polar speeds (see ``estimate_passage``).
        segment_length_nm: sub-segment length for weather sampling.
        adapter: any ``MarineDataAdapter`` (defaults to a fresh ``OpenMeteoAdapter``).
        model: wind model; ``"auto"`` tries AROME → ICON → GFS in order.
        use_wave_correction: if True, apply wave derate to each segment.

    Raises:
        ValueError: if datetimes are naive, earliest > latest, interval < 1, or
            the sweep would exceed ``MAX_SWEEP_WINDOWS`` windows.
        ForecastHorizonError: if no model covers the full sweep horizon.
    """
    if earliest_departure.tzinfo is None or latest_departure.tzinfo is None:
        raise ValueError("earliest_departure and latest_departure must be timezone-aware")
    if earliest_departure > latest_departure:
        raise ValueError("earliest_departure must be <= latest_departure")
    if sweep_interval_hours < 1:
        raise ValueError("sweep_interval_hours must be >= 1")

    earliest_utc = earliest_departure.astimezone(UTC)
    latest_utc = latest_departure.astimezone(UTC)

    n_windows = int((latest_utc - earliest_utc).total_seconds() / 3600 / sweep_interval_hours) + 1
    if n_windows > MAX_SWEEP_WINDOWS:
        raise ValueError(
            f"sweep would produce {n_windows} windows, exceeding the {MAX_SWEEP_WINDOWS} cap "
            f"(14 d x 24 h). Reduce the sweep range or increase sweep_interval_hours."
        )

    segments = segment_route(waypoints, segment_length_nm)
    seg_mid_points = [midpoint(s.start, s.end) for s in segments]
    route_nm = sum(s.distance_nm for s in segments)

    own_adapter = adapter is None
    fetch_adapter: MarineDataAdapter = adapter or OpenMeteoAdapter()
    try:
        # Simulate the first window to resolve the model (needed before prewarm).
        first = await estimate_passage(
            waypoints,
            earliest_utc,
            boat_archetype,
            efficiency=efficiency,
            segment_length_nm=segment_length_nm,
            adapter=fetch_adapter,
            model=model,
            use_wave_correction=use_wave_correction,
        )
        resolved_model = first.model
        reports: list[PassageReport] = [first]

        # Prewarm cache for the entire sweep horizon so all remaining calls are hits.
        prewarm_end = latest_utc + timedelta(hours=route_nm / PREWARM_MIN_SPEED_KN) + WIND_FETCH_WINDOW
        await asyncio.gather(
            *[
                fetch_adapter.fetch(pt.lat, pt.lon, earliest_utc, prewarm_end, models=[resolved_model])
                for pt in seg_mid_points
            ]
        )

        # Sweep remaining departure windows sequentially. The first window's
        # resolved model is the cache-warmed default; later windows that fall
        # past its horizon retry with the AUTO chain so we escalate to
        # ICON-EU / ECMWF / GFS instead of dropping them. Cost: a non-cached
        # fetch per fallback window (Open-Meteo is keyless and fast). When
        # the user pinned a specific model (model != "auto"), we respect that
        # and skip out-of-horizon windows — explicit choice wins.
        # ValueError / KeyError still bubble (caller-side bugs).
        current = earliest_utc + timedelta(hours=sweep_interval_hours)
        while current <= latest_utc:
            try:
                report = await estimate_passage(
                    waypoints,
                    current,
                    boat_archetype,
                    efficiency=efficiency,
                    segment_length_nm=segment_length_nm,
                    adapter=fetch_adapter,
                    model=resolved_model,
                    use_wave_correction=use_wave_correction,
                )
                reports.append(report)
            except ForecastHorizonError:
                if model == AUTO_MODEL and resolved_model != AUTO_FALLBACK_CHAIN[-1]:
                    try:
                        report = await estimate_passage(
                            waypoints,
                            current,
                            boat_archetype,
                            efficiency=efficiency,
                            segment_length_nm=segment_length_nm,
                            adapter=fetch_adapter,
                            model=AUTO_MODEL,
                            use_wave_correction=use_wave_correction,
                        )
                        reports.append(report)
                    except ForecastHorizonError:
                        pass  # No model in the chain covers it (e.g., past GFS's ~16 d).
            current += timedelta(hours=sweep_interval_hours)
    finally:
        if own_adapter and hasattr(fetch_adapter, "aclose"):
            await fetch_adapter.aclose()  # pragma: no cover

    return reports


async def estimate_passage_for_arrival(
    waypoints: list[Point],
    target_arrival: datetime,
    boat_archetype: str,
    *,
    efficiency: float = 0.75,
    segment_length_nm: float = 10.0,
    adapter: MarineDataAdapter | None = None,
    model: str = AUTO_MODEL,
    heuristic_speed_kn: float = HEURISTIC_SPEED_KN,
    use_wave_correction: bool = False,
) -> EtaPassagePlan:
    """Inverse of `estimate_passage`: solve for a departure given a target arrival.

    Single-pass backward resolution: walks segments from last to first, anchoring
    each segment's end_time at the next one's start (or `target_arrival` for the
    last segment) and computing its actual duration from the wind sampled at a
    heuristic mid-time. Returns a plan whose `report.arrival_time` equals
    `target_arrival` exactly by construction, so no iteration / tolerance /
    convergence logic is needed.

    Args:
        waypoints: ordered list of route waypoints (>=2 points).
        target_arrival: timezone-aware datetime; the arrival we want to hit.
        boat_archetype: one of the registry names.
        efficiency: multiplier on polar speeds (see `estimate_passage`).
        segment_length_nm: sub-segment length for weather sampling.
        adapter: any `MarineDataAdapter` (defaults to a fresh `OpenMeteoAdapter`).
        model: wind model name; ``"auto"`` tries AROME → ICON → GFS in order.
        heuristic_speed_kn: speed used to lay out per-segment mid-time guesses.
        use_wave_correction: if True, multiply boat speed by `wave_derate(Hs, TWA)`.

    Raises:
        ValueError: if `target_arrival` is naive.
        ForecastHorizonError: if no model in the (auto-)chain covers the resolved
            passage window.
    """
    if target_arrival.tzinfo is None:
        raise ValueError("target_arrival must be timezone-aware")
    if not 0.0 < efficiency <= 1.0:
        raise ValueError("efficiency must be in (0, 1]")

    target_utc = target_arrival.astimezone(UTC)

    if model == AUTO_MODEL:
        last_err: ForecastHorizonError | None = None
        for candidate in AUTO_FALLBACK_CHAIN:
            try:
                report = await _estimate_backward_with_model(
                    waypoints,
                    target_utc,
                    boat_archetype,
                    efficiency=efficiency,
                    segment_length_nm=segment_length_nm,
                    adapter=adapter,
                    model=candidate,
                    heuristic_speed_kn=heuristic_speed_kn,
                    use_wave_correction=use_wave_correction,
                )
                return EtaPassagePlan(report=report, target_arrival=target_utc)
            except ForecastHorizonError as exc:
                last_err = exc
                continue
        assert last_err is not None
        raise last_err

    report = await _estimate_backward_with_model(
        waypoints,
        target_utc,
        boat_archetype,
        efficiency=efficiency,
        segment_length_nm=segment_length_nm,
        adapter=adapter,
        model=model,
        heuristic_speed_kn=heuristic_speed_kn,
        use_wave_correction=use_wave_correction,
    )
    return EtaPassagePlan(report=report, target_arrival=target_utc)
