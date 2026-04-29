"""HF Space entry point — serves the OpenWind FastMCP server over HTTP.

This wrapper is intentionally thin. All tools live in ``openwind_mcp_core``
(which itself imports ``openwind_data``). Re-deploying on Fly/Modal/VPS = a
different Dockerfile that runs the same ``build_server()`` factory.

Transport: ``streamable-http`` on port 7860 (HF Spaces default). Clients
connect to ``https://qdonnars-openwind-mcp.hf.space``. (Custom domain
``mcp.openwind.fr`` deferred — HF gates custom domains behind PRO; see
``plan/04-backlog.md``.)

Trade-off explicitly accepted (cf. ``plan/04-backlog.md``): HF Docker SDK
Spaces do not get the ``MCP`` badge or the one-click connector flow that
Gradio ``mcp_server=True`` Spaces get. Discoverability is via the project
website, not via the HF catalog. Re-evaluate if traffic plateaus.
"""

from __future__ import annotations

import dataclasses
import os
from datetime import UTC, datetime
from typing import Any

import uvicorn
from mcp.server.transport_security import TransportSecuritySettings
from openwind_data.adapters.base import ForecastHorizonError
from openwind_data.routing.archetypes import list_archetypes_metadata
from openwind_data.routing.complexity import score_complexity
from openwind_data.routing.geometry import Point
from openwind_data.routing.passage import (
    _build_conditions_summary,
    estimate_passage,
    estimate_passage_windows,
)
from openwind_mcp_core import build_server
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Mount, Route

PORT = 7860

# FastMCP's streamable-http transport ships DNS-rebinding protection that
# rejects any Host header outside ``localhost`` by default — on HF that
# manifests as 421 "Invalid Host header" with the Space hostname. The Space
# is fronted by HF's TLS proxy which we already authorize via
# ``proxy_headers``, so we extend the allowed-hosts list to include the
# Space hostname (overridable via env for future custom domains / migrations).
DEFAULT_ALLOWED_HOSTS = [
    "qdonnars-openwind-mcp.hf.space",
]
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("OPENWIND_ALLOWED_HOSTS", ",".join(DEFAULT_ALLOWED_HOSTS)).split(",")
    if h.strip()
]


