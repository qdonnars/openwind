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

import uvicorn
from openwind_mcp_core import build_server

PORT = 7860


def main() -> None:
    # Run uvicorn explicitly (rather than ``server.run(transport=...)``) so we
    # can enable ``proxy_headers``/``forwarded_allow_ips``. HF Spaces front
    # the container with a TLS-terminating reverse proxy; without these flags
    # FastMCP's ASGI app sees ``http`` + the internal Host header and emits
    # broken 307 redirects (``http://...:443/mcp/``) that the edge then
    # answers with 421 Misdirected Request.
    app = build_server().streamable_http_app()
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
