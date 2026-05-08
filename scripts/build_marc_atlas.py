#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "xarray>=2024.1",
#   "h5netcdf>=1.3",
#   "netCDF4>=1.6",
#   "numpy>=1.26",
#   "scipy>=1.12",
#   "polars>=1.0",
#   "pyarrow>=16",
#   "shapely>=2.0",
#   "rasterio>=1.3",
#   "huggingface_hub>=0.24",
#   "openwind-data",
# ]
#
# [tool.uv.sources]
# openwind-data = { path = "../packages/data-adapters", editable = true }
# ///
#
# Optional GPU acceleration: PyTorch CUDA. WSL2 + RTX works out of the box
# because torch bundles its own libcublas / libcurand:
#   uv run --with torch scripts/build_marc_atlas.py ...
# The Z0 hot path (matmul over 19y × N_cells) goes from ~25 min CPU to ~30s
# on an RTX-class GPU. Falls back to NumPy automatically if torch.cuda is
# not available. Torch is NOT a runtime dependency of openwind-data — only
# this build pipeline imports it.
"""MARC PREVIMER atlas build pipeline.

Stages
------
1. (optional) **download**: pull NetCDF files from Ifremer FTP for a given
   atlas. Uses ``IFREMER_FTP_*`` env vars. Skips already-cached files.
2. **regrid**: read curvilinear MARS2D grid (CF + COMODO), reconcile the
   Arakawa C-grid (U, V interpolated to XE cell centres), then resample
   to a regular lat/lon grid at native resolution. Phase interpolation in
   the complex domain (Fresnel vector) to avoid wraparound artefacts.
3. **z0_hydrographique**: per cell, compute the minimum of a 19-year
   prediction (covering one nodal cycle) using the Schureman predictor.
   Stored as ``z0_hydrographique_m`` for ZH conversion in the UI.
4. **parquet**: output one Parquet per 0.5° tile, wide format with one
   row per (lat, lon) cell containing all (h_amp, h_g, u_amp, u_g, v_amp,
   v_g) for each constituent.
5. **coverage_geojson**: union of valid (sea) cells, with morphological
   erosion at open boundaries (5% of domain extent on the side that does
   not touch land mask).
6. (optional) **validate**: load the Parquet, predict at fixed reference
   points, compare to known PDF reference (Le Conquet 2009-01-01 00:00
   UTC ATLNE -> -1.86 m).
7. (optional) **push**: upload to HF Dataset ``Qdonnars/openwind-tidal-atlas``.

Usage
-----
::

    uv run scripts/build_marc_atlas.py --atlas FINIS --cache-dir ~/openwind-marc-explore --output-dir ./build/marc/FINIS --validate

Press ``--push`` only when you intend to publish to HF Dataset (writes
externally). Without ``--push`` the script stops at the local Parquet.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import polars as pl
import xarray as xr
from scipy.spatial import cKDTree
from shapely.geometry import MultiPolygon, mapping
from shapely.ops import unary_union

from openwind_data.currents.harmonic import predict as schureman_predict

# ---------------------------------------------------------------------------
# Atlas metadata
# ---------------------------------------------------------------------------

ATLAS_FTP_ROOT = "MARC_L1-ATLAS-AHRMONIQUES"


@dataclass(frozen=True)
class AtlasSpec:
    name: str
    rank: int
    res_m: int
    folder: str  # FTP folder name (V0_* or V1_*)


ATLASES: dict[str, AtlasSpec] = {
    "ATLNE": AtlasSpec("ATLNE", 0, 2000, "V0_ATLNE"),
    "MANGA": AtlasSpec("MANGA", 1, 700, "V0_MANGA"),
    "FINIS": AtlasSpec("FINIS", 2, 250, "V1_FINIS"),
    "MANW": AtlasSpec("MANW", 2, 250, "V1_MANW"),
    "MANE": AtlasSpec("MANE", 2, 250, "V1_MANE"),
    "SUDBZH": AtlasSpec("SUDBZH", 2, 250, "V1_SUDBZH"),
    "AQUI": AtlasSpec("AQUI", 2, 250, "V1_AQUI"),
}

# 38 constituents available for rank-2 currents, 17 for rank 0/1, 37 for heights.
# We list the union; some may be missing for some atlases (handled at load).
KNOWN_CONSTITUENTS = (
    # long period
    "Z0", "Mm", "Mf",
    # diurnal
    "2Q1", "Sig1", "Q1", "Ro1", "O1", "MP1", "M1", "Ki1", "Pi1", "P1",
    "K1", "Psi1", "Phi1", "Tta1", "J1", "OO1", "KQ1",
    # semi-diurnal
    "2N2", "N2", "M2", "S2", "K2", "Nu2", "L2", "T2", "Mu2", "E2", "La2",
    "KJ2", "R2",
    # quart-diurnal
    "M4", "MS4", "MK4", "MN4",
    # sixth-diurnal
    "M6",
)


# ---------------------------------------------------------------------------
# Stage 1 — Download (optional)
# ---------------------------------------------------------------------------

def download_atlas(atlas: AtlasSpec, cache_dir: Path) -> None:
    """Download all NetCDFs for the atlas from Ifremer FTP, skip if cached."""
    user = os.environ.get("IFREMER_FTP_USER")
    pwd = os.environ.get("IFREMER_FTP_PASS")
    host = os.environ.get("IFREMER_FTP_HOST", "ftp.ifremer.fr")
    if not user or not pwd:
        sys.exit("error: IFREMER_FTP_USER and IFREMER_FTP_PASS required for --download")

    import subprocess

    cache_dir.mkdir(parents=True, exist_ok=True)
    print(f"[download] listing {atlas.folder}...")
    listing = subprocess.run(
        ["curl", "-s", "--max-time", "30",
         "--user", f"{user}:{pwd}",
         f"ftp://{host}/{ATLAS_FTP_ROOT}/{atlas.folder}/"],
        capture_output=True, text=True, check=True,
    ).stdout

    files = [line.split()[-1] for line in listing.splitlines() if line.endswith(".nc")]
    missing = [f for f in files if not (cache_dir / f).exists()]
    print(f"[download] {len(files)} files, {len(missing)} to fetch")
    for f in missing:
        url = f"ftp://{host}/{ATLAS_FTP_ROOT}/{atlas.folder}/{f}"
        target = cache_dir / f
        subprocess.run(
            ["curl", "-s", "--max-time", "120",
             "--user", f"{user}:{pwd}",
             "-o", str(target), url],
            check=True,
        )
        print(f"  + {f}")


# ---------------------------------------------------------------------------
# Stage 2 — Regrid
# ---------------------------------------------------------------------------

def list_constituents_in_cache(
    atlas: AtlasSpec, cache_dir: Path, var: str = "XE"
) -> list[str]:
    """Return constituent names with a NetCDF for the given variable (XE, U, V)."""
    found: list[str] = []
    for c in KNOWN_CONSTITUENTS:
        if (cache_dir / f"{c}-{var}-{atlas.name}-atlas.nc").exists():
            found.append(c)
    return found


def load_constants(
    atlas: AtlasSpec, constituent: str, var: str, cache_dir: Path
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return (lat_2d, lon_2d, amp_2d, phase_2d) for var in {XE, U, V}.

    XE files use `latitude` / `longitude`, U files use `latitude_u` /
    `longitude_u`, and V files use `latitude_v` / `longitude_v` per the
    Arakawa C-grid convention (XE at cell centres, U/V on offset faces).
    Each variable is regridded independently to the target XE grid; the
    half-step offset is absorbed by the bilinear interpolation.
    """
    fname = cache_dir / f"{constituent}-{var}-{atlas.name}-atlas.nc"
    ds = xr.open_dataset(fname)
    if var == "XE":
        lat_name, lon_name = "latitude", "longitude"
    elif var == "U":
        lat_name, lon_name = "latitude_u", "longitude_u"
    else:
        lat_name, lon_name = "latitude_v", "longitude_v"
    lat = ds[lat_name].values
    lon = ds[lon_name].values
    amp = ds[f"{var}_a"].values
    phase = ds[f"{var}_G"].values
    return lat, lon, amp, phase


