"""Complexity scoring for a passage.

V1 design choices:

- **Two axes**: wind (TWS max over segments) and sea (Hs max). Each is binned
  into a 1-5 level. The passage level is `max(wind_level, sea_level)` — the worst
  axis dictates difficulty. No magic averaging.
- **Sea axis**: derived from per-segment Hs when present on the passage. Callers
  may pass `max_hs_m` explicitly to override (e.g., for tests that build minimal
  passages or to inject a forecast bulletin's worst case).
- **Rationale string**: human-readable f-string for the LLM/UI to surface.
- **Thresholds**: cruising-oriented bands. Documented in `docs/complexity.md`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from openwind_data.routing.passage import PassageReport

# (upper_bound_exclusive, level, label). Last bucket has math.inf.
_WIND_BANDS: tuple[tuple[float, int, str], ...] = (
    (10.0, 1, "calme"),
    (15.0, 2, "modéré"),
    (20.0, 3, "soutenu"),
    (25.0, 4, "fort"),
    (float("inf"), 5, "très fort"),
)

_SEA_BANDS: tuple[tuple[float, int, str], ...] = (
    (0.5, 1, "plate"),
    (1.0, 2, "belle"),
    (2.0, 3, "agitée"),
    (3.0, 4, "forte"),
    (float("inf"), 5, "très forte"),
)

_LEVEL_LABELS: dict[int, str] = {
    1: "facile",
    2: "modéré",
    3: "soutenu",
    4: "exigeant",
    5: "dangereux",
}


def _classify(value: float, bands: tuple[tuple[float, int, str], ...]) -> tuple[int, str]:
    for upper, level, label in bands:
        if value < upper:
            return level, label
    raise AssertionError("bands must end with +inf")  # pragma: no cover


def _lower_bound(level: int, bands: tuple[tuple[float, int, str], ...]) -> float:
    """Return the inclusive lower bound of value that maps to `level`."""
    prev: float = 0.0
    for upper, lv, _ in bands:
        if lv == level:
            return prev
        prev = upper
    return 0.0  # pragma: no cover


@dataclass(frozen=True, slots=True)
class ComplexityWarning:
    kind: Literal["wind", "sea"]
    level: int  # 1..5 — same scale as the axis that triggered it
    message: str
    affected_segments: tuple[int, ...]  # indices into PassageReport.segments


@dataclass(frozen=True, slots=True)
class ComplexityScore:
    level: int  # 1..5
    label: str  # facile / modéré / soutenu / exigeant / dangereux
    wind_level: int
    wind_label: str
    sea_level: int | None
    sea_label: str | None
    tws_max_kn: float
    hs_max_m: float | None
    rationale: str
    warnings: tuple[ComplexityWarning, ...] = ()


def score_complexity(
    passage: PassageReport,
    *,
    max_hs_m: float | None = None,
) -> ComplexityScore:
    """Score a passage on a 1-5 scale from wind (and optionally sea).

    Args:
        passage: a `PassageReport` with at least one segment.
        max_hs_m: optional max significant wave height over the route, in meters.
            When `None`, derived from segment Hs values on the passage; falls
            back to the wind-only score if no segment carries Hs.
    """
    if not passage.segments:
        raise ValueError("passage has no segments")

    tws_max = max(s.tws_kn for s in passage.segments)
    wind_level, wind_label = _classify(tws_max, _WIND_BANDS)

    if max_hs_m is None:
        seg_hs = [s.hs_m for s in passage.segments if s.hs_m is not None]
        max_hs_m = max(seg_hs) if seg_hs else None
    elif max_hs_m < 0:
        raise ValueError("max_hs_m must be >= 0")

    if max_hs_m is None:
        sea_level: int | None = None
        sea_label: str | None = None
        level = wind_level
        rationale = f"vent max {tws_max:.0f} kn ({wind_label})"
    else:
        sea_level, sea_label = _classify(max_hs_m, _SEA_BANDS)
        level = max(wind_level, sea_level)
        rationale = (
            f"vent max {tws_max:.0f} kn ({wind_label}), mer max Hs={max_hs_m:.1f} m ({sea_label})"
        )

    warnings: list[ComplexityWarning] = []
    if wind_level >= 3:
        threshold = _lower_bound(wind_level, _WIND_BANDS)
        affected = tuple(i for i, s in enumerate(passage.segments) if s.tws_kn >= threshold)
        affected_nm = sum(passage.segments[i].distance_nm for i in affected)
        warnings.append(ComplexityWarning(
            kind="wind",
            level=wind_level,
            message=f"Vent {wind_label} : TWS max {tws_max:.0f} kn sur {affected_nm:.0f} nm",
            affected_segments=affected,
        ))
    if sea_level is not None and sea_level >= 3 and max_hs_m is not None:
        threshold = _lower_bound(sea_level, _SEA_BANDS)
        affected_sea = tuple(
            i for i, s in enumerate(passage.segments)
            if s.hs_m is not None and s.hs_m >= threshold
        )
        # If max_hs_m came from a route-level override (no per-segment Hs on the
        # passage), default the affected span to the whole route so the warning
        # still reports a meaningful distance instead of "0 nm".
        if not affected_sea:
            affected_sea = tuple(range(len(passage.segments)))
        affected_sea_nm = sum(passage.segments[i].distance_nm for i in affected_sea)
        warnings.append(ComplexityWarning(
            kind="sea",
            level=sea_level,
            message=f"Mer {sea_label} : Hs max {max_hs_m:.1f} m sur {affected_sea_nm:.0f} nm",
            affected_segments=affected_sea,
        ))

    return ComplexityScore(
        level=level,
        label=_LEVEL_LABELS[level],
        wind_level=wind_level,
        wind_label=wind_label,
        sea_level=sea_level,
        sea_label=sea_label,
        tws_max_kn=tws_max,
        hs_max_m=max_hs_m,
        rationale=rationale,
        warnings=tuple(warnings),
    )
