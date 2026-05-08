"""MARC PREVIMER atlas runtime loader and predictor.

Reads tiled Parquet datasets produced by ``scripts/build_marc_atlas.py`` (one
per atlas: ATLNE / MANGA / FINIS / MANW / MANE / SUDBZH / AQUI). Provides
height and current predictions at arbitrary (lat, lon, t).

Cascade priority within MARC: rank 2 (250 m, narrow passes) > rank 1 (700 m,
shelf) > rank 0 (2 km, open Atlantic). When a point lies in several emprises,
we pick the finest. Outside any MARC emprise, callers fall back to Open-Meteo
SMOC.

Predictor convention: standard SHOM/Schureman (see ``harmonic.py``). Heights
are around mean sea level (MSL = 0); add the cell's ``z0_hydro_m`` to convert
to chart datum (zéro hydrographique). Current direction follows oceanographic
convention "to" (0° = current setting toward the north).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import numpy as np
import polars as pl

from openwind_data.currents.harmonic import predict as schureman_predict

_TILE_SIZE_DEG = 0.5
# m/s to knots — conversion shared with the runtime adapters layer.
_MS_TO_KN = 1.0 / 0.514444


@dataclass(frozen=True, slots=True)
class AtlasMeta:
    """One MARC atlas as discovered on disk."""

    name: str
    rank: int
    resolution_m: int
    parquet_dir: Path
    bbox: tuple[float, float, float, float]  # (lat_min, lon_min, lat_max, lon_max)
    constituents_h: tuple[str, ...]
    constituents_u: tuple[str, ...]
    constituents_v: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CellPrediction:
    """All MARC outputs at a single grid cell, ready for harmonic reconstruction."""

    atlas_name: str
    lat: float
    lon: float
    z0_hydro_m: float | None
    h_constants: dict[str, tuple[float, float]]
    u_constants: dict[str, tuple[float, float]]
    v_constants: dict[str, tuple[float, float]]


def _scan_atlas(parquet_dir: Path) -> AtlasMeta | None:
    """Load one atlas from a directory containing ``metadata.json`` + tiles."""
    meta_file = parquet_dir / "metadata.json"
    if not meta_file.exists():
        return None
    meta = json.loads(meta_file.read_text())
    coverage = parquet_dir / "coverage.geojson"
    if coverage.exists():
        cov = json.loads(coverage.read_text())
        coords = cov["features"][0]["geometry"]["coordinates"][0]
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        bbox = (min(lats), min(lons), max(lats), max(lons))
    else:
        # Fallback: scan tile names. Not robust against partial atlas builds.
        bbox = (-90.0, -180.0, 90.0, 180.0)
    return AtlasMeta(
        name=meta["atlas"],
        rank=meta["rank"],
        resolution_m=meta["resolution_m"],
        parquet_dir=parquet_dir,
        bbox=bbox,
        constituents_h=tuple(meta.get("constituents_h", meta.get("constituents", []))),
        constituents_u=tuple(meta.get("constituents_u", [])),
        constituents_v=tuple(meta.get("constituents_v", [])),
    )


def _bbox_contains(bbox: tuple[float, float, float, float], lat: float, lon: float) -> bool:
    return bbox[0] <= lat <= bbox[2] and bbox[1] <= lon <= bbox[3]


@lru_cache(maxsize=128)
def _read_tile(parquet_path: str) -> pl.DataFrame | None:
    """LRU-cached tile reader. Returns None if the tile file is missing."""
    if not Path(parquet_path).exists():
        return None
    return pl.read_parquet(parquet_path)


def _tile_path(atlas: AtlasMeta, lat: float, lon: float) -> Path:
    tile_lat = np.floor(lat / _TILE_SIZE_DEG) * _TILE_SIZE_DEG
    tile_lon = np.floor(lon / _TILE_SIZE_DEG) * _TILE_SIZE_DEG
    return (
        atlas.parquet_dir / f"tile_lat={tile_lat:.1f}" / f"tile_lon={tile_lon:.1f}" / "data.parquet"
    )


def _nearest_cell_in_tile(df: pl.DataFrame, lat: float, lon: float) -> int | None:
    """Return index of metric-nearest cell, or None if the tile is empty.

    Uses local-tangent-plane distance: degrees-lon are scaled by cos(lat) so
    we don't bias toward longitudinal neighbours at high latitude. This
    matters for the cell-distance threshold check (a 0.05° lon-only neighbour
    at 48°N is 3.7 km away, not 5.5 km that an angular-only metric implies).
    """
    lats = df["lat"].to_numpy()
    lons = df["lon"].to_numpy()
    if len(lats) == 0:
        return None
    cos_lat = np.cos(np.deg2rad(lat))
    d2 = ((lats - lat) ** 2) + ((lons - lon) * cos_lat) ** 2
    return int(np.argmin(d2))


def _extract_constants(df: pl.DataFrame, idx: int, suffix: str) -> dict[str, tuple[float, float]]:
    """Pull constituent (amp, phase) pairs from one cell row.

    ``suffix`` is one of ``"h"``, ``"u"``, ``"v"`` — selects which trio of
    columns (e.g. ``M2_h_amp`` / ``M2_h_g``) to read.
    """
    out: dict[str, tuple[float, float]] = {}
    amp_suffix = f"_{suffix}_amp"
    g_suffix = f"_{suffix}_g"
    for col in df.columns:
        if not col.endswith(amp_suffix):
            continue
        cname = col[: -len(amp_suffix)]
        amp = float(df[col][idx])
        phase_col = f"{cname}{g_suffix}"
        if phase_col not in df.columns:
            continue
        phase = float(df[phase_col][idx])
        if np.isfinite(amp) and np.isfinite(phase):
            out[cname] = (amp, phase)
    return out


@dataclass(frozen=True, slots=True)
class MarcAtlasRegistry:
    """All atlases discovered on disk. Picks the finest covering each query."""

    atlases: tuple[AtlasMeta, ...]

    @classmethod
    def from_directory(cls, root: Path | str) -> MarcAtlasRegistry:
        root = Path(root)
        if not root.exists():
            return cls(atlases=())
        found: list[AtlasMeta] = []
        for sub in sorted(root.iterdir()):
            if not sub.is_dir():
                continue
            atlas = _scan_atlas(sub)
            if atlas is not None:
                found.append(atlas)
        return cls(atlases=tuple(found))

    # Tolerance for "the nearest cell is close enough to be considered valid".
    # Coverage polygons are bbox-only at build time, so the bbox can extend
    # beyond actual sea cells (e.g. ATLNE bbox includes parts of the Med where
    # the model has no valid cells). We require the nearest cell to be within
    # ~1.5x the atlas resolution, expressed in degrees at the query lat.
    _MAX_CELL_DISTANCE_M = 5000.0  # 5 km, generous

    def _cell_within_distance(
        self, atlas: AtlasMeta, df: pl.DataFrame, lat: float, lon: float
    ) -> int | None:
        idx = _nearest_cell_in_tile(df, lat, lon)
        if idx is None:
            return None
        cell_lat = float(df["lat"][idx])
        cell_lon = float(df["lon"][idx])
        # Convert degrees to metres at the query latitude.
        dlat_m = (cell_lat - lat) * 111_000
        dlon_m = (cell_lon - lon) * 111_000 * np.cos(np.deg2rad(lat))
        d_m = np.hypot(dlat_m, dlon_m)
        # Allow up to max(5 km, 5x resolution) — generous so we don't reject
        # legitimate MARC cells across small gaps in coverage.
        threshold = max(self._MAX_CELL_DISTANCE_M, 5.0 * atlas.resolution_m)
        return idx if d_m <= threshold else None

    def covers(self, lat: float, lon: float) -> AtlasMeta | None:
        """Return the finest atlas with actual data near (lat, lon), or None.

        Filters by bbox first, then verifies the nearest cell in the matching
        tile is within distance threshold. This catches false bbox matches
        (e.g. ATLNE bbox spuriously covering the Mediterranean).
        """
        candidates = [a for a in self.atlases if _bbox_contains(a.bbox, lat, lon)]
        if not candidates:
            return None
        candidates.sort(key=lambda a: (-a.rank, a.resolution_m))
        for atlas in candidates:
            df = _read_tile(str(_tile_path(atlas, lat, lon)))
            if df is None or df.height == 0:
                continue
            if self._cell_within_distance(atlas, df, lat, lon) is not None:
                return atlas
        return None

    def cell_at(self, lat: float, lon: float) -> CellPrediction | None:
        """Return the nearest valid cell across the best covering atlas, or None."""
        atlas = self.covers(lat, lon)
        if atlas is None:
            return None
        path = _tile_path(atlas, lat, lon)
        df = _read_tile(str(path))
        if df is None or df.height == 0:
            return None
        idx = self._cell_within_distance(atlas, df, lat, lon)
        if idx is None:
            return None
        cell_lat = float(df["lat"][idx])
        cell_lon = float(df["lon"][idx])
        z0_hydro = df.get_column("z0_hydro_m")[idx] if "z0_hydro_m" in df.columns else None
        return CellPrediction(
            atlas_name=atlas.name,
            lat=cell_lat,
            lon=cell_lon,
            z0_hydro_m=float(z0_hydro) if z0_hydro is not None and np.isfinite(z0_hydro) else None,
            h_constants=_extract_constants(df, idx, "h"),
            u_constants=_extract_constants(df, idx, "u"),
            v_constants=_extract_constants(df, idx, "v"),
        )

    def predict_height(self, lat: float, lon: float, t: datetime) -> tuple[float, str] | None:
        """Tide height in metres above MSL at (lat, lon, t).

        Returns ``(h_m, atlas_name)`` or ``None`` outside any MARC coverage
        or when the cell has no height constants.
        """
        cell = self.cell_at(lat, lon)
        if cell is None or not cell.h_constants:
            return None
        h = float(schureman_predict([t], cell.h_constants)[0])
        return h, cell.atlas_name

    def predict_current(
        self, lat: float, lon: float, t: datetime
    ) -> tuple[float, float, str] | None:
        """Current at (lat, lon, t) as ``(speed_kn, direction_to_deg, atlas_name)``.

        ``direction_to_deg`` follows oceanographic convention (0° = setting
        toward the north). Returns ``None`` outside MARC coverage or when
        the cell has no U/V constants.
        """
        cell = self.cell_at(lat, lon)
        if cell is None or not cell.u_constants or not cell.v_constants:
            return None
        u_ms = float(schureman_predict([t], cell.u_constants)[0])
        v_ms = float(schureman_predict([t], cell.v_constants)[0])
        # MARS2D: u is zonal (east+), v is meridional (north+). Convert to
        # speed + nautical "to" direction (compass, 0° = north, 90° = east).
        speed_ms = float(np.hypot(u_ms, v_ms))
        speed_kn = speed_ms * _MS_TO_KN
        direction_to_deg = float((np.rad2deg(np.arctan2(u_ms, v_ms))) % 360.0)
        return speed_kn, direction_to_deg, cell.atlas_name

    def predict_height_series(
        self, lat: float, lon: float, times: list[datetime]
    ) -> tuple[np.ndarray, str] | None:
        """Vectorised tide height for many times (single cell)."""
        cell = self.cell_at(lat, lon)
        if cell is None or not cell.h_constants:
            return None
        return schureman_predict(times, cell.h_constants), cell.atlas_name

    def predict_current_series(
        self, lat: float, lon: float, times: list[datetime]
    ) -> tuple[np.ndarray, np.ndarray, str] | None:
        """Vectorised current for many times: (speeds_kn, dirs_to_deg, atlas_name)."""
        cell = self.cell_at(lat, lon)
        if cell is None or not cell.u_constants or not cell.v_constants:
            return None
        u_ms = schureman_predict(times, cell.u_constants)
        v_ms = schureman_predict(times, cell.v_constants)
        speeds_kn = np.hypot(u_ms, v_ms) * _MS_TO_KN
        dirs_to_deg = (np.rad2deg(np.arctan2(u_ms, v_ms))) % 360.0
        return speeds_kn, dirs_to_deg, cell.atlas_name
