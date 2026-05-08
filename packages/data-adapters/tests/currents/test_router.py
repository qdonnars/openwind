"""Tests for the MARC ↔ Open-Meteo composite adapter."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import polars as pl
import pytest

from openwind_data.adapters.base import (
    ForecastBundle,
    MarineDataAdapter,
    SeaPoint,
    SeaSeries,
    WindPoint,
    WindSeries,
)
from openwind_data.currents.marc_atlas import MarcAtlasRegistry
from openwind_data.currents.router import CompositeMarineAdapter


class _MockUpstream:
    """In-memory MarineDataAdapter for tests. Returns a fixed bundle."""

    def __init__(self, bundle: ForecastBundle) -> None:
        self.bundle = bundle
        self.calls: list[tuple] = []

    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle:
        self.calls.append((lat, lon, start, end, models))
        return self.bundle


def _make_bundle(lat: float, lon: float, hours: int = 4) -> ForecastBundle:
    base = datetime(2024, 6, 15, 12, tzinfo=UTC)
    times = [base + timedelta(hours=h) for h in range(hours)]
    sea_points = tuple(
        SeaPoint(
            time=t,
            wave_height_m=1.0,
            wave_period_s=6.0,
            wave_direction_deg=270.0,
            wind_wave_height_m=0.5,
            swell_wave_height_m=0.8,
            current_speed_kn=0.2,  # SMOC value, will be overridden by MARC
            current_direction_to_deg=180.0,
            tide_height_m=0.0,
            current_source="openmeteo_smoc",
        )
        for t in times
    )
    wind_points = tuple(
        WindPoint(time=t, speed_kn=15.0, direction_deg=200.0, gust_kn=20.0) for t in times
    )
    return ForecastBundle(
        lat=lat,
        lon=lon,
        start=times[0],
        end=times[-1],
        wind_by_model={"AROME": WindSeries(model="AROME", points=wind_points)},
        sea=SeaSeries(points=sea_points),
    )


@pytest.fixture
def fixture_atlas(tmp_path: Path) -> Path:
    """Same fixture shape as test_marc_atlas — single FINIS-like cell."""
    d = tmp_path / "FINIS"
    d.mkdir()
    (d / "metadata.json").write_text(
        json.dumps(
            {
                "atlas": "FINIS",
                "rank": 2,
                "resolution_m": 250,
                "constituents_h": ["M2"],
                "constituents_u": ["M2"],
                "constituents_v": ["M2"],
                "schema_version": 2,
            }
        )
    )
    (d / "coverage.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [-5.5, 47.5],
                                    [-4.5, 47.5],
                                    [-4.5, 49.0],
                                    [-5.5, 49.0],
                                    [-5.5, 47.5],
                                ]
                            ],
                        },
                    }
                ],
            }
        )
    )
    td = d / "tile_lat=48.0" / "tile_lon=-5.0"
    td.mkdir(parents=True)
    pl.DataFrame(
        {
            "lat": [48.35],
            "lon": [-4.80],
            "z0_hydro_m": [-3.85],
            "M2_h_amp": [2.05],
            "M2_h_g": [108.0],
            "M2_u_amp": [0.5],
            "M2_u_g": [80.0],
            "M2_v_amp": [0.3],
            "M2_v_g": [120.0],
        }
    ).write_parquet(td / "data.parquet")
    return tmp_path


@pytest.mark.asyncio
async def test_outside_marc_passes_through(fixture_atlas: Path) -> None:
    """Mediterranean point: bundle returns unchanged (Open-Meteo only)."""
    reg = MarcAtlasRegistry.from_directory(fixture_atlas)
    bundle = _make_bundle(43.0, 5.0)
    upstream = _MockUpstream(bundle)
    composite: MarineDataAdapter = CompositeMarineAdapter(upstream=upstream, marc=reg)
    out = await composite.fetch(43.0, 5.0, bundle.start, bundle.end)
    # All sea points keep openmeteo_smoc source
    for p in out.sea.points:
        assert p.current_source == "openmeteo_smoc"
        assert p.current_speed_kn == 0.2  # SMOC value preserved


@pytest.mark.asyncio
async def test_inside_marc_overrides_currents(fixture_atlas: Path) -> None:
    """FINIS coverage: currents and tide come from MARC, source label set."""
    reg = MarcAtlasRegistry.from_directory(fixture_atlas)
    bundle = _make_bundle(48.355, -4.795)
    upstream = _MockUpstream(bundle)
    composite = CompositeMarineAdapter(upstream=upstream, marc=reg)
    out = await composite.fetch(48.355, -4.795, bundle.start, bundle.end)
    for p in out.sea.points:
        assert p.current_source == "marc_finis_250m"
        # MARC value will differ from the fixed 0.2 kn SMOC default
        assert p.current_speed_kn != 0.2
        # Wave fields must remain unchanged (Open-Meteo only)
        assert p.wave_height_m == 1.0
        assert p.wave_period_s == 6.0


@pytest.mark.asyncio
async def test_passes_models_through(fixture_atlas: Path) -> None:
    reg = MarcAtlasRegistry.from_directory(fixture_atlas)
    bundle = _make_bundle(48.355, -4.795)
    upstream = _MockUpstream(bundle)
    composite = CompositeMarineAdapter(upstream=upstream, marc=reg)
    await composite.fetch(48.355, -4.795, bundle.start, bundle.end, models=["AROME"])
    assert upstream.calls[0][4] == ["AROME"]


@pytest.mark.asyncio
async def test_wind_unchanged(fixture_atlas: Path) -> None:
    reg = MarcAtlasRegistry.from_directory(fixture_atlas)
    bundle = _make_bundle(48.355, -4.795)
    upstream = _MockUpstream(bundle)
    composite = CompositeMarineAdapter(upstream=upstream, marc=reg)
    out = await composite.fetch(48.355, -4.795, bundle.start, bundle.end)
    assert out.wind_by_model == bundle.wind_by_model
