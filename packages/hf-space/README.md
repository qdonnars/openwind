---
title: OpenWind MCP
emoji: ⛵
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Mediterranean sailing planner — MCP server (FastMCP, HTTP).
---

# OpenWind MCP

FastMCP server exposing 4 tools for Mediterranean sailing passage planning:

- `list_boat_archetypes` — descriptive list of 5 boat archetypes
- `get_marine_forecast` — wind + sea around a point/window (Open-Meteo, keyless)
- `estimate_passage` — per-segment timing along a polyline of waypoints
- `score_complexity` — 1-5 difficulty score from wind (and optional Hs)

## Connect from an MCP client

This Space serves MCP over **streamable HTTP** at the Space URL (or
`mcp.openwind.fr` once the custom domain is wired). Add it to any MCP-capable
client that accepts an HTTP MCP endpoint.

> ⚠️ This Space uses the **Docker SDK** (not Gradio). It does **not** carry
> the HF MCP badge and is not listed in `huggingface.co/spaces?filter=mcp-server`.
> See [openwind.fr](https://openwind.fr) for setup instructions.

## Source

Single source of truth: <https://github.com/qdonnars/openwind>. This Space is a
mirror auto-deployed by GitHub Actions from `packages/hf-space/` on `main`. Do
not commit directly to the Space repo — changes will be overwritten.

## Architecture

The Space wrapper is intentionally minimal (`app.py`, ~10 lines). All logic
lives upstream in `openwind-mcp-core` and `openwind-data` — re-deployable on
Fly/Modal/VPS by writing a different wrapper.

## Cold-start

Free CPU-basic hardware sleeps after 48 h of inactivity. First request after
sleep takes ~5 s to wake. Acceptable for V1 (cf. plan decision #4).

## License

MIT.
