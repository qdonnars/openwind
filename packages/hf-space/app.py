"""HF Space entry point — serves the OpenWind FastMCP server over HTTP.

This wrapper is intentionally thin. All tools live in ``openwind_mcp_core``
(which itself imports ``openwind_data``). Re-deploying on Fly/Modal/VPS = a
different Dockerfile that runs the same ``build_server()`` factory.

Transport: ``streamable-http`` on port 7860 (HF Spaces default). Clients
connect to ``https://mcp.openwind.fr/mcp`` (custom domain) or to the
default ``qdonnars-openwind-mcp.hf.space`` URL.

Trade-off explicitly accepted (cf. ``plan/04-backlog.md``): HF Docker SDK
Spaces do not get the ``MCP`` badge or the one-click connector flow that
Gradio ``mcp_server=True`` Spaces get. Discoverability is via the project
website, not via the HF catalog. Re-evaluate if traffic plateaus.
"""

from __future__ import annotations

from openwind_mcp_core import build_server

PORT = 7860


def main() -> None:
    server = build_server()
    server.settings.host = "0.0.0.0"
    server.settings.port = PORT
    server.run(transport="streamable-http")


if __name__ == "__main__":
    main()
