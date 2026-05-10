"""Build the SHOM Atlas C2D runtime artefacts.

Reads the extracted SHOM ASCII archive at ``build/c2d/C2D/CD_COURANTS2D/DONNEES``
and writes two files under ``build/shom_c2d/`` ready to be uploaded to the HF
Dataset alongside MARC:

- ``shom_c2d_points.parquet`` — flat table, one row per scattered point
  (~13k rows total). Columns: ``atlas_id`` (int), ``zone`` (str),
  ``ref_port_key`` (normalised key matching the ports JSON), ``ref_tide``
  ("PM" or "BM"), ``lat``, ``lon`` (float32, WGS84), and four list[float32]
  columns ``u_ve_kn``, ``v_ve_kn``, ``u_me_kn``, ``v_me_kn`` each of length
  13 (hour offsets ``-6h..+6h`` relative to the reference port's PM/BM).

- ``shom_c2d_ref_ports.json`` — mapping ``ref_port_key`` → ``{"display_name",
  "lat", "lon", "ref_tide", "constants"}`` where ``constants`` is the
  M2/S2/N2/K1/O1/M4 amp+phase pair extracted from MARC at that port's
  coordinates. The runtime uses these ~6 constituents to find the nearest
  PM/BM event without depending on MARC at runtime — making the SHOM
  adapter fully autonomous and cleanly independent if MARC is later
  removed.

Run from repo root::

    uv run --project packages/data-adapters python scripts/build_shom_c2d.py

The script reads ``MARC_ATLAS_DIR`` (defaults to ``build/marc``) and
``C2D_DONNEES`` (defaults to the extracted archive path). Both must be
populated before running (the SHOM C2D archive needs to be extracted, and
the MARC atlases need to be built).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import polars as pl

from openwind_data.currents.marc_atlas import MarcAtlasRegistry
from openwind_data.currents.shom_c2d import load_c2d_directory

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_C2D_DONNEES = REPO_ROOT / "build" / "c2d" / "C2D" / "CD_COURANTS2D" / "DONNEES"
DEFAULT_MARC_DIR = REPO_ROOT / "build" / "marc"
OUT_DIR = REPO_ROOT / "build" / "shom_c2d"

# Constituents we extract from MARC at each reference port for the runtime
# tide-event predictor. M2 + S2 alone capture > 95 % of the semi-diurnal
# tide at French ports; the others trim the residual phase error.
REF_CONSTITUENTS: tuple[str, ...] = ("M2", "S2", "N2", "K1", "O1", "M4")

# Approximate WGS84 coordinates of every reference port that appears in the
# SHOM C2D file headers (lat in °N, lon in °E). The keys must match the
# normalised form produced by ``_normalise_port`` below. These are the
# stations themselves (port entrance / harbour gauge), accurate to ~1 km
# which is enough for harmonic constant extraction from MARC.
REF_PORT_COORDS: dict[str, tuple[float, float, str]] = {
    "BOULOGNE_SUR_MER": (50.7257, 1.6048, "Boulogne-sur-Mer"),
    "BREST": (48.3833, -4.4956, "Brest"),
    "CALAIS": (50.9683, 1.8500, "Calais"),
    "CHERBOURG": (49.6500, -1.6333, "Cherbourg"),
    "CONCARNEAU": (47.8717, -3.9181, "Concarneau"),
    "DUNKERQUE": (51.0500, 2.3667, "Dunkerque"),
    "LA_ROCHELLE": (46.1500, -1.1500, "La Rochelle (La Pallice)"),
    "LES_SABLES_D'OLONNE": (46.5000, -1.7833, "Les Sables d'Olonne"),
    "LE_HAVRE": (49.4833, 0.1167, "Le Havre"),
    "PAIMPOL": (48.7833, -3.0500, "Paimpol"),
    "POINTE_DE_GRAVE": (45.5719, -1.0625, "Pointe de Grave"),
    "PORT_NAVALO": (47.5483, -2.9183, "Port-Navalo"),
    "PORT_TUDY": (47.6431, -3.4456, "Port-Tudy (Île de Groix)"),
    "ROSCOFF": (48.7167, -3.9667, "Roscoff"),
    "SAINT_MALO": (48.6378, -2.0239, "Saint-Malo"),
    "SAINT_NAZAIRE": (47.2700, -2.2125, "Saint-Nazaire"),
}


def _normalise_port(raw: str) -> str:
    """Normalise a SHOM reference-port string into a stable lookup key.

    SHOM headers use a mix of casings, separators (space/underscore/hyphen)
    and accents (e.g. ``"PORT-NAVALO"`` vs ``"Port-Navalo"``). The build
    script needs a single key per logical port so we can both deduplicate
    and look up coordinates in ``REF_PORT_COORDS``. Stripping is identical
    to the runtime side.
    """
    return raw.strip().upper().replace(" ", "_").replace("-", "_")


def _extract_marc_constants(
    marc: MarcAtlasRegistry, lat: float, lon: float, names: tuple[str, ...]
) -> dict[str, list[float]]:
    """Pull harmonic constants for ``names`` at (lat, lon) from MARC.

    Returns ``{name: [amp_m, phase_g_deg]}`` for each constituent that has
    a finite value at the chosen cell. Constituents missing from the cell
    are silently dropped — the harmonic predictor copes with subsets.
    """
    cell = marc.cell_at(lat, lon)
    if cell is None or not cell.h_constants:
        raise RuntimeError(
            f"MARC has no cell near ({lat}, {lon}) — cannot extract ref-port constants"
        )
    out: dict[str, list[float]] = {}
    for canonical in names:
        # MARC files spell some constituents with title case (Mu2, La2). The
        # harmonic predictor's alias table normalises both forms; here we
        # only need to find a matching key in the cell's stored constants.
        for raw_name, (amp, phase) in cell.h_constants.items():
            if raw_name.upper() == canonical.upper():
                out[canonical] = [float(amp), float(phase)]
                break
    return out


def main() -> None:
    c2d_dir = Path(os.environ.get("C2D_DONNEES", str(DEFAULT_C2D_DONNEES)))
    marc_dir = Path(os.environ.get("MARC_ATLAS_DIR", str(DEFAULT_MARC_DIR)))
    if not c2d_dir.exists():
        raise SystemExit(f"SHOM C2D ASCII not found at {c2d_dir}; extract C2D.7z first")
    if not marc_dir.exists():
        raise SystemExit(f"MARC atlases not found at {marc_dir}; run build_marc_atlas.py first")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Reading SHOM C2D from {c2d_dir}")
    zones = load_c2d_directory(c2d_dir)
    print(f"  {len(zones)} zones, {sum(len(z.points) for z in zones)} points total")

    print(f"Reading MARC atlases from {marc_dir}")
    marc = MarcAtlasRegistry.from_directory(marc_dir)
    if not marc.atlases:
        raise SystemExit("MARC registry empty — build/marc has no metadata.json files")

    # ---------- 1. Reference ports table -----------------------------------
    seen_ports: dict[str, str] = {}  # key -> ref_tide
    for zone in zones:
        key = _normalise_port(zone.ref_port)
        seen_ports[key] = zone.ref_tide

    ports_json: dict[str, dict] = {}
    for key, ref_tide in sorted(seen_ports.items()):
        if key not in REF_PORT_COORDS:
            raise SystemExit(
                f"Unknown reference port {key!r} not in REF_PORT_COORDS; "
                f"add its WGS84 coords to scripts/build_shom_c2d.py"
            )
        lat, lon, display = REF_PORT_COORDS[key]
        try:
            constants = _extract_marc_constants(marc, lat, lon, REF_CONSTITUENTS)
        except RuntimeError as exc:
            print(f"  WARN: {key} — {exc}; skipping constants")
            constants = {}
        if not constants:
            raise SystemExit(
                f"No MARC constants extracted for {key} at ({lat}, {lon}). "
                f"Check the port coords are inside a MARC emprise."
            )
        ports_json[key] = {
            "display_name": display,
            "lat": lat,
            "lon": lon,
            "ref_tide": ref_tide,
            "constants": constants,
        }
        print(f"  {key:24s}  {ref_tide}  {len(constants)} constituents")

    ports_path = OUT_DIR / "shom_c2d_ref_ports.json"
    ports_path.write_text(json.dumps(ports_json, ensure_ascii=False, indent=2))
    print(f"Wrote {ports_path}")

    # ---------- 2. Flat points Parquet -------------------------------------
    rows: list[dict[str, object]] = []
    for zone in zones:
        ref_key = _normalise_port(zone.ref_port)
        for p in zone.points:
            rows.append(
                {
                    "atlas_id": zone.atlas_id,
                    "zone": zone.name,
                    "ref_port_key": ref_key,
                    "ref_tide": zone.ref_tide,
                    "lat": p.lat,
                    "lon": p.lon,
                    "u_ve_kn": list(p.u_ve_kn),
                    "v_ve_kn": list(p.v_ve_kn),
                    "u_me_kn": list(p.u_me_kn),
                    "v_me_kn": list(p.v_me_kn),
                }
            )

    df = pl.DataFrame(rows)
    # Cast numeric columns to compact dtypes — float32 for U/V series is
    # plenty given the 0.1 kt source quantization, int8 for atlas_id.
    df = df.with_columns(
        # Int16 fits the 557..565 atlas-id range; Int8 maxes at 127.
        pl.col("atlas_id").cast(pl.Int16),
        pl.col("lat").cast(pl.Float32),
        pl.col("lon").cast(pl.Float32),
        pl.col("u_ve_kn").cast(pl.List(pl.Float32)),
        pl.col("v_ve_kn").cast(pl.List(pl.Float32)),
        pl.col("u_me_kn").cast(pl.List(pl.Float32)),
        pl.col("v_me_kn").cast(pl.List(pl.Float32)),
    )

    points_path = OUT_DIR / "shom_c2d_points.parquet"
    df.write_parquet(points_path, compression="zstd", compression_level=9)
    print(f"Wrote {points_path}  ({df.height} rows, {points_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