def build_target_grid(lat_2d: np.ndarray, lon_2d: np.ndarray, res_m: int) -> tuple[np.ndarray, np.ndarray]:
    """Build a regular lat/lon grid at native resolution covering the source bbox."""
    lat_min, lat_max = float(np.nanmin(lat_2d)), float(np.nanmax(lat_2d))
    lon_min, lon_max = float(np.nanmin(lon_2d)), float(np.nanmax(lon_2d))
    # 1 deg lat ~= 111 km, so dlat = res_m / 111000
    dlat = res_m / 111_000
    mid_lat = (lat_min + lat_max) / 2
    dlon = res_m / (111_000 * np.cos(np.deg2rad(mid_lat)))
    lats = np.arange(lat_min, lat_max + dlat / 2, dlat)
    lons = np.arange(lon_min, lon_max + dlon / 2, dlon)
    return lats, lons


def regrid_complex(
    lat_2d: np.ndarray, lon_2d: np.ndarray,
    amp_src: np.ndarray, phase_src: np.ndarray,
    target_lat_1d: np.ndarray, target_lon_1d: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Regrid amplitude/phase fields from curvilinear src to regular target.

    Uses complex-number bilinear interpolation (Fresnel vector) to handle
    phase wrap correctly. Returns (amp, phase_deg, valid_mask) on the target
    grid. Cells too far from any source point are marked invalid.
    """
    src_pts = np.column_stack([lat_2d.ravel(), lon_2d.ravel()])
    src_amp = amp_src.ravel()
    src_phase = phase_src.ravel()
    valid_src = np.isfinite(src_amp) & np.isfinite(src_phase)
    if not valid_src.any():
        raise ValueError("no valid source cells")
    src_pts = src_pts[valid_src]
    src_amp = src_amp[valid_src]
    src_phase = src_phase[valid_src]

    # Complex Fresnel vector
    z_src = src_amp * np.exp(1j * np.deg2rad(src_phase))
    tree = cKDTree(src_pts)

    # Build target meshgrid points
    LON, LAT = np.meshgrid(target_lon_1d, target_lat_1d)
    tgt_pts = np.column_stack([LAT.ravel(), LON.ravel()])

    # Query 4 nearest sources, IDW interpolate the complex value
    dist, idx = tree.query(tgt_pts, k=4)
    # Cell size in degrees ~= median nearest distance
    median_d = float(np.median(dist[:, 0]))
    invalid = dist[:, 0] > 3 * median_d  # too far from any source
    eps = 1e-12
    weights = 1.0 / (dist + eps)
    weights = weights / weights.sum(axis=1, keepdims=True)
    z_tgt = (z_src[idx] * weights).sum(axis=1)

    amp_tgt = np.abs(z_tgt).reshape(LAT.shape)
    phase_tgt = (np.rad2deg(np.angle(z_tgt)) % 360).reshape(LAT.shape)
    valid_tgt = (~invalid).reshape(LAT.shape)
    amp_tgt[~valid_tgt] = np.nan
    phase_tgt[~valid_tgt] = np.nan
    return amp_tgt, phase_tgt, valid_tgt


# ---------------------------------------------------------------------------
# Stage 3 — Z0 hydrographique (lowest astronomical tide per cell)
# ---------------------------------------------------------------------------

def _try_torch_gpu():
    """Return torch module configured for CUDA if available, else None."""
    try:
        import torch  # type: ignore
        if torch.cuda.is_available():
            return torch
        return None
    except Exception as e:
        print(f"  [z0] PyTorch unavailable, using NumPy CPU. ({e})")
        return None


def compute_z0_hydro(
    constants_per_cell: dict[str, tuple[np.ndarray, np.ndarray]],
    valid_mask: np.ndarray,
    nodal_cycle_years: int = 19,
    sample_hours: int = 1,
    chunk_cells_cpu: int = 800,
    chunk_cells_gpu: int = 4000,
    use_gpu: bool = True,
) -> np.ndarray:
    """Per-cell Z0 hydrographique = min of 19-year prediction.

    Vectorised matrix-product form using cos(arg - phase) =
    cos(arg)cos(phase) + sin(arg)sin(phase). Uses PyTorch on CUDA if
    available, otherwise NumPy on CPU.
    """
    from openwind_data.currents.harmonic import (
        FREQS_DEG_PER_H,
        _NAME_TO_IDX,
        _astronomical_longitudes,
        _canonical,
        _equilibrium_argument,
        _nodal_corrections,
        _utc_to_mjd,
    )

    NAME_TO_IDX = _NAME_TO_IDX

    torch_mod = _try_torch_gpu() if use_gpu else None
    on_gpu = torch_mod is not None
    chunk_cells = chunk_cells_gpu if on_gpu else chunk_cells_cpu
    if on_gpu:
        gpu_name = torch_mod.cuda.get_device_name(0)
        print(f"  [z0] backend: GPU (torch on {gpu_name}), chunk={chunk_cells}")
    else:
        print(f"  [z0] backend: CPU (NumPy), chunk={chunk_cells}")

    ny, nx = valid_mask.shape
    out = np.full((ny, nx), np.nan)
    if not valid_mask.any():
        return out

    raw_names = list(constants_per_cell.keys())
    canon_names = [_canonical(n) for n in raw_names]
    keep = [(rn, cn) for rn, cn in zip(raw_names, canon_names) if cn is not None]
    if not keep:
        print("  [z0] no constituents mapped to NOC table — skipping")
        return out
    print(f"  [z0] using {len(keep)}/{len(raw_names)} constituents")

    sigma_np = np.array([FREQS_DEG_PER_H[NAME_TO_IDX[cn]] for _, cn in keep], dtype=np.float64)
    noc_idx = np.array([NAME_TO_IDX[cn] for _, cn in keep])

    flat_idx = np.where(valid_mask.ravel())[0]
    n_cells = len(flat_idx)
    n_const = len(keep)
    amp_mat = np.zeros((n_cells, n_const), dtype=np.float64)
    phase_mat = np.zeros((n_cells, n_const), dtype=np.float64)
    for j, (rn, _) in enumerate(keep):
        a2d, p2d = constants_per_cell[rn]
        amp_mat[:, j] = a2d.ravel()[flat_idx]
        phase_mat[:, j] = p2d.ravel()[flat_idx]
    # Per-cell NaN handling: replace any NaN with 0 (constituent contributes
    # nothing to the prediction at that cell). A cell is only flagged ``bad``
    # — and its z0 set to NaN — when M2 is missing (no usable tide signal at
    # all). Earlier versions required ALL constituents to be finite, which
    # bizarrely excluded otherwise-valid coastal cells where one minor
    # constituent had a NaN due to grid edge effects.
    nan_mask = ~(np.isfinite(amp_mat) & np.isfinite(phase_mat))
    amp_mat[nan_mask] = 0.0
    phase_mat[nan_mask] = 0.0
    if "M2" in {cn for _, cn in keep}:
        m2_col = next(j for j, (_, cn) in enumerate(keep) if cn == "M2")
        bad_cell = nan_mask[:, m2_col]
    else:
        bad_cell = np.zeros(n_cells, dtype=bool)

    n_samples = nodal_cycle_years * 365 * 24 // sample_hours
    base = datetime(2010, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    print(f"  [z0] {n_cells} cells, {n_samples} time samples")
    times = [base + timedelta(hours=int(i * sample_hours)) for i in range(n_samples)]
    mjd = np.array([_utc_to_mjd(t) for t in times])
    mjdn = np.floor(mjd).astype(int)
    hrs = 24.0 * (mjd - mjdn)
    s, h, p, en, p1 = _astronomical_longitudes(mjdn)
    v_full = _equilibrium_argument(s, h, p, p1)
    u_full, f_full = _nodal_corrections(p, en)
    v_used = v_full[:, noc_idx]
    u_used = u_full[:, noc_idx]
    f_used = f_full[:, noc_idx]
    arg_t = sigma_np[None, :] * hrs[:, None] + v_used + u_used
    cos_a = np.cos(np.deg2rad(arg_t))
    sin_a = np.sin(np.deg2rad(arg_t))
    X_t_np = (f_used * cos_a).T  # (n_const, n_samples)
    Y_t_np = (f_used * sin_a).T

    cos_p = np.cos(np.deg2rad(phase_mat))
    sin_p = np.sin(np.deg2rad(phase_mat))
    A_full_np = amp_mat * cos_p
    B_full_np = amp_mat * sin_p

    z0 = np.full(n_cells, np.nan)

    if on_gpu:
        device = "cuda"
        # float32 on GPU is plenty for tide amp precision and 2x faster.
        X_t = torch_mod.from_numpy(X_t_np.astype(np.float32)).to(device)
        Y_t = torch_mod.from_numpy(Y_t_np.astype(np.float32)).to(device)
        last_pct = -1
        for start in range(0, n_cells, chunk_cells):
            end = min(start + chunk_cells, n_cells)
            A_chunk = torch_mod.from_numpy(A_full_np[start:end].astype(np.float32)).to(device)
            B_chunk = torch_mod.from_numpy(B_full_np[start:end].astype(np.float32)).to(device)
            h_chunk = A_chunk @ X_t + B_chunk @ Y_t
            z_chunk = h_chunk.min(dim=1).values
            z0[start:end] = z_chunk.cpu().numpy().astype(np.float64)
            pct = int(100 * end / n_cells)
            if pct >= last_pct + 20 or end == n_cells:
                print(f"  [z0] {end}/{n_cells} ({pct}%)")
                last_pct = pct
    else:
        last_pct = -1
        for start in range(0, n_cells, chunk_cells):
            end = min(start + chunk_cells, n_cells)
            h_chunk = A_full_np[start:end] @ X_t_np + B_full_np[start:end] @ Y_t_np
            z0[start:end] = h_chunk.min(axis=1)
            pct = int(100 * end / n_cells)
            if pct >= last_pct + 10 or end == n_cells:
                print(f"  [z0] {end}/{n_cells} ({pct}%)")
                last_pct = pct

    z0[bad_cell] = np.nan
    out_flat = out.ravel().copy()
    out_flat[flat_idx] = z0
    return out_flat.reshape(ny, nx)


# ---------------------------------------------------------------------------
# Stage 4 — Parquet output
# ---------------------------------------------------------------------------

def write_parquet_tiled(
    target_lat_1d: np.ndarray, target_lon_1d: np.ndarray,
    valid_mask: np.ndarray,
    h_constants: dict[str, tuple[np.ndarray, np.ndarray]],
    u_constants: dict[str, tuple[np.ndarray, np.ndarray]],
    v_constants: dict[str, tuple[np.ndarray, np.ndarray]],
    z0_hydro: np.ndarray,
    output_dir: Path, atlas: AtlasSpec,
    tile_size_deg: float = 0.5,
) -> int:
    """Output one Parquet per (tile_lat, tile_lon) bucket. Returns row count.

    Schema per cell: lat, lon, z0_hydro_m, then per constituent up to 6 cols:
    {C}_h_amp, {C}_h_g (if heights), {C}_u_amp, {C}_u_g, {C}_v_amp, {C}_v_g
    (if currents). Constituents missing for a variable are absent — the
    runtime predictor skips columns it does not find.
    """
    LON, LAT = np.meshgrid(target_lon_1d, target_lat_1d)
    rows = {
        "lat": LAT[valid_mask],
        "lon": LON[valid_mask],
        "z0_hydro_m": z0_hydro[valid_mask],
    }
    for name, (amp_2d, phase_2d) in h_constants.items():
        rows[f"{name}_h_amp"] = amp_2d[valid_mask]
        rows[f"{name}_h_g"] = phase_2d[valid_mask]
    for name, (amp_2d, phase_2d) in u_constants.items():
        rows[f"{name}_u_amp"] = amp_2d[valid_mask]
        rows[f"{name}_u_g"] = phase_2d[valid_mask]
    for name, (amp_2d, phase_2d) in v_constants.items():
        rows[f"{name}_v_amp"] = amp_2d[valid_mask]
        rows[f"{name}_v_g"] = phase_2d[valid_mask]
    df = pl.DataFrame(rows)
    # Use a pure-Python loop for partitioning to keep things simple
    output_dir.mkdir(parents=True, exist_ok=True)
    n_total = 0
    for (tile_lat, tile_lon), tile_df in (
        df.with_columns([
            (pl.col("lat") / tile_size_deg).floor().cast(pl.Float32).alias("_tlat"),
            (pl.col("lon") / tile_size_deg).floor().cast(pl.Float32).alias("_tlon"),
        ]).group_by(["_tlat", "_tlon"])
    ):
        tlat = float(tile_lat) * tile_size_deg
        tlon = float(tile_lon) * tile_size_deg
        tile_dir = output_dir / f"tile_lat={tlat:.1f}" / f"tile_lon={tlon:.1f}"
        tile_dir.mkdir(parents=True, exist_ok=True)
        tile_df.drop(["_tlat", "_tlon"]).write_parquet(
            tile_dir / "data.parquet", compression="zstd"
        )
        n_total += tile_df.height
    # Write metadata sidecar
    meta = {
        "atlas": atlas.name,
        "rank": atlas.rank,
        "resolution_m": atlas.res_m,
        "constituents_h": list(h_constants.keys()),
        "constituents_u": list(u_constants.keys()),
        "constituents_v": list(v_constants.keys()),
        "build_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 2,
    }
    (output_dir / "metadata.json").write_text(json.dumps(meta, indent=2))
    return n_total


# ---------------------------------------------------------------------------
# Stage 5 — Coverage GeoJSON
# ---------------------------------------------------------------------------

def write_coverage_geojson(
    target_lat_1d: np.ndarray, target_lon_1d: np.ndarray,
    valid_mask: np.ndarray, atlas: AtlasSpec, output_dir: Path,
) -> None:
    """Bbox of valid cells, with margin reduction on open boundaries."""
    if not valid_mask.any():
        return
    valid_lats = target_lat_1d[np.any(valid_mask, axis=1)]
    valid_lons = target_lon_1d[np.any(valid_mask, axis=0)]
    lat_min, lat_max = float(valid_lats.min()), float(valid_lats.max())
    lon_min, lon_max = float(valid_lons.min()), float(valid_lons.max())
    # Conservative 5% inset on rank-2 domains (PREVIMER says 5-10% invalid at borders).
    if atlas.rank == 2:
        margin_lat = (lat_max - lat_min) * 0.05
        margin_lon = (lon_max - lon_min) * 0.05
        lat_min += margin_lat
        lat_max -= margin_lat
        lon_min += margin_lon
        lon_max -= margin_lon
    feature = {
        "type": "Feature",
        "properties": {
            "atlas": atlas.name,
            "rank": atlas.rank,
            "resolution_m": atlas.res_m,
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [lon_min, lat_min], [lon_max, lat_min],
                [lon_max, lat_max], [lon_min, lat_max],
                [lon_min, lat_min],
            ]],
        },
    }
    (output_dir / "coverage.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": [feature]}, indent=2,
    ))


# ---------------------------------------------------------------------------
# Stage 6 — Validate
# ---------------------------------------------------------------------------

def validate_atlas(output_dir: Path, atlas: AtlasSpec) -> None:
    """Read back the Parquet and verify a known reference prediction."""
    if atlas.name != "FINIS":
        print(f"[validate] no reference for {atlas.name}, skipping")
        return
    print("[validate] FINIS at Le Conquet (-4.80, 48.35) on 2009-01-01 00:00 UTC")
    df = pl.scan_parquet(str(output_dir / "**/data.parquet")).filter(
        (pl.col("lat").is_between(48.34, 48.36))
        & (pl.col("lon").is_between(-4.81, -4.79))
    ).collect()
    if df.height == 0:
        print("[validate] no rows found near Le Conquet — check tiles")
        return
    # nearest cell to (48.35, -4.80)
    lats = df["lat"].to_numpy()
    lons = df["lon"].to_numpy()
    idx = int(np.argmin((lats - 48.35) ** 2 + (lons + 4.80) ** 2))
    constants: dict[str, tuple[float, float]] = {}
    for col in df.columns:
        if col.endswith("_h_amp"):
            cname = col[:-6]
            amp = float(df[col][idx])
            phase = float(df[f"{cname}_h_g"][idx])
            if np.isfinite(amp) and np.isfinite(phase):
                constants[cname] = (amp, phase)
    t = datetime(2009, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    h = float(schureman_predict([t], constants)[0])
    print(f"  predicted: {h:+.4f} m   PDF reference (ATLNE): -1.8607 m")
    diff = abs(h - (-1.8607))
    if diff < 0.20:
        print(f"  PASS (diff {diff:.4f} m)")
    else:
        print(f"  WARN (diff {diff:.4f} m exceeds 20 cm — investigate)")


# ---------------------------------------------------------------------------
# Stage 7 — Push (optional)
# ---------------------------------------------------------------------------

def push_to_hf(output_dir: Path, atlas: AtlasSpec) -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("error: HF_TOKEN required for --push")
    from huggingface_hub import HfApi, create_repo, upload_folder
    repo_id = "Qdonnars/openwind-tidal-atlas"
    api = HfApi(token=token)
    try:
        api.dataset_info(repo_id)
        print(f"[push] dataset {repo_id} exists")
    except Exception:
        print(f"[push] creating private dataset {repo_id}...")
        create_repo(repo_id, repo_type="dataset", private=True, token=token)
    print(f"[push] uploading {output_dir} to {repo_id}/{atlas.name}/...")
    upload_folder(
        folder_path=str(output_dir),
        path_in_repo=atlas.name,
        repo_id=repo_id,
        repo_type="dataset",
        token=token,
        commit_message=f"build {atlas.name} {datetime.now(timezone.utc).date()}",
    )
    print(f"[push] done")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build(atlas_name: str, cache_dir: Path, output_dir: Path,
          download: bool = False, validate: bool = False, push: bool = False,
          skip_z0: bool = False) -> None:
    if atlas_name not in ATLASES:
        sys.exit(f"error: unknown atlas {atlas_name}; choices: {list(ATLASES)}")
    atlas = ATLASES[atlas_name]
    print(f"=== Build atlas {atlas.name} (rank {atlas.rank}, res {atlas.res_m} m) ===")

    if download:
        download_atlas(atlas, cache_dir)

    constituents = list_constituents_in_cache(atlas, cache_dir)
    if not constituents:
        sys.exit(f"error: no NetCDFs found in {cache_dir}; pass --download to fetch")
    print(f"[regrid] {len(constituents)} XE constituents available")

    # Use M2 to define the target grid (same grid for all constituents).
    lat_2d, lon_2d, _, _ = load_constants(atlas, "M2", "XE", cache_dir)
    target_lat_1d, target_lon_1d = build_target_grid(lat_2d, lon_2d, atlas.res_m)
    print(f"[regrid] target grid: {len(target_lat_1d)} x {len(target_lon_1d)}"
          f" cells over {target_lat_1d.min():.3f}..{target_lat_1d.max():.3f} N,"
          f" {target_lon_1d.min():.3f}..{target_lon_1d.max():.3f} E")

    # Heights (XE) — Z0-XE not published by PREVIMER (analysis on anomaly).
    h_constants: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    valid_mask = np.zeros((len(target_lat_1d), len(target_lon_1d)), dtype=bool)
    for c in constituents:
        if c == "Z0":
            continue
        l2d, n2d, amp_src, phase_src = load_constants(atlas, c, "XE", cache_dir)
        amp_t, phase_t, valid_t = regrid_complex(
            l2d, n2d, amp_src, phase_src, target_lat_1d, target_lon_1d,
        )
        h_constants[c] = (amp_t, phase_t)
        valid_mask = valid_mask | valid_t
    print(f"[regrid XE] {valid_mask.sum()} / {valid_mask.size} valid sea cells")

    # Currents U / V — include Z0 (residual mean current, published for U/V).
    u_constants: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    v_constants: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    u_consts_avail = list_constituents_in_cache(atlas, cache_dir, var="U")
    v_consts_avail = list_constituents_in_cache(atlas, cache_dir, var="V")
    if u_consts_avail and v_consts_avail:
        print(f"[regrid U] {len(u_consts_avail)} constituents")
        for c in u_consts_avail:
            l2d, n2d, amp_src, phase_src = load_constants(atlas, c, "U", cache_dir)
            amp_t, phase_t, _ = regrid_complex(
                l2d, n2d, amp_src, phase_src, target_lat_1d, target_lon_1d,
            )
            u_constants[c] = (amp_t, phase_t)
        print(f"[regrid V] {len(v_consts_avail)} constituents")
        for c in v_consts_avail:
            l2d, n2d, amp_src, phase_src = load_constants(atlas, c, "V", cache_dir)
            amp_t, phase_t, _ = regrid_complex(
                l2d, n2d, amp_src, phase_src, target_lat_1d, target_lon_1d,
            )
            v_constants[c] = (amp_t, phase_t)
    else:
        print(f"[regrid] no U/V available (heights-only build)")

    z0_hydro: np.ndarray
    if skip_z0:
        print("[z0] skipped (--skip-z0)")
        z0_hydro = np.full(valid_mask.shape, np.nan)
    else:
        print("[z0] computing 19-year minimum prediction per cell...")
        z0_hydro = compute_z0_hydro(h_constants, valid_mask)

    print("[parquet] writing tiled output...")
    n_rows = write_parquet_tiled(
        target_lat_1d, target_lon_1d, valid_mask,
        h_constants, u_constants, v_constants,
        z0_hydro, output_dir, atlas,
    )
    print(f"[parquet] wrote {n_rows} rows")

    print("[coverage] writing geojson...")
    write_coverage_geojson(target_lat_1d, target_lon_1d, valid_mask, atlas, output_dir)

    if validate:
        validate_atlas(output_dir, atlas)
    if push:
        push_to_hf(output_dir, atlas)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--atlas", required=True, choices=list(ATLASES))
    parser.add_argument("--cache-dir", type=Path, required=True,
                        help="Directory with NetCDF MARC files (or destination for --download)")
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="Output Parquet + coverage destination")
    parser.add_argument("--download", action="store_true",
                        help="Pull NetCDFs from Ifremer FTP (uses IFREMER_FTP_USER/PASS env)")
    parser.add_argument("--skip-z0", action="store_true",
                        help="Skip Z0 hydrographique calculation (faster, for development)")
    parser.add_argument("--validate", action="store_true",
                        help="Run reference-point prediction sanity check")
    parser.add_argument("--push", action="store_true",
                        help="Upload to HF Dataset (uses HF_TOKEN env)")
    args = parser.parse_args()
    build(args.atlas, args.cache_dir, args.output_dir,
          download=args.download, validate=args.validate, push=args.push,
          skip_z0=args.skip_z0)


if __name__ == "__main__":
    main()
