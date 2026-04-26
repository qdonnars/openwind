from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from openwind_data.routing.complexity import score_complexity
from openwind_data.routing.geometry import Point
from openwind_data.routing.passage import PassageReport, SegmentReport

DEPARTURE = datetime(2026, 5, 1, 6, 0, tzinfo=UTC)


def _make_segment(tws_kn: float) -> SegmentReport:
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
    )


def _make_passage(tws_per_segment: list[float]) -> PassageReport:
    segs = tuple(_make_segment(t) for t in tws_per_segment)
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
