# openwind-data

Pure Python domain logic for OpenWind: marine data adapters, polars, routing, complexity scoring.

Cloud-agnostic — no dependency on Gradio, FastMCP, or any deployment runtime. Reused by `openwind-mcp-core` and any future deployment wrapper.

## Install (dev)

```bash
uv sync --all-extras
```

## Test

```bash
uv run pytest
```

## Lint & format

```bash
uv run ruff check .
uv run ruff format .
```
