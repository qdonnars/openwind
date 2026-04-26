---
title: OpenWind MCP
emoji: ⛵
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Mediterranean sailing planner — talk to your LLM, cast off with confidence.
---

# OpenWind MCP ⛵

> **Talk to your LLM. Cast off with confidence.**
>
> Turns any MCP-capable assistant into a Mediterranean passage planner.
> Free, keyless, open source.

![OpenWind passage plan rendered in the web app](https://raw.githubusercontent.com/qdonnars/openwind/main/docs/screenshots/widget-preview.png)

---

## Try it in 30 seconds

**1.** In your MCP client, add the endpoint:

```
https://qdonnars-openwind-mcp.hf.space/mcp
```

**2.** Ask, in your own words:

> *"I'm leaving Marseille tomorrow morning for Porquerolles on a Sun Odyssey
> 36. How long is the passage and how tricky is it?"*

**3.** Your assistant calls the OpenWind tools, renders an inline preview
card, and hands you a deep-link to the full plan on
[openwind.fr](https://openwind.fr). No account. No API key. No credit card.

> **First time with MCP?** Pick your client on
> [modelcontextprotocol.io/clients](https://modelcontextprotocol.io/clients),
> then follow the
> [remote-server quickstart](https://modelcontextprotocol.io/docs/develop/connect-remote-servers).
> Works with Claude Desktop, Le Chat, Cursor, Goose, Zed, Continue, and any
> other MCP-compatible host.

## Why OpenWind

- **Free & keyless** — wind + sea data via [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- **Mediterranean-tuned** — AROME 1.3 km by default, catches thermals & mistral. ICON-EU / GFS for longer reach.
- **Boat-aware** — 5 archetypes, real polars, `efficiency` knob for trim and crew level.
- **Client-agnostic** — one HTTP MCP endpoint, no vendor lock-in.
- **Open source, MIT** — self-host on Fly, Modal, your VPS in minutes.

## Five tools

| Tool                      | What it does                                                              |
|---------------------------|---------------------------------------------------------------------------|
| `list_boat_archetypes`    | Five descriptive archetypes; the LLM maps "Sun Odyssey 36" → `cruiser_30ft`. |
| `get_marine_forecast`     | Wind + sea around a point/window, multi-model.                            |
| `estimate_passage`        | Per-segment timing along a polyline of waypoints.                         |
| `score_complexity`        | 1–5 difficulty score from wind (and optional max wave height).            |
| `read_me`                 | Hands the client a self-contained HTML widget for inline rendering.       |

## About this Space

> ⚠️ This Space uses the **Docker SDK** (not Gradio). It does **not** carry
> the HF MCP badge and isn't listed in
> `huggingface.co/spaces?filter=mcp-server`. Discoverability lives at
> [openwind.fr](https://openwind.fr) instead.

**Source of truth:** <https://github.com/qdonnars/openwind>. This Space is
auto-deployed by GitHub Actions from `packages/hf-space/` on `main`. Don't
commit directly to the Space repo — your changes will be overwritten at the
next push.

The Space wrapper is intentionally minimal (~20 lines in `app.py`). All logic
lives in `openwind-mcp-core` and `openwind-data` upstream — re-deployable on
Fly, Modal, or a VPS by writing a different wrapper.

## Cold-start

Free CPU-basic hardware sleeps after 48 h of inactivity. First request after
sleep takes ~5 s to wake. Acceptable for V1 (cf.
[plan decision #4](https://github.com/qdonnars/openwind/blob/main/plan/04-backlog.md)).

## License

MIT.
