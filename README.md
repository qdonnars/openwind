# OpenWind ⛵

> **Talk to your LLM. Cast off with confidence.**
>
> OpenWind turns any MCP-capable assistant — Claude, Le Chat, Cursor, Goose,
> Zed, Continue — into a Mediterranean passage planner. Ask in plain
> language. Get a per-leg ETA, a 1‑5 complexity score, and a deep-link to
> the full plan. Free, keyless, open source.

[**openwind.fr**](https://openwind.fr) · [`mcp.openwind.fr`](https://qdonnars-openwind-mcp.hf.space/) · MIT

![OpenWind passage plan rendered in the web app](docs/screenshots/widget-preview.png)

---

## Try it in 30 seconds

**1.** Open your MCP client and add the endpoint:

```
https://qdonnars-openwind-mcp.hf.space/mcp
```

**2.** Ask, in your own words:

> *"Demain matin, Marseille → Porquerolles, sur un Sun Odyssey 36. Bonne
> idée ? Combien de temps et c'est tendu comment ?"*

**3.** Your assistant calls four tools, renders an inline preview card, and
hands you a deep-link to the full plan on [openwind.fr](https://openwind.fr).
That's it. No account. No API key. No credit card.

> **First time with MCP?** It takes 2 minutes. Pick your client on
> [modelcontextprotocol.io/clients](https://modelcontextprotocol.io/clients),
> then follow the
> [remote-server quickstart](https://modelcontextprotocol.io/docs/develop/connect-remote-servers).
> Claude Desktop users can start with the
> [user quickstart](https://modelcontextprotocol.io/quickstart/user).

## Why OpenWind

|                              |                                                                                              |
|------------------------------|----------------------------------------------------------------------------------------------|
| 🆓 **Free, keyless**         | Wind & sea via [Open-Meteo](https://open-meteo.com) (CC BY 4.0). No account, no API key.     |
| 🌊 **Mediterranean-tuned**   | Defaults to AROME 1.3 km — catches thermals, mistral, tramontane. Falls back to ICON-EU/GFS. |
| ⛵ **Boat-aware**             | Five archetypes from racer-cruiser to bluewater, real polars, an `efficiency` knob.          |
| 🔌 **Client-agnostic**        | One HTTP MCP endpoint. Works in Claude Desktop, Le Chat, Cursor, Goose, Zed, Continue, …     |
| 🛠️ **Open source, MIT**       | Self-host on Fly, Modal, your VPS — `mcp-core` is deployment-agnostic. The HF Space is one wrapper among many. |

## What the LLM sees

Five MCP tools, all async, all keyless:

| Tool                      | What it does                                                              |
|---------------------------|---------------------------------------------------------------------------|
| `list_boat_archetypes`    | Five descriptive archetypes; the LLM maps "Sun Odyssey 36" → `cruiser_30ft` itself. |
| `get_marine_forecast`     | Wind + sea around a point/window, multi-model.                            |
| `estimate_passage`        | Per-segment timing along a polyline of waypoints.                         |
| `score_complexity`        | 1–5 difficulty score from wind (and optional max wave height).            |
| `read_me`                 | Hands the client a self-contained HTML widget for inline rendering.       |

The widget switches palette via `prefers-color-scheme` — looks right in light
and dark hosts, no Claude-specific CSS variables, no vendor lock-in.

## Architecture

```
packages/
├── data-adapters/   # pure domain logic (forecast adapters, polars, routing, complexity)
├── mcp-core/        # FastMCP server (cloud-agnostic, no Gradio, no HF deps)
├── hf-space/        # ~20-line Docker wrapper for Hugging Face Spaces
└── web/             # React 19 + Vite app deployed to GitHub Pages (openwind.fr)
```

`mcp-core` stays deployment-agnostic. Re-deploying on Fly, Modal, or a VPS is
a different `Dockerfile` calling the same `build_server()`. See
[docs/architecture.md](docs/architecture.md).

## Run locally

```bash
# Tests + lint (data-adapters & mcp-core, Python via uv)
cd packages/mcp-core
uv sync --all-extras
uv run pytest -x -q
uv run ruff check .

# Local HTTP MCP smoke
cd packages/hf-space
uv run python app.py   # serves :7860 — point any MCP client at /mcp

# Web app (openwind.fr)
cd packages/web
npm install
npm run dev            # vite dev server
npm run build          # outputs packages/web/dist
```

## V1 scope

Wind, sea (`Hs` max), per-leg ETA, 1–5 complexity. Tides and currents ignored
on the Med (negligible). No automatic routing optimisation — the LLM and the
human stay in the loop. Roadmap and scope decisions live in
[`plan/`](plan/) (local).

## Credits

Wind & sea: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Hosting:
[Hugging Face Spaces](https://huggingface.co/spaces). Map tiles on
[openwind.fr](https://openwind.fr): [CARTO](https://carto.com/) /
[OpenStreetMap](https://www.openstreetmap.org/copyright).

## License

[MIT](LICENSE).
