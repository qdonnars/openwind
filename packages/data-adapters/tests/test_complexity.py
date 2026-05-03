from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from openwind_data.routing.complexity import score_complexity, ComplexityWarning
from openwind_data.routing.geometry import Point
from openwind_data.routing.passage import PassageReport, SegmentReport

DEPARTURE = datetime(2026, 5, 1, 6, 0, tzinfo=UTC)


def _make_segment(tws_kn: float, hs_m: float | None = None) -> SegmentReport:
    return SegmentReport(
        start=Point(43.0, 5.0),
        end=Point(43.0, 5.1),
        distance_nm=5.0,
        bearing_deg=90.0,
        start_time=DEPARTURE,
        end_time=DEPARTURE + timedelta(hours=1),
        tws_kn=tws_kn,
        twd_deg=0.0,
        twa_deg=90.0,
        polar_speed_kn=6.0,
        boat_speed_kn=5.0,
        duration_h=1.0,
        hs_m=hs_m,
    )


def _make_passage(
    tws_per_segment: list[float],
    hs_per_segment: list[float | None] | None = None,
) -> PassageReport:
    if hs_per_segment is None:
        hs_per_segment = [None] * len(tws_per_segment)
    segs = tuple(
        _make_segment(t, h) for t, h in zip(tws_per_segment, hs_per_segment, strict=True)
    )
    return PassageReport(
        archetype="cruiser_40ft",
        departure_time=DEPARTURE,
        arrival_time=DEPARTURE + timedelta(hours=len(segs)),
        duration_h=float(len(segs)),
        distance_nm=5.0 * len(segs),
        efficiency=0.75,
        model="meteofrance_arome_france",
        segments=segs,
    )


class TestWindOnly:
    def test_calm_is_level_1(self) -> None:
        s = score_complexity(_make_passage([5.0, 8.0, 9.9]))
        assert s.level == 1
        assert s.label == "facile"
        assert s.wind_label == "calme"
        assert s.tws_max_kn == 9.9
        assert s.sea_level is None
        assert "5" not in s.rationale  # uses max not min
        assert "10 kn" in s.rationale

    def test_max_drives_level(self) -> None:
        s = score_complexity(_make_passage([5.0, 18.0, 8.0]))
        assert s.level == 3
        assert s.wind_label == "soutenu"

    def test_strong_wind_level_4(self) -> None:
        s = score_complexity(_make_passage([20.0, 24.9]))
        assert s.level == 4
        assert s.label == "exigeant"

    def test_extreme_wind_level_5(self) -> None:
        s = score_complexity(_make_passage([35.0]))
        assert s.level == 5
        assert s.label == "dangereux"

    def test_band_boundary_inclusive_lower(self) -> None:
        # 10.0 kn → modéré (not calme). Bands are upper-exclusive.
        s = score_complexity(_make_passage([10.0]))
        assert s.wind_level == 2


class TestWithSea:
    def test_sea_can_dominate(self) -> None:
        # Light wind but heavy sea
        s = score_complexity(_make_passage([8.0]), max_hs_m=2.5)
        assert s.wind_level == 1
        assert s.sea_level == 4
        assert s.level == 4
        assert "Hs=2.5" in s.rationale

    def test_wind_can_dominate(self) -> None:
        s = score_complexity(_make_passage([18.0]), max_hs_m=0.3)
        assert s.sea_level == 1
        assert s.wind_level == 3
        assert s.level == 3

    def test_sea_label_present(self) -> None:
        s = score_complexity(_make_passage([5.0]), max_hs_m=1.5)
        assert s.sea_label == "agitée"

    def test_negative_hs_rejected(self) -> None:
        with pytest.raises(ValueError, match="max_hs_m"):
            score_complexity(_make_passage([5.0]), max_hs_m=-0.1)


