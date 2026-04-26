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

import os

import uvicorn
from mcp.server.transport_security import TransportSecuritySettings
from openwind_mcp_core import build_server
from starlette.applications import Starlette
from starlette.responses import HTMLResponse
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
  <title>OpenWind MCP</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
           max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    .tag { color: #666; font-size: 0.95rem; margin-top: 0; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
    pre { background: rgba(127,127,127,0.12); padding: 0.85rem 1rem; border-radius: 8px; overflow-x: auto; }
    a { color: #1a6dff; }
    ul { padding-left: 1.25rem; }
    .badge { display: inline-block; padding: 0.1rem 0.55rem; border-radius: 999px;
             background: rgba(34,139,230,0.12); color: #228be6; font-size: 0.78rem;
             font-weight: 600; letter-spacing: 0.02em; vertical-align: middle; }
  </style>
</head>
<body>
  <h1>⛵ OpenWind MCP <span class="badge">running</span></h1>
  <p class="tag">Mediterranean sailing planner — Model Context Protocol server.</p>

  <p>Four tools for an LLM client to plan a coastal passage:
    <code>list_boat_archetypes</code>, <code>get_marine_forecast</code>,
    <code>estimate_passage</code>, <code>score_complexity</code>.
    Wind &amp; sea data via <a href="https://open-meteo.com">Open-Meteo</a> (keyless).</p>

  <h2>Connect from an MCP client</h2>
  <p>Add this URL to any client that accepts an HTTP MCP endpoint
    (Claude Desktop, Claude.ai connector, Goose, Continue, Zed, …):</p>
  <pre><code>https://qdonnars-openwind-mcp.hf.space/mcp</code></pre>

  <h2>Try it</h2>
  <p>Once connected, ask your LLM something like:</p>
  <blockquote>
    <em>Je pars demain matin de Marseille pour Porquerolles avec un Sun Odyssey 36.
    Bonne idée&nbsp;? Tu as combien de temps de route et quelle complexité&nbsp;?</em>
  </blockquote>

  <h2>Source &amp; docs</h2>
  <ul>
    <li>Project site: <a href="https://openwind.fr">openwind.fr</a></li>
    <li>GitHub: <a href="https://github.com/qdonnars/openwind">qdonnars/openwind</a> (MIT)</li>
  </ul>

  <p style="color: #888; font-size: 0.85rem; margin-top: 2.5rem;">
    First request after inactivity may take a few seconds (HF Spaces cold-start).
  </p>
</body>
</html>
"""


async def _index(_request) -> HTMLResponse:
    return HTMLResponse(LANDING_HTML)


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
    mcp_app = server.streamable_http_app()
    app = Starlette(
        routes=[
            Route("/", _index),
            Mount("/", app=mcp_app),
        ]
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
