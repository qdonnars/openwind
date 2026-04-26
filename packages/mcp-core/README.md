# openwind-mcp-core

Cloud-agnostic FastMCP server for OpenWind. Exposes 4 tools:

- `list_boat_archetypes` — descriptive list, no server-side mapping
- `get_marine_forecast` — wind + sea around a point/window
- `estimate_passage` — per-segment timing along a polyline
- `score_complexity` — 1-5 difficulty score

`build_server()` is the single factory; no Gradio, no `huggingface_hub`. The
HF Spaces wrapper (Sprint 4) and any future deployment use the same factory.

## Local install

```bash
cd packages/mcp-core
uv sync --extra dev
uv run pytest
```

## Wire to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). On Linux, Claude
Desktop is not officially supported — use Claude Code (CLI) MCP config or any
other MCP client (Goose, Continue, Zed) that accepts a stdio command.

```json
{
  "mcpServers": {
    "openwind": {
      "command": "uv",
      "args": [
        "--directory",
        "/ABSOLUTE/PATH/TO/openwind/packages/mcp-core",
        "run",
        "python",
        "scripts/run_local.py"
      ]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/openwind` with your local repo path. Restart the
client. The four tools should appear under the `openwind` server.

### Sanity check (without a chat client)

```bash
cd packages/mcp-core
uv run python -c "
import asyncio
from openwind_mcp_core import build_server

async def main():
    server = build_server()
    tools = await server.list_tools()
    print([t.name for t in tools])

asyncio.run(main())
"
```

Expected output:

```
['list_boat_archetypes', 'get_marine_forecast', 'estimate_passage', 'score_complexity']
```

### Smoke conversation prompt

Once wired, ask the client something like:

> Je pars demain matin de Marseille pour Porquerolles avec un Sun Odyssey 36.
> Bonne idée ? Tu as combien de temps de route et quelle complexité ?

The client should call `list_boat_archetypes` (to map → `cruiser_40ft`),
`get_marine_forecast` for one or more points, then `estimate_passage`,
then `score_complexity`, and narrate the result.

> First request after inactivity may incur ~5s of cold-start once deployed
> on HF Spaces. Local stdio has no cold-start.

## Tests

```bash
uv run pytest -q
```

Six tests cover the factory, tool registration, and the four tool surfaces
against a stub adapter.
