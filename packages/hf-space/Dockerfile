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

RUN pip install /app/data-adapters /app/mcp-core

COPY app.py /app/app.py

EXPOSE 7860

CMD ["python", "/app/app.py"]
