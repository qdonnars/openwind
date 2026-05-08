FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Vendored copies of the two local packages, populated by the sync workflow
# before push (see .github/workflows/sync-hf-space.yml). On HF, these are the
# code shipped to the Space repo — there is no monorepo context.
COPY vendor/data-adapters /app/data-adapters
COPY vendor/mcp-core /app/mcp-core

RUN pip install /app/data-adapters /app/mcp-core "uvicorn[standard]>=0.30" \
    "huggingface_hub[hf_xet]>=0.24"

# Pull the MARC PREVIMER atlases at build time. The dataset is private so we
# need an HF token with read access. On HF Spaces, define the secret in
# Settings -> Variables and secrets -> Secrets:
#   HF_TOKEN  (User Access Token with read scope on Qdonnars/openwind-tidal-atlas)
# Runtime reads it back via MARC_ATLAS_DIR (set below).
ARG HF_DATASET_ID=Qdonnars/openwind-tidal-atlas
ENV MARC_ATLAS_DIR=/app/data/marc-atlas
RUN --mount=type=secret,id=HF_TOKEN,required=false \
    bash -c '\
if [ -f /run/secrets/HF_TOKEN ]; then \
    export HF_TOKEN="$(cat /run/secrets/HF_TOKEN)"; \
    python -c "import os; from huggingface_hub import snapshot_download; \
               snapshot_download(\"${HF_DATASET_ID}\", repo_type=\"dataset\", \
                                 local_dir=\"${MARC_ATLAS_DIR}\", token=os.environ[\"HF_TOKEN\"])"; \
    echo \"MARC dataset cached at ${MARC_ATLAS_DIR}\"; \
    ls \"${MARC_ATLAS_DIR}\"; \
else \
    echo \"WARNING: no HF_TOKEN secret mounted; skipping MARC dataset download\"; \
    echo \"plan_passage will fall back to Open-Meteo SMOC only\"; \
    mkdir -p \"${MARC_ATLAS_DIR}\"; \
fi'

COPY app.py /app/app.py

EXPOSE 7860

CMD ["python", "/app/app.py"]