class TestWarnings:
    def test_no_warnings_below_level_3(self) -> None:
        s = score_complexity(_make_passage([12.0]))
        assert s.warnings == ()

    def test_wind_warning_at_level_3(self) -> None:
        s = score_complexity(_make_passage([18.0]))
        assert len(s.warnings) == 1
        w = s.warnings[0]
        assert w.kind == "wind"
        assert w.level == 3
        assert isinstance(w, ComplexityWarning)
        assert 0 in w.affected_segments
        # Single affected segment → no range, just the value, plus affected nm.
        assert "TWS 18 kn" in w.message
        assert "5 nm" in w.message
        assert "max" not in w.message
        assert "segment" not in w.message

    def test_wind_warning_identifies_hot_segments(self) -> None:
        # Segments 0 and 2 calm, segment 1 hits level 5 (>=25 kn)
        s = score_complexity(_make_passage([8.0, 26.0, 8.0]))
        assert len(s.warnings) == 1
        w = s.warnings[0]
        assert w.affected_segments == (1,)
        assert "TWS 26 kn" in w.message
        assert "5 nm" in w.message

    def test_wind_warning_reports_min_max_range(self) -> None:
        # Multiple affected segments at level 5 with different TWS values →
        # message must report the range, not a single max.
        s = score_complexity(_make_passage([26.0, 28.0, 30.0]))
        assert len(s.warnings) == 1
        w = s.warnings[0]
        assert w.kind == "wind"
        assert w.affected_segments == (0, 1, 2)
        assert "TWS 26-30 kn" in w.message
        assert "15 nm" in w.message

    def test_sea_warning_at_level_4(self) -> None:
        s = score_complexity(_make_passage([5.0]), max_hs_m=2.5)
        sea_w = [w for w in s.warnings if w.kind == "sea"]
        assert len(sea_w) == 1
        assert sea_w[0].level == 4  # 2.5 m falls in level 4 (2–3 m band)
        assert "Hs 2.5 m" in sea_w[0].message
        assert "max" not in sea_w[0].message

    def test_no_sea_warning_without_max_hs(self) -> None:
        s = score_complexity(_make_passage([18.0]))
        assert not any(w.kind == "sea" for w in s.warnings)

    def test_both_axes_warned(self) -> None:
        s = score_complexity(_make_passage([22.0]), max_hs_m=2.5)
        assert any(w.kind == "wind" for w in s.warnings)
        assert any(w.kind == "sea" for w in s.warnings)

    def test_sea_warning_uses_per_segment_hs_when_no_override(self) -> None:
        # Three 5 nm segments, only the middle one has Hs above the level-3
        # threshold (>=1.0 m). Sea warning should fire and report 5 nm affected.
        s = score_complexity(
            _make_passage([10.0, 10.0, 10.0], hs_per_segment=[0.4, 1.6, 0.4])
        )
        sea_w = [w for w in s.warnings if w.kind == "sea"]
        assert len(sea_w) == 1
        assert sea_w[0].affected_segments == (1,)
        assert "Hs 1.6 m" in sea_w[0].message
        assert "5 nm" in sea_w[0].message

    def test_sea_warning_reports_min_max_range(self) -> None:
        # Three segments with Hs >= 1.0 m and varying values → range expected.
        s = score_complexity(
            _make_passage([10.0, 10.0, 10.0], hs_per_segment=[1.2, 1.6, 1.9])
        )
        sea_w = [w for w in s.warnings if w.kind == "sea"]
        assert len(sea_w) == 1
        assert sea_w[0].affected_segments == (0, 1, 2)
        assert "Hs 1.2-1.9 m" in sea_w[0].message
        assert "15 nm" in sea_w[0].message

    def test_sea_warning_uses_full_route_when_only_max_hs_provided(self) -> None:
        # No per-segment Hs but caller passes route-level max → warning falls
        # back to the whole route distance (3 segs x 5 nm = 15 nm) and reports
        # the override value alone (no range data available).
        s = score_complexity(_make_passage([10.0, 10.0, 10.0]), max_hs_m=2.5)
        sea_w = [w for w in s.warnings if w.kind == "sea"]
        assert len(sea_w) == 1
        assert "Hs 2.5 m" in sea_w[0].message
        assert "15 nm" in sea_w[0].message


def test_empty_passage_rejected() -> None:
    p = PassageReport(
        archetype="cruiser_40ft",
        departure_time=DEPARTURE,
        arrival_time=DEPARTURE,
        duration_h=0.0,
        distance_nm=0.0,
        efficiency=0.75,
        model="meteofrance_arome_france",
        segments=(),
    )
    with pytest.raises(ValueError, match="no segments"):
        score_complexity(p)
