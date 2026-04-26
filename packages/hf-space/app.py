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

  <h2>Try it in 30 seconds</h2>
  <ol>
    <li>In your MCP client, add the endpoint:
      <pre><code>https://qdonnars-openwind-mcp.hf.space/mcp</code></pre></li>
    <li>Ask, in your own words:
      <blockquote>I'm leaving Marseille tomorrow morning for Porquerolles on a Sun Odyssey 36.
        How long is the passage and how tricky is it?</blockquote></li>
    <li>Your assistant calls the OpenWind tools, renders an inline preview card,
      and hands you a deep-link to the full plan on
      <a href="https://openwind.fr">openwind.fr</a>. No account. No API key.</li>
  </ol>

  <h2>New to MCP?</h2>
  <p>It takes 2 minutes. Pick your client on
    <a href="https://modelcontextprotocol.io/clients">modelcontextprotocol.io/clients</a>,
    then follow the
    <a href="https://modelcontextprotocol.io/docs/develop/connect-remote-servers">remote-server quickstart</a>.
    Works with Claude Desktop, Le Chat, Cursor, Goose, Zed, Continue, and any
    other MCP-compatible host.</p>

  <h2>Why OpenWind</h2>
  <ul class="perks">
    <li><strong>Free &amp; keyless.</strong> Wind + sea via
      <a href="https://open-meteo.com">Open-Meteo</a> (CC BY 4.0).</li>
    <li><strong>Mediterranean-tuned.</strong> AROME 1.3 km by default — catches thermals &amp; mistral.</li>
    <li><strong>Boat-aware.</strong> Five archetypes, real polars, an <code>efficiency</code> knob.</li>
    <li><strong>Client-agnostic.</strong> One HTTP MCP endpoint. No vendor lock-in.</li>
    <li><strong>Open source, MIT.</strong> Self-host on Fly, Modal, your VPS.</li>
  </ul>

  <h2>Six tools</h2>
  <p><code>list_boat_archetypes</code>, <code>get_marine_forecast</code>,
    <code>estimate_passage</code>, <code>score_complexity</code>,
    <code>render_passage_widget</code> (returns ready-to-display HTML),
    <code>read_me</code> (template + instructions, fallback for clients
    that customise rendering).</p>

  <h2>Source</h2>
  <p>Project site: <a href="https://openwind.fr">openwind.fr</a> &middot;
    GitHub: <a href="https://github.com/qdonnars/openwind">qdonnars/openwind</a>
    (MIT).</p>

  <p class="footnote">First request after inactivity may take a few seconds
    (HF Spaces cold-start).</p>
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
            Mount("/", app=mcp_app),
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
