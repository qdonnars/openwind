# openwind-mcp-core

Cloud-agnostic FastMCP server for OpenWind. Exposes 4 tools:

- `list_boat_archetypes` — descriptive list, no server-side mapping
- `get_marine_forecast` — wind + sea around a point/window
- `plan_passage` — end-to-end timing + complexity + HTML widget + deep-link, optional multi-window sweep
- `read_me` — calculation methodology (polars, efficiency, VMG, defaults)

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
['read_me', 'list_boat_archetypes', 'get_marine_forecast', 'plan_passage']
```

### Smoke conversation prompt

Once wired, ask the client something like:

> Je pars demain matin de Marseille pour Porquerolles avec un Sun Odyssey 36.
> Bonne idée ? Tu as combien de temps de route et quelle complexité ?

The client should call `list_boat_archetypes` (to map → `cruiser_40ft`)
then `plan_passage` once with the waypoints, departure, and chosen archetype.
The single response includes timing, complexity, a rendered HTML widget,
and a deep-link to openwind.fr.

> First request after inactivity may incur ~5s of cold-start once deployed
> on HF Spaces. Local stdio has no cold-start.

## Tests

```bash
uv run pytest -q
```

Six tests cover the factory, tool registration, and the four tool surfaces
against a stub adapter.

## Calculation method

The simulation engine lives in `openwind_data.routing.passage`. Defaults below are what `plan_passage` uses unless overridden.

- **Polar lookup** — 5 ORC-style archetypes, bilinear interpolation in (TWS, TWA), clamped at grid edges. TWA symmetric on [0°, 180°].
- **Efficiency 0.75** by default (cruising). Override via the `efficiency` arg: `0.85` racing, `0.65` loaded family, `0.55` heavy seas / fouled hull.
- **VMG / tacking correction** — when route TWA < optimal upwind angle (~42-48°), effective speed = `polar(opt_TWA) × cos(opt_TWA − route_TWA)`. Models a sailor who tacks instead of pinching.
- **Wave derate** — opt-in via `use_wave_correction`: `max(0.5, 1 − 0.05 × Hs^1.75 × cos²(TWA/2))`. Off by default; sea state feeds warnings instead.
- **Single-pass timing** — heuristic 6 kn → segment mid-times → real polar at each mid-time's wind. No convergence iteration.
- **Sub-segments** — routes split into ~10 nm chunks for weather sampling.
- **Multi-window sweep** — `plan_passage(latest_departure=...)` runs N hourly simulations from the same fetched weather; cap 14 d × 24 h = 336 windows.
- **Default model** — AROME 1.3 km (Med thermals); auto-falls back to ICON-EU → GFS for longer horizons.
- **Mediterranean simplifications** — tides and currents ignored (negligible in V1).

Full rationale and references in the [main README's calculation section](../../README.md#calculation-method).