LANDING_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OpenWind MCP — talk to your LLM, cast off with confidence</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #FAF7EE;
      --card: #FFFFFF;
      --text: #1A1A1A;
      --muted: #4A4A4A;
      --faint: #777169;
      --border: #E2DDCD;
      --accent: #1D9E75;
      --soft: #F1ECDF;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #15140F;
        --card: rgba(255,255,255,0.04);
        --text: #F2F2F2;
        --muted: #B8B5AC;
        --faint: #888780;
        --border: rgba(255,255,255,0.10);
        --accent: #2BBE93;
        --soft: rgba(255,255,255,0.06);
      }
    }
    * { box-sizing: border-box; }
    body {
      font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      max-width: 44rem; margin: 0 auto; padding: 3rem 1.25rem 4rem;
      background: var(--bg); color: var(--text);
    }
    h1 { font-size: 2rem; margin: 0 0 0.5rem; letter-spacing: -0.01em; }
    .lede { font-size: 1.15rem; color: var(--muted); margin: 0 0 2rem; line-height: 1.45; }
    h2 { font-size: 1.15rem; margin: 2.25rem 0 0.75rem; letter-spacing: -0.005em; }
    p { margin: 0.6rem 0; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    code { font-size: 0.92em; background: var(--soft); padding: 0.1rem 0.35rem; border-radius: 4px; }
    pre { background: var(--card); border: 1px solid var(--border); padding: 0.85rem 1rem;
          border-radius: 10px; overflow-x: auto; margin: 0.75rem 0; }
    pre code { background: none; padding: 0; font-size: 0.95em; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .hero {
      display: block; width: 100%; max-width: 100%; height: auto;
      border-radius: 12px; border: 1px solid var(--border);
      margin: 1rem 0 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .badge {
      display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px;
      background: var(--soft); color: var(--accent); font-size: 0.75rem;
      font-weight: 600; letter-spacing: 0.04em; vertical-align: middle;
      text-transform: uppercase;
    }
    blockquote {
      margin: 0.75rem 0; padding: 0.75rem 1rem; border-left: 3px solid var(--accent);
      background: var(--soft); border-radius: 0 8px 8px 0; color: var(--muted);
      font-style: italic;
    }
    ol { padding-left: 1.25rem; line-height: 1.7; }
    ol li { margin: 0.4rem 0; }
    .perks { display: grid; grid-template-columns: 1fr; gap: 0.5rem; margin: 1rem 0; padding: 0; list-style: none; }
    .perks li { padding: 0.65rem 0.9rem; background: var(--card); border: 1px solid var(--border);
                border-radius: 8px; font-size: 0.95rem; }
    .perks strong { color: var(--text); }
    details.connector {
      background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      margin: 0.6rem 0; overflow: hidden;
    }
    details.connector summary {
      cursor: pointer; padding: 0.85rem 1rem; font-weight: 600; list-style: none;
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    }
    details.connector summary::-webkit-details-marker { display: none; }
    details.connector summary::after {
      content: "›"; color: var(--faint); font-size: 1.4rem; line-height: 1;
      transition: transform 0.15s ease; transform-origin: center;
    }
    details.connector[open] summary::after { transform: rotate(90deg); }
    details.connector[open] summary { border-bottom: 1px solid var(--border); }
    details.connector ol { padding: 0.85rem 1rem 1rem 2.25rem; margin: 0; }
    details.connector ol li { margin: 0.45rem 0; }
    details.connector pre { margin: 0.5rem 0; }
    .footnote { color: var(--faint); font-size: 0.85rem; margin-top: 2.5rem; }
  </style>
</head>
<body>
  <h1>OpenWind MCP <span class="badge">running</span></h1>
  <p class="lede">Talk to your LLM. Cast off with confidence.<br>
    A free, keyless, open-source Mediterranean passage planner — exposed as an
    MCP server, so any compatible assistant can use it.</p>

  <img class="hero" src="https://raw.githubusercontent.com/qdonnars/openwind/main/docs/screenshots/plan.png"
       alt="OpenWind passage plan: 5 waypoints, 48.6 nm, ETA 21:24, complexity 3 of 5.">

  <h2>Connect it to your assistant</h2>
  <p>Pick yours below — under a minute, no install, no API key.</p>

  <details class="connector">
    <summary>Claude (claude.ai)</summary>
    <ol>
      <li>Open <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">claude.ai → Settings → Connectors</a>.</li>
      <li>Scroll to the bottom and click <strong>Add custom connector</strong>.</li>
      <li>Set <strong>Name</strong>: <code>OpenWind</code>.</li>
      <li>Paste this in <strong>Remote MCP server URL</strong>:
        <pre><code>https://qdonnars-openwind-mcp.hf.space/mcp</code></pre></li>
      <li>Click <strong>Add</strong>. In any new chat, OpenWind shows up in the
        <strong>Search and tools</strong> menu — toggle it on.</li>
    </ol>
  </details>

  <details class="connector">
    <summary>Le Chat (Mistral)</summary>
    <ol>
      <li>Open <a href="https://chat.mistral.ai" target="_blank" rel="noopener">chat.mistral.ai</a> and sign in.</li>
      <li>In the left sidebar, click <strong>Connectors</strong>, then <strong>Add MCP server</strong>.</li>
      <li>Set <strong>Name</strong>: <code>OpenWind</code> · <strong>Auth</strong>: <code>None</code>.</li>
      <li>Paste this in <strong>URL</strong>:
        <pre><code>https://qdonnars-openwind-mcp.hf.space/mcp</code></pre></li>
      <li>Save, then enable the OpenWind toggle inside any conversation.</li>
    </ol>
  </details>

  <details class="connector">
    <summary>ChatGPT (OpenAI)</summary>
    <ol>
      <li>Requires ChatGPT <strong>Pro</strong>, Business, or Enterprise (custom connectors).</li>
      <li>Open <a href="https://chatgpt.com/#settings/Connectors" target="_blank" rel="noopener">ChatGPT → Settings → Connectors</a>.</li>
      <li>In <strong>Advanced</strong>, turn on <strong>Developer mode</strong>.</li>
      <li>Back in <strong>Connectors</strong>, click <strong>Create</strong>.</li>
      <li>Set <strong>Name</strong>: <code>OpenWind</code> · <strong>Authentication</strong>: <code>No authentication</code>.</li>
      <li>Paste this in <strong>MCP server URL</strong>:
        <pre><code>https://qdonnars-openwind-mcp.hf.space/mcp</code></pre></li>
      <li>Trust the connector and save. Activate it in a chat via
        <strong>+ → Developer connectors → OpenWind</strong>.</li>
    </ol>
  </details>

  <h2>Then ask, in your own words</h2>
  <blockquote>I'm leaving Marseille tomorrow morning for Porquerolles on a Sun Odyssey 36.
    How long is the passage and how tricky is it?</blockquote>
  <p>Your assistant calls the OpenWind tools, renders an inline preview card, and hands
    you a deep-link to the full plan on <a href="https://openwind.fr">openwind.fr</a>.</p>

  <h2>Why OpenWind</h2>
  <ul class="perks">
    <li><strong>Free &amp; keyless.</strong> Wind + sea via
      <a href="https://open-meteo.com">Open-Meteo</a> (CC BY 4.0).</li>
    <li><strong>Mediterranean-tuned.</strong> AROME 1.3 km by default — catches thermals &amp; mistral.</li>
    <li><strong>Boat-aware.</strong> Five archetypes, real polars, an <code>efficiency</code> knob.</li>
    <li><strong>Client-agnostic.</strong> One HTTP MCP endpoint. No vendor lock-in.</li>
    <li><strong>Open source, MIT.</strong> Self-host on Fly, Modal, your VPS.</li>
  </ul>

  <h2>Three tools</h2>
  <p><code>list_boat_archetypes</code>, <code>get_marine_forecast</code>,
    and <code>plan_passage</code> — the workhorse: one call returns timing,
    1-5 complexity score, a ready-to-display HTML widget, and a deep-link
    to the full plan on openwind.fr.</p>

  <h2>Source</h2>
  <p>Project site: <a href="https://openwind.fr">openwind.fr</a> &middot;
    GitHub: <a href="https://github.com/qdonnars/openwind">qdonnars/openwind</a>
    (MIT).</p>

  <p class="footnote">First request after inactivity may take a few seconds
    (HF Spaces cold-start).</p>
</body>
</html>
"""


def _to_json(obj: Any) -> Any:
    """Recursively convert dataclasses and datetimes to JSON-serializable types."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: _to_json(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, (tuple, list)):
        return [_to_json(v) for v in obj]
    return obj


async def _index(_request) -> HTMLResponse:
    return HTMLResponse(LANDING_HTML)


async def _api_archetypes(_request: Request) -> JSONResponse:
    return JSONResponse(list_archetypes_metadata())


async def _api_passage(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON body"}, status_code=422)

    missing = [k for k in ("waypoints", "departure", "archetype") if body.get(k) is None]
    if missing:
        return JSONResponse({"error": f"missing fields: {missing}"}, status_code=422)

    try:
        departure = datetime.fromisoformat(body["departure"])
    except (ValueError, TypeError) as exc:
        return JSONResponse({"error": f"invalid departure: {exc}"}, status_code=422)

    try:
        waypoints = [Point(lat=float(w[0]), lon=float(w[1])) for w in body["waypoints"]]
    except (TypeError, IndexError, ValueError) as exc:
        return JSONResponse({"error": f"invalid waypoints: {exc}"}, status_code=422)

    if len(waypoints) < 2:
        return JSONResponse({"error": "at least 2 waypoints required"}, status_code=422)

    efficiency: float = body.get("efficiency", 0.75)
    try:
        efficiency = float(efficiency)
    except (TypeError, ValueError) as exc:
        return JSONResponse({"error": f"invalid efficiency: {exc}"}, status_code=422)

    # Sweep mode — triggered when ``latest_departure`` is provided.
    latest_raw = body.get("latest_departure")
    if latest_raw is not None:
        try:
            latest_departure = datetime.fromisoformat(latest_raw)
        except (ValueError, TypeError) as exc:
            return JSONResponse({"error": f"invalid latest_departure: {exc}"}, status_code=422)
        try:
            sweep_interval = int(body.get("sweep_interval_hours", 1))
        except (TypeError, ValueError) as exc:
            return JSONResponse({"error": f"invalid sweep_interval_hours: {exc}"}, status_code=422)

        target_eta_raw = body.get("target_eta")
        target_eta_dt: datetime | None = None
        if target_eta_raw is not None:
            try:
                target_eta_dt = datetime.fromisoformat(target_eta_raw)
            except (ValueError, TypeError) as exc:
                return JSONResponse({"error": f"invalid target_eta: {exc}"}, status_code=422)

        try:
            reports = await estimate_passage_windows(
                waypoints, departure, latest_departure, body["archetype"],
                sweep_interval_hours=sweep_interval, efficiency=efficiency, model="auto",
            )
        except KeyError as exc:
            return JSONResponse({"error": f"unknown archetype: {exc}"}, status_code=422)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=422)
        except ForecastHorizonError as exc:
            return JSONResponse({"error": str(exc)}, status_code=422)

        # Sweep is partial-tolerant: estimate_passage_windows skips windows
        # that hit ForecastHorizonError. Compute the expected count to surface
        # a meta-warning if some were dropped.
        from datetime import timedelta as _td
        expected_windows = (
            int((latest_departure - departure).total_seconds() / 3600 / sweep_interval) + 1
        )
        skipped_count = max(0, expected_windows - len(reports))

        windows: list[dict[str, Any]] = []
        for report in reports:
            score = score_complexity(report)
            windows.append({
                "departure": report.departure_time.isoformat(),
                "arrival": report.arrival_time.isoformat(),
                "duration_h": round(report.duration_h, 2),
                "distance_nm": round(report.distance_nm, 1),
                "complexity": {
                    "level": score.level,
                    "label": score.label,
                    "tws_max_kn": round(score.tws_max_kn, 1),
                    "rationale": score.rationale,
                },
                "conditions_summary": _build_conditions_summary(report),
                "warnings": list(report.warnings) + [w.message for w in score.warnings],
            })

        meta_warnings: list[str] = []
        if skipped_count > 0:
            meta_warnings.append(
                f"{skipped_count} fenêtre(s) ignorée(s) faute de couverture météo "
                f"(horizon dépassé) — affichage des {len(windows)} restantes."
            )
        if target_eta_dt is not None:
            tol = _td(hours=2).total_seconds()
            target_utc = target_eta_dt.astimezone(UTC)
            filtered = [
                w for w in windows
                if abs((datetime.fromisoformat(w["arrival"]) - target_utc).total_seconds()) <= tol
            ]
            if not filtered:
                meta_warnings.append(
                    f"aucune fenêtre n'arrive dans ±2h de target_eta={target_eta_raw} ; "
                    f"toutes les {len(windows)} fenêtres retournées"
                )
            else:
                windows = filtered

        return JSONResponse({
            "mode": "multi_window",
            "sweep": {
                "earliest": departure.isoformat(),
                "latest": latest_departure.isoformat(),
                "interval_hours": sweep_interval,
                "window_count": len(windows),
            },
            "windows": windows,
            "meta_warnings": meta_warnings,
            "forecast_updated_at": datetime.now(UTC).isoformat(),
        })

    # Single mode — unchanged.
    try:
        passage = await estimate_passage(
            waypoints, departure, body["archetype"], efficiency=efficiency, model="auto"
        )
    except KeyError as exc:
        return JSONResponse({"error": f"unknown archetype: {exc}"}, status_code=422)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)
    except ForecastHorizonError as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)

    complexity = score_complexity(passage)

    return JSONResponse({
        "passage": _to_json(passage),
        "complexity": _to_json(complexity),
        "forecast_updated_at": datetime.now(UTC).isoformat(),
    })


def main() -> None:
    server = build_server()
    server.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=ALLOWED_HOSTS,
    )
    # FastMCP only mounts ``/mcp``; wrap with a parent Starlette so visiting
    # the Space root returns a human-readable landing page instead of 404.
    # Order matters: the exact-match ``/`` route is tried before the catch-all
    # ``Mount("/")`` so MCP traffic on ``/mcp`` is unaffected.
    #
    # Critically, FastMCP's session manager is started/stopped by the inner
    # app's lifespan. A parent Starlette does NOT propagate child lifespans,
    # so we must hand the inner lifespan to the parent — without this the MCP
    # endpoint returns 500 because the streamable-http session manager never
    # initialised.
    mcp_app = server.streamable_http_app()
    app = Starlette(
        routes=[
            Route("/", _index),
            Route("/api/v1/archetypes", _api_archetypes, methods=["GET"]),
            Route("/api/v1/passage", _api_passage, methods=["POST"]),
            Mount("/", app=mcp_app),
        ],
        middleware=[
            Middleware(
                CORSMiddleware,
                allow_origins=["*"],
                allow_methods=["GET", "POST", "OPTIONS"],
                allow_headers=["Content-Type"],
            )
        ],
        lifespan=mcp_app.router.lifespan_context,
    )
    # Run uvicorn explicitly (rather than ``server.run(transport=...)``) so we
    # can enable ``proxy_headers``/``forwarded_allow_ips``. HF terminates TLS
    # at the edge; without these flags ASGI sees ``http`` + the internal Host
    # and emits broken redirects.
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
