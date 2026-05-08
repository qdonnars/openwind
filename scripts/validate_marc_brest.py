"""Validate MARC PREVIMER atlases against published SHOM/REFMAR constants.

Reads the XE harmonic NetCDF files for the FINIS atlas, extracts amplitudes and
phases at Brest tide gauge coordinates, and compares to the constants known from
the literature (Pineau-Guillou 2013 validation report and SHOM publications).

Goal: confirm before scaling up the build pipeline that:
  - phase convention matches SHOM (Greenwich phase G in degrees, UTC reference)
  - amplitude unit is metres
  - the regrid and lookup work as expected

Run:
  cd ~/openwind-marc-explore && source .venv/bin/activate
  python /home/qdonnars/projects/open_wind/scripts/validate_marc_brest.py \
      --input-dir ~/openwind-marc-explore
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import xarray as xr
from scipy.spatial import cKDTree

# Brest port (REFMAR tide gauge "BREST")
BREST_LAT = 48.3825
BREST_LON = -4.4925

# Reference harmonic constants for Brest (Greenwich phase, degrees UTC).
# Range = published variation across sources (Pineau-Guillou 2013 Table 4,
# SHOM constants, REFMAR network, and PREVIMER validation literature).
# The values are NOT a single authoritative number, they vary slightly by epoch
# and analysis duration. Tolerance reflects this spread.
REFERENCE_BREST: dict[str, tuple[float, float, float, float]] = {
    # constituent: (amp_m_min, amp_m_max, phase_deg_min, phase_deg_max)
    "M2":  (2.00,  2.10,  140.0, 150.0),
    "S2":  (0.68,  0.74,  180.0, 192.0),
    "N2":  (0.42,  0.46,  120.0, 130.0),
    "K2":  (0.18,  0.22,  180.0, 192.0),
    "K1":  (0.06,  0.09,   95.0, 115.0),
    "O1":  (0.05,  0.08,  325.0, 345.0),
    "P1":  (0.02,  0.03,   95.0, 115.0),
    "Q1":  (0.01,  0.02,  290.0, 320.0),
    "M4":  (0.08,  0.13,   75.0, 95.0),
    "MS4": (0.06,  0.09,  125.0, 145.0),
    "M6":  (0.02,  0.05,  290.0, 360.0),
    "Mf":  (0.01,  0.04,    0.0, 360.0),  # long period, phase noisy
    "Mm":  (0.01,  0.04,    0.0, 360.0),
}


@dataclass
class ConstituentValue:
    name: str
    amp_m: float
    phase_deg: float


def load_constituent_xe(
    input_dir: Path, atlas: str, constituent: str
) -> xr.Dataset:
    fname = input_dir / f"{constituent}-XE-{atlas}-atlas.nc"
    if not fname.exists():
        raise FileNotFoundError(fname)
    return xr.open_dataset(fname)


def extract_at_point_bilinear(
    ds: xr.Dataset, lat: float, lon: float
) -> ConstituentValue:
    """Bilinear interpolation in the complex domain (correct for harmonic phases).

    Uses the 3 nearest neighbours from the curvilinear grid + barycentric weights
    via Inverse Distance Weighting on the complex Fresnel vector. This is rough
    but sufficient for spot validation. The production build script uses proper
    bilinear via parametric inverse on quadrilateral cells.
    """
    lats = ds["latitude"].values
    lons = ds["longitude"].values
    amps = ds["XE_a"].values
    phases_deg = ds["XE_G"].values

    src_points = np.column_stack([lats.ravel(), lons.ravel()])
    src_amp = amps.ravel()
    src_phase = phases_deg.ravel()

    # Discard NaN cells (land)
    valid = np.isfinite(src_amp) & np.isfinite(src_phase)
    src_points = src_points[valid]
    src_amp = src_amp[valid]
    src_phase = src_phase[valid]

    tree = cKDTree(src_points)
    dist, idx = tree.query([lat, lon], k=4)

    # Convert phase to complex Fresnel vector
    z_neighbors = src_amp[idx] * np.exp(1j * np.deg2rad(src_phase[idx]))

    # IDW weights (avoid /0 for an exact match)
    eps = 1e-9
    w = 1.0 / (dist + eps)
    w = w / w.sum()
    z_target = (z_neighbors * w).sum()

    return ConstituentValue(
        name=ds.attrs.get("standard_name", "unknown"),
        amp_m=float(np.abs(z_target)),
        phase_deg=float(np.rad2deg(np.angle(z_target)) % 360),
    )


def in_range(value: float, lo: float, hi: float, wrap_360: bool = False) -> bool:
    if not wrap_360:
        return lo <= value <= hi
    # phase wrap [0, 360)
    if lo <= hi:
        return lo <= value <= hi
    return value >= lo or value <= hi


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--atlas", default="FINIS")
    args = parser.parse_args()

    print(f"Validation MARC PREVIMER : atlas {args.atlas} @ Brest "
          f"({BREST_LAT}°N, {BREST_LON}°E)")
    print()
    print(f"  {'Const':>5}  {'amp_m':>8}  {'phase_deg':>10}  "
          f"{'expected_amp':>16}  {'expected_phase':>16}  status")
    print("  " + "-" * 90)

    pass_count = 0
    fail_count = 0
    for const, (amp_lo, amp_hi, ph_lo, ph_hi) in REFERENCE_BREST.items():
        try:
            ds = load_constituent_xe(args.input_dir, args.atlas, const)
        except FileNotFoundError:
            print(f"  {const:>5}  {'(missing)':>8}")
            continue

        val = extract_at_point_bilinear(ds, BREST_LAT, BREST_LON)
        amp_ok = in_range(val.amp_m, amp_lo, amp_hi)
        phase_ok = in_range(val.phase_deg, ph_lo, ph_hi, wrap_360=True)
        ok = amp_ok and phase_ok
        if ok:
            pass_count += 1
            status = "OK"
        else:
            fail_count += 1
            status = "FAIL"
            if not amp_ok:
                status += " (amp)"
            if not phase_ok:
                status += " (phase)"

        print(f"  {const:>5}  {val.amp_m:>8.4f}  {val.phase_deg:>10.2f}  "
              f"{amp_lo:>6.3f}-{amp_hi:>6.3f}  "
              f"{ph_lo:>6.1f}-{ph_hi:>6.1f}  {status}")

    print()
    print(f"  Passed: {pass_count}   Failed: {fail_count}")


if __name__ == "__main__":
    main()
