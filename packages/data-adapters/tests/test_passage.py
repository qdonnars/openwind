from __future__ import annotations

from datetime import UTC, datetime, timedelta
from itertools import pairwise

import pytest

from openwind_data.adapters.base import (
    ForecastBundle,
    SeaSeries,
    WindPoint,
    WindSeries,
)
from openwind_data.routing.archetypes import get_polar, lookup_polar
from openwind_data.routing.geometry import Point
from openwind_data.routing.passage import (
    LIGHT_WIND_THRESHOLD_KN,
    STRONG_WIND_THRESHOLD_KN,
    estimate_passage,
)

DEPARTURE = datetime(2026, 5, 1, 6, 0, tzinfo=UTC)
MARSEILLE = Point(43.30, 5.35)
PORQUEROLLES = Point(43.00, 6.20)


class StubAdapter:
    """Returns a constant-wind ForecastBundle, optionally schedule-varying."""

    def __init__(
        self,
        tws_kn: float = 10.0,
        twd_deg: float = 0.0,
    ) -> None:
        self.tws_kn = tws_kn
        self.twd_deg = twd_deg
        self.calls: list[tuple[float, float, datetime, datetime]] = []

    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle:
        self.calls.append((lat, lon, start, end))
        models = models or ["meteofrance_arome_france"]
        points: list[WindPoint] = []
        t = start
        while t <= end:
            points.append(
                WindPoint(
                    time=t,
                    speed_kn=self.tws_kn,
                    direction_deg=self.twd_deg,
                    gust_kn=None,
                )
            )
            t = t + timedelta(hours=1)
        wind = {m: WindSeries(model=m, points=tuple(points)) for m in models}
        return ForecastBundle(
            lat=lat,
            lon=lon,
            start=start,
            end=end,
            wind_by_model=wind,
            sea=SeaSeries(points=()),
            requested_at=start,
        )


