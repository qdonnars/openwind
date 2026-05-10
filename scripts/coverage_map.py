"""Render a coverage map of MARC PREVIMER + SHOM Atlas C2D zones.

Reads ``build/marc/<atlas>/coverage.geojson`` for each MARC atlas (each is
a single polygon bbox built by ``scripts/build_marc_atlas.py``) and walks
``build/c2d/C2D/CD_COURANTS2D/DONNEES/<atlas_id>/<ZONE>_<atlas_id>`` for
SHOM C2D zones (each is a scattered point cloud whose bbox we derive
from the parsed points).

Output: a single PNG at ``docs/coverage_map.png`` with two subplots —
left = SHOM C2D zones, right = MARC atlases — over a France/Atlantic
extent. Each zone is shown as a translucent rectangle with its label.

Run from repo root::

    uv run --project packages/data-adapters --with matplotlib \\
        python scripts/coverage_map.py

The output PNG is gitignored (lives under ``docs/screenshots/`` style
tree); rerun whenever atlases change.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
from matplotlib.figure import Figure

from openwind_data.currents.shom_c2d import load_c2d_directory

REPO_ROOT = Path(__file__).resolve().parents[1]
MARC_ROOT = REPO_ROOT / "build" / "marc"
C2D_DONNEES = REPO_ROOT / "build" / "c2d" / "C2D" / "CD_COURANTS2D" / "DONNEES"
OUT_PATH = REPO_ROOT / "docs" / "coverage_map.png"

# Plot extent: France métropole + a generous margin to show offshore atlases.
EXTENT = (-7.5, 3.5, 42.0, 52.5)  # (lon_min, lon_max, lat_min, lat_max)

# Colour-by-atlas. MARC ranks: 0 = wide (2 km), 1 = shelf (700 m), 2 = coastal (250 m).
MARC_COLORS = {
    "ATLNE": "#9ecae1",   # light blue, wide NE Atlantique 2 km
    "MANGA": "#6baed6",   # mid blue, Manche/shelf 700 m
    "MANE": "#4292c6",    # darker blue, Manche est 700 m
    "MANW": "#2171b5",    # darker, Manche ouest 700 m
    "FINIS": "#08519c",   # darkest blue, Finistère 250 m
    "SUDBZH": "#08306b",  # darkest, Bretagne sud 250 m
    "AQUI": "#3182bd",    # blue, Aquitaine 700 m
}

# SHOM atlas number → display name + colour.
SHOM_COLORS = {
    557: ("Pas de Calais", "#fee5d9"),
    558: ("Bretagne sud", "#a50f15"),
    559: ("Vendée-Gironde", "#fc9272"),
    560: ("Iroise / Brest", "#cb181d"),
    561: ("Baie de Seine", "#fcae91"),
    562: ("Golfe Normand-Breton", "#ef3b2c"),
    563: ("Bretagne nord", "#99000d"),
    564: ("Manche", "#fb6a4a"),
    565: ("Gascogne", "#67000d"),
}


def _bbox_from_geojson(path: Path) -> tuple[float, float, float, float] | None:
    """Return ``(lat_min, lon_min, lat_max, lon_max)`` from a Polygon GeoJSON.

    The MARC coverage.geojson is always a single Polygon feature in
    decimal-degree WGS84; we shrink to the bbox. Returns ``None`` if the
    file is missing or malformed (silently skipped — printed on stderr by
    the caller).
    """
    if not path.exists():
        return None
    payload = json.loads(path.read_text())
    feats = payload.get("features", [])
    if not feats:
        return None
    coords = feats[0]["geometry"]["coordinates"][0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return (min(lats), min(lons), max(lats), max(lons))


def _add_box(
    ax: plt.Axes,
    bbox: tuple[float, float, float, float],
    *,
    color: str,
    alpha: float,
    label: str | None,
) -> None:
    lat_min, lon_min, lat_max, lon_max = bbox
    rect = mpatches.Rectangle(
        (lon_min, lat_min),
        lon_max - lon_min,
        lat_max - lat_min,
        linewidth=0.8,
        edgecolor=color,
        facecolor=color,
        alpha=alpha,
        label=label,
    )
    ax.add_patch(rect)


def _setup_axes(ax: plt.Axes, title: str) -> None:
    lon_min, lon_max, lat_min, lat_max = EXTENT
    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)
    ax.set_aspect("equal", adjustable="box")
    ax.grid(True, color="lightgray", linewidth=0.4, alpha=0.6)
    ax.set_xlabel("Longitude (°E)")
    ax.set_ylabel("Latitude (°N)")
    ax.set_title(title, fontsize=12)
    # Loose France outline reference: just label key reference cities so the
    # eye anchors. Avoids cartopy as a heavy dep.
    cities = {
        "Brest": (-4.49, 48.39),
        "La Rochelle": (-1.15, 46.16),
        "Bordeaux": (-0.58, 44.84),
        "Cherbourg": (-1.62, 49.65),
        "Marseille": (5.37, 43.30),
    }
    for name, (lon, lat) in cities.items():
        ax.plot(lon, lat, marker="o", color="black", markersize=2.5)
        ax.annotate(
            name,
            (lon, lat),
            xytext=(3, 3),
            textcoords="offset points",
            fontsize=7,
            color="dimgray",
        )


def _render_marc(ax: plt.Axes) -> None:
    _setup_axes(ax, "MARC PREVIMER (Ifremer)")
    plot_lon_min, plot_lon_max, plot_lat_min, plot_lat_max = EXTENT
    for atlas_dir in sorted(MARC_ROOT.iterdir()):
        if not atlas_dir.is_dir():
            continue
        bbox = _bbox_from_geojson(atlas_dir / "coverage.geojson")
        if bbox is None:
            continue
        color = MARC_COLORS.get(atlas_dir.name, "gray")
        _add_box(ax, bbox, color=color, alpha=0.30, label=None)
        # Anchor the label at the centre of the bbox CLIPPED to plot extent
        # — many MARC atlases (ATLNE, MANGA, AQUI) extend well beyond the
        # visible map and the raw bbox-centroid would land off-screen.
        clipped_lon = (
            max(bbox[1], plot_lon_min) + min(bbox[3], plot_lon_max)
        ) / 2
        clipped_lat = (
            max(bbox[0], plot_lat_min) + min(bbox[2], plot_lat_max)
        ) / 2
        ax.text(
            clipped_lon, clipped_lat, atlas_dir.name,
            ha="center", va="center",
            fontsize=8, color=color, weight="bold", alpha=0.9,
        )


def _render_shom(ax: plt.Axes) -> None:
    _setup_axes(ax, "SHOM Atlas C2D (édition 2005)")
    if not C2D_DONNEES.exists():
        ax.text(
            0.5, 0.5, "SHOM C2D not extracted\n(see build/c2d/)",
            transform=ax.transAxes, ha="center", va="center", fontsize=10, color="red",
        )
        return
    zones = load_c2d_directory(C2D_DONNEES)
    drawn_atlases: set[int] = set()
    legend_handles: list[mpatches.Patch] = []
    for zone in zones:
        # Drop the all-Manche general zone 564 — its bbox spans -6.5°W to +3°E
        # over 290 points and would visually swamp every other zone. The
        # cartouches BARFLEUR_561, etc. cover the same area at finer detail
        # and tell the actual coverage story.
        if zone.atlas_id == 564 and zone.name == "MANCHE":
            continue
        # Same for 565 GASCOGNE (low-resolution Bay of Biscay general).
        if zone.atlas_id == 565 and zone.name == "GASCOGNE":
            continue
        # And the wide BRETAGNE_SUD_558 / VENDEE_GIRONDE_559 / BRETAGNE_NORD_563
        # general zones — we want the cartouches.
        if zone.name in {"BRETAGNE_SUD", "VENDEE_GIRONDE", "BRETAGNE_NORD"}:
            continue
        bbox = zone.bbox
        label_name, color = SHOM_COLORS.get(zone.atlas_id, (str(zone.atlas_id), "gray"))
        new_atlas = zone.atlas_id not in drawn_atlases
        _add_box(ax, bbox, color=color, alpha=0.45, label=None)
        if new_atlas:
            legend_handles.append(
                mpatches.Patch(facecolor=color, alpha=0.45, label=f"{zone.atlas_id} {label_name}")
            )
            drawn_atlases.add(zone.atlas_id)
    ax.legend(
        handles=legend_handles, loc="lower left", fontsize=7, framealpha=0.85,
        ncol=2, title="Atlas SHOM C2D",
    )


def render_coverage_map() -> Figure:
    fig, axes = plt.subplots(1, 2, figsize=(14, 8))
    _render_shom(axes[0])
    _render_marc(axes[1])
    fig.suptitle(
        "Couverture des atlas de courants — SHOM C2D vs MARC PREVIMER",
        fontsize=14,
        weight="bold",
    )
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    return fig


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fig = render_coverage_map()
    fig.savefig(OUT_PATH, dpi=140, bbox_inches="tight")
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
