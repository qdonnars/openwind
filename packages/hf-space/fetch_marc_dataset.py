"""Pull MARC PREVIMER atlases from the HF Dataset at Docker build time.

Reads ``HF_TOKEN`` (mounted as a build secret), ``HF_DATASET_ID`` and
``MARC_ATLAS_DIR`` from the environment. Falls back gracefully (no MARC
data, runtime uses Open-Meteo SMOC) if the token is absent — this lets
contributors build the image without an HF account.
"""
from __future__ import annotations

import os
import sys


def main() -> None:
    target = os.environ.get("MARC_ATLAS_DIR", "/app/data/marc-atlas")
    dataset_id = os.environ.get("HF_DATASET_ID", "Qdonnars/openwind-tidal-atlas")
    token = os.environ.get("HF_TOKEN")

    if not token:
        print("WARNING: HF_TOKEN not set, skipping MARC dataset download")
        print("plan_passage will fall back to Open-Meteo SMOC only")
        os.makedirs(target, exist_ok=True)
        return

    from huggingface_hub import snapshot_download

    print(f"Fetching {dataset_id} -> {target}")
    snapshot_download(dataset_id, repo_type="dataset", local_dir=target, token=token)
    atlases = sorted(p for p in os.listdir(target) if not p.startswith("."))
    print(f"MARC dataset cached at {target}")
    print(f"Atlases: {atlases}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR fetching MARC dataset: {exc}", file=sys.stderr)
        # Don't fail the build — runtime will fall back to Open-Meteo SMOC.
        os.makedirs(os.environ.get("MARC_ATLAS_DIR", "/app/data/marc-atlas"), exist_ok=True)