class TestEstimatePassage:
    async def test_marseille_to_porquerolles_north_wind(self) -> None:
        # Wind from north @ 10 kn, route bearing ~113° → TWA ~113° (broad reach).
        # cruiser_40ft polar at (10 kn, 113°) ≈ 6.66 kn x 0.75 efficiency ≈ 5.0 kn.
        # Distance ~41.4 NM → expected ~8.3 h.
        adapter = StubAdapter(tws_kn=10.0, twd_deg=0.0)
        report = await estimate_passage(
            [MARSEILLE, PORQUEROLLES],
            DEPARTURE,
            "cruiser_40ft",
            adapter=adapter,
            segment_length_nm=5.0,
        )
        assert 40.0 < report.distance_nm < 43.0
        assert 6.5 < report.duration_h < 10.0
        assert report.archetype == "cruiser_40ft"
        assert report.efficiency == 0.75
        assert report.departure_time == DEPARTURE
        assert report.arrival_time == DEPARTURE + timedelta(hours=report.duration_h)
        assert all(seg.tws_kn == 10.0 for seg in report.segments)
        assert all(seg.twd_deg == 0.0 for seg in report.segments)
        assert all(seg.boat_speed_kn > 0 for seg in report.segments)
        # No strong-wind warning at TWS=10
        assert all("vent fort" not in w for w in report.warnings)

    async def test_constant_wind_yields_exact_timing(self) -> None:
        # Challenge #7: single-pass approximation. Under constant wind in time,
        # the heuristic timing offset is irrelevant — the wind hit at any timestamp
        # is the same. So duration must equal sum(distance / boat_speed) exactly.
        adapter = StubAdapter(tws_kn=12.0, twd_deg=180.0)  # wind from south, course east
        report = await estimate_passage(
            [Point(43.0, 5.0), Point(43.0, 6.0)],
            DEPARTURE,
            "cruiser_40ft",
            adapter=adapter,
            segment_length_nm=10.0,
        )
        expected_h = sum(s.distance_nm / s.boat_speed_kn for s in report.segments)
        # Timedelta stores microseconds → drift ~1e-9 hours per segment
        assert report.duration_h == pytest.approx(expected_h, abs=1e-6)

    async def test_segment_speed_matches_polar_times_efficiency(self) -> None:
        adapter = StubAdapter(tws_kn=10.0, twd_deg=270.0)  # wind from west
        polar = get_polar("racer_cruiser")
        report = await estimate_passage(
            [Point(43.0, 5.0), Point(43.0, 5.5)],
            DEPARTURE,
            "racer_cruiser",
            adapter=adapter,
            segment_length_nm=20.0,
            efficiency=0.8,
        )
        for seg in report.segments:
            expected_polar = lookup_polar(polar, 10.0, seg.twa_deg)
            assert seg.polar_speed_kn == pytest.approx(expected_polar, rel=1e-9)
            assert seg.boat_speed_kn == pytest.approx(expected_polar * 0.8, rel=1e-9)

    async def test_strong_wind_warning(self) -> None:
        adapter = StubAdapter(tws_kn=30.0, twd_deg=180.0)
        report = await estimate_passage(
            [Point(43.0, 5.0), Point(43.0, 5.3)],
            DEPARTURE,
            "cruiser_40ft",
            adapter=adapter,
        )
        assert any("vent fort" in w for w in report.warnings)
        assert report.segments[0].tws_kn >= STRONG_WIND_THRESHOLD_KN

    async def test_light_wind_warning(self) -> None:
        # 3 kn wind clamped to grid edge (6 kn) but x 0.75 → ~3.5 kn upwind.
        # Use upwind route to stay under threshold.
        adapter = StubAdapter(tws_kn=3.0, twd_deg=90.0)  # wind from east, route east → upwind
        report = await estimate_passage(
            [Point(43.0, 5.0), Point(43.0, 5.3)],
            DEPARTURE,
            "cruiser_30ft",
            adapter=adapter,
        )
        # cruiser_30ft @ tws=6 (clamped), twa~0→clamped to 40 col → 3.0 x 0.75 = 2.25 kn
        assert any("vent faible" in w for w in report.warnings)
        assert min(s.boat_speed_kn for s in report.segments) < LIGHT_WIND_THRESHOLD_KN

    async def test_fetches_one_bundle_per_segment(self) -> None:
        adapter = StubAdapter(tws_kn=12.0, twd_deg=0.0)
        report = await estimate_passage(
            [Point(43.0, 5.0), Point(43.0, 6.0)],
            DEPARTURE,
            "cruiser_40ft",
            adapter=adapter,
            segment_length_nm=15.0,
        )
        assert len(adapter.calls) == len(report.segments)

    async def test_naive_departure_time_rejected(self) -> None:
        adapter = StubAdapter()
        with pytest.raises(ValueError, match="timezone-aware"):
            await estimate_passage(
                [MARSEILLE, PORQUEROLLES],
                datetime(2026, 5, 1, 6, 0),  # no tzinfo
                "cruiser_40ft",
                adapter=adapter,
            )

    async def test_invalid_efficiency_rejected(self) -> None:
        adapter = StubAdapter()
        with pytest.raises(ValueError, match="efficiency"):
            await estimate_passage(
                [MARSEILLE, PORQUEROLLES],
                DEPARTURE,
                "cruiser_40ft",
                adapter=adapter,
                efficiency=1.5,
            )

    async def test_unknown_archetype_propagates(self) -> None:
        adapter = StubAdapter()
        with pytest.raises(KeyError):
            await estimate_passage(
                [MARSEILLE, PORQUEROLLES],
                DEPARTURE,
                "battleship",
                adapter=adapter,
            )

    async def test_segments_continuous_in_time(self) -> None:
        adapter = StubAdapter(tws_kn=10.0, twd_deg=0.0)
        report = await estimate_passage(
            [MARSEILLE, PORQUEROLLES],
            DEPARTURE,
            "cruiser_40ft",
            adapter=adapter,
            segment_length_nm=5.0,
        )
        for s1, s2 in pairwise(report.segments):
            assert s1.end_time == s2.start_time
        assert report.segments[0].start_time == DEPARTURE
        assert report.segments[-1].end_time == report.arrival_time
