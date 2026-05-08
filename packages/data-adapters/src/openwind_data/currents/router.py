"""Composite marine adapter — MARC where covered, Open-Meteo SMOC elsewhere.

Wraps an upstream ``MarineDataAdapter`` (typically ``OpenMeteoAdapter``) and
a ``MarcAtlasRegistry``. Returns a ``ForecastBundle`` whose ``sea`` series
has currents and tide heights overridden by MARC predictions when the query
point falls inside a MARC emprise. Wave fields are always passed through
from Open-Meteo (MARC has no wave atlases).

Provenance is exposed on each ``SeaPoint`` via ``current_source``:
``"marc_<atlas_lower>_<res>m"`` (e.g. ``"marc_finis_250m"``) inside MARC,
``"openmeteo_smoc"`` outside.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from openwind_data.adapters.base import (
    ForecastBundle,
    MarineDataAdapter,
    SeaPoint,
    SeaSeries,
)
from openwind_data.currents.marc_atlas import MarcAtlasRegistry


def _marc_source_label(atlas_name: str, resolution_m: int) -> str:
    return f"marc_{atlas_name.lower()}_{resolution_m}m"


@dataclass
class CompositeMarineAdapter:
    """``MarineDataAdapter`` that overrides Open-Meteo currents/tide with MARC.

    Methods on the upstream adapter (e.g. ``aclose``) are not delegated;
    callers manage the lifecycle of the upstream they pass in.
    """

    upstream: MarineDataAdapter
    marc: MarcAtlasRegistry

    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle:
        bundle = await self.upstream.fetch(lat, lon, start, end, models=models)
        atlas = self.marc.covers(lat, lon)
        if atlas is None:
            return bundle  # outside MARC, keep Open-Meteo

        # Inside MARC: predict the full series in one shot (vectorised).
        times = [p.time for p in bundle.sea.points]
        if not times:
            return bundle
        h_series = self.marc.predict_height_series(lat, lon, times)
        c_series = self.marc.predict_current_series(lat, lon, times)
        if h_series is None and c_series is None:
            # No MARC data at this exact cell despite atlas coverage — fall back.
            return bundle

        source_label = _marc_source_label(atlas.name, atlas.resolution_m)
        h_arr = h_series[0] if h_series is not None else None
        if c_series is not None:
            speeds_kn, dirs_to_deg, _ = c_series
        else:
            speeds_kn, dirs_to_deg = None, None

        new_points: list[SeaPoint] = []
        for i, p in enumerate(bundle.sea.points):
            new_tide = float(h_arr[i]) if h_arr is not None else p.tide_height_m
            new_speed = float(speeds_kn[i]) if speeds_kn is not None else p.current_speed_kn
            new_dir = (
                float(dirs_to_deg[i]) if dirs_to_deg is not None else p.current_direction_to_deg
            )
            new_points.append(
                SeaPoint(
                    time=p.time,
                    wave_height_m=p.wave_height_m,
                    wave_period_s=p.wave_period_s,
                    wave_direction_deg=p.wave_direction_deg,
                    wind_wave_height_m=p.wind_wave_height_m,
                    swell_wave_height_m=p.swell_wave_height_m,
                    current_speed_kn=new_speed,
                    current_direction_to_deg=new_dir,
                    tide_height_m=new_tide,
                    current_source=source_label,
                )
            )
        return ForecastBundle(
            lat=bundle.lat,
            lon=bundle.lon,
            start=bundle.start,
            end=bundle.end,
            wind_by_model=bundle.wind_by_model,
            sea=SeaSeries(points=tuple(new_points)),
            requested_at=bundle.requested_at,
        )
