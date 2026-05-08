#!/usr/bin/env bash
# Loop wrapper around build_marc_atlas.py for the 6 atlases beyond FINIS.
# Assumes NetCDFs are already cached in ~/openwind-marc-explore/.
# Sources .env from repo root for IFREMER_FTP_* and HF_TOKEN.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
CACHE=${CACHE_DIR:-$HOME/openwind-marc-explore}
BUILD_ROOT=${BUILD_ROOT:-./build/marc}

set -a; source "$REPO/.env"; set +a

ATLASES=("ATLNE" "MANGA" "MANW" "MANE" "SUDBZH" "AQUI")

for ATLAS in "${ATLASES[@]}"; do
  OUT="$BUILD_ROOT/$ATLAS"
  echo
  echo "##############################################"
  echo "## $ATLAS  ->  $OUT"
  echo "##############################################"
  rm -rf "$OUT"
  uv run \
    --with xarray --with h5netcdf --with netCDF4 \
    --with scipy --with polars --with pyarrow \
    --with shapely --with rasterio \
    --with huggingface_hub --with torch \
    --with-editable "$REPO/packages/data-adapters" \
    "$REPO/scripts/build_marc_atlas.py" \
      --atlas "$ATLAS" \
      --cache-dir "$CACHE" \
      --output-dir "$OUT" \
      --validate \
      ${PUSH:+--push}
done
echo
echo "All atlases built."
