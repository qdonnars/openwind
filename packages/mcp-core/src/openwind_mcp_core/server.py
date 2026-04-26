"""FastMCP server factory.

`build_server()` returns a `FastMCP` instance with all tools registered. It is
cloud-agnostic: no Gradio, no `huggingface_hub`. The HF Spaces wrapper, the
local stdio runner, and any future deployment all import this same factory.

Tools exposed (V1):

1. ``list_boat_archetypes`` — descriptive list for LLM mapping ("Sun Odyssey 32"
   → ``cruiser_30ft``). No server-side mapping table.
2. ``get_marine_forecast`` — wind+sea around a point/window for one or more models.
3. ``plan_passage`` — single-shot end-to-end: timing along the polyline,
   1-5 complexity score, rendered HTML widget, and openwind.fr deep-link.
   Replaces the previous trio (``estimate_passage`` + ``score_complexity`` +
   ``render_passage_widget``) — one call, one Open-Meteo fetch, one round-trip.

Typical orchestration pattern (LLM perspective):

* Call ``list_boat_archetypes`` once at the start of the conversation, map the
  user's commercial model from ``examples`` + ``length_ft`` + ``type``.
* For an "A → B" question, call ``plan_passage`` ONCE with the waypoints,
  departure, and chosen archetype. Use ``model="auto"`` so the server picks
  AROME (≤48 h) → ICON-EU (≤5 d) → GFS (≤16 d) automatically — the chosen
  model is reflected in ``passage.model``.
* The response includes a ready-to-display ``html`` (render it inline if your
  host supports HTML) and an ``openwind_url`` (use as a fallback CTA on
  text-only clients).
* ``get_marine_forecast`` is the escape hatch for sea-state lookup or model
  comparison — not needed for the typical "A → B by date X" question.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any

from mcp.server.fastmcp import FastMCP
from openwind_data.adapters.base import MarineDataAdapter
from openwind_data.adapters.openmeteo import AUTO_MODEL, OpenMeteoAdapter
from openwind_data.routing import (
    Point,
    list_archetypes,
)
from openwind_data.routing import (
    estimate_passage as _estimate_passage,
)
from openwind_data.routing import (
    score_complexity as _score_complexity,
)

from .render import build_openwind_url, render_passage


def _archetype_summary(p: Any) -> dict[str, Any]:
    return {
        "name": p.name,
        "length_ft": p.length_ft,
        "type": p.type,
        "category": p.category,
        "performance_class": p.performance_class,
        "examples": list(p.examples),
    }


def _passage_to_dict(report: Any) -> dict[str, Any]:
    """asdict() but with datetimes serialized to ISO strings."""
    d = asdict(report)
    d["departure_time"] = report.departure_time.isoformat()
    d["arrival_time"] = report.arrival_time.isoformat()
    for seg, out in zip(report.segments, d["segments"], strict=True):
        out["start_time"] = seg.start_time.isoformat()
        out["end_time"] = seg.end_time.isoformat()
    return d


def build_server(*, adapter: MarineDataAdapter | None = None) -> FastMCP:
    """Build a FastMCP server with all OpenWind tools registered.

    Args:
        adapter: optional `MarineDataAdapter` used by data-fetching tools.
            Defaults to a process-wide `OpenMeteoAdapter`. Override in tests.
    """
    server: FastMCP = FastMCP("openwind")
    fetch_adapter: MarineDataAdapter = adapter or OpenMeteoAdapter()

    @server.tool()
    def list_boat_archetypes() -> list[dict[str, Any]]:
        """List the 5 boat archetypes with descriptive metadata.

        The LLM (or user) maps a commercial model (e.g. "Sun Odyssey 32") to one
        of these archetypes from the metadata — there is no server-side mapping.
        """
        return [_archetype_summary(p) for p in list_archetypes()]

    @server.tool()
    async def get_marine_forecast(
        lat: float,
        lon: float,
        start: str,
        end: str,
        models: list[str] | None = None,
    ) -> dict[str, Any]:
        """Fetch wind (and sea, when available) for a point and time window.

        Args:
            lat: latitude in degrees.
            lon: longitude in degrees.
            start: ISO-8601 datetime, timezone-aware (e.g. "2026-05-01T06:00:00+00:00").
            end: ISO-8601 datetime, timezone-aware.
            models: optional list of model names; defaults to AROME for the Med.

        Note: the first request after inactivity may incur ~5s of cold-start.
        """
        start_dt = datetime.fromisoformat(start)
        end_dt = datetime.fromisoformat(end)
        bundle = await fetch_adapter.fetch(lat, lon, start_dt, end_dt, models=models)
        return {
            "lat": bundle.lat,
            "lon": bundle.lon,
            "start": bundle.start.isoformat(),
            "end": bundle.end.isoformat(),
            "requested_at": bundle.requested_at.isoformat(),
            "wind": {
                model: [
                    {
                        "time": p.time.isoformat(),
                        "speed_kn": p.speed_kn,
                        "direction_deg": p.direction_deg,
                        "gust_kn": p.gust_kn,
                    }
                    for p in series.points
                ]
                for model, series in bundle.wind_by_model.items()
            },
            "sea": [
                {
                    "time": p.time.isoformat(),
                    "wave_height_m": p.wave_height_m,
                    "wave_period_s": p.wave_period_s,
                    "wave_direction_deg": p.wave_direction_deg,
                }
                for p in bundle.sea.points
            ],
        }

    @server.tool()
    async def plan_passage(
        waypoints: list[dict[str, float]],
        departure: str,
        archetype: str,
        efficiency: float = 0.75,
        segment_length_nm: float = 10.0,
        model: str = AUTO_MODEL,
        max_hs_m: float | None = None,
        render: bool = True,
        boat_name: str | None = None,
        leg_titles: list[str] | None = None,
        locale: str = "fr",
        timezone: str = "Europe/Paris",
    ) -> dict[str, Any]:
        """Plan an A→B passage end-to-end: timing + complexity + widget + deep-link.

        ONE call gives you everything for the typical "leaving Marseille for
        Porquerolles tomorrow on a 30-footer" question. The server fetches
        Open-Meteo once, computes the passage, scores its complexity from the
        same report (no double-fetch), renders the HTML widget, and builds the
        openwind.fr deep-link.

        ## Returned payload

        - ``passage``: per-segment timing report (distance_nm, duration_h,
          model used, segments[] with TWS/TWA/boat_speed/Hs, warnings).
        - ``complexity``: 1-5 difficulty score with wind/sea breakdown and a
          human-readable rationale.
        - ``html``: ready-to-display widget HTML (~5 KB, self-contained, dark
          mode aware). Always populated when ``render=True`` (default).
        - ``openwind_url``: ALWAYS present. Deep-link to openwind.fr/plan that
          re-renders the same passage server-side.

        ## How to display

        Render ``html`` inline if your host client supports HTML — emit it as
        a fenced ``html`` code block (Claude, ChatGPT, Cursor) or pass it to
        artifact / show_widget. On text-only clients (Le Chat, Goose, terminal),
        skip the HTML and present ``openwind_url`` as a "View full plan →"
        link in your prose answer.

        ## Args

            waypoints: list of ``{"lat": ..., "lon": ...}`` dicts (>=2). Caller
                keeps the polyline off land — add intermediate waypoints to
                skirt capes and peninsulas.
            departure: ISO-8601 datetime, timezone-aware.
            archetype: one of ``list_boat_archetypes()`` names.
            efficiency: multiplier on polar speed. ``0.85`` racing, ``0.75``
                cruising (default), ``0.65`` loaded family cruising, ``0.55``
                heavy seas / fouled hull.
            segment_length_nm: target sub-segment length. Default 10 nm
                balances precision vs Open-Meteo budget; drop to 5 for tight
                coastal work, raise to 20 for long offshore legs.
            model: wind model. Default ``"auto"`` tries AROME (≤48 h) →
                ICON-EU (≤5 d) → GFS (≤16 d). Pass an explicit name to bypass.
            max_hs_m: optional max significant wave height (meters) over the
                route — pass it if you have a sea-state estimate from
                ``get_marine_forecast`` and want it factored into the score.
                Defaults to wind-only scoring.
            render: if True (default), populate ``html`` with the rendered
                widget. Set to False on clients that don't display HTML at all,
                to save ~1500 tokens of context.
            boat_name: optional commercial name (e.g. ``"OTAGO III"``);
                prepended to the widget's boat line.
            leg_titles: optional human-friendly per-leg titles (e.g.
                ``["Sortie rade", "Cap Sicié → Grand Ribaud"]``). Falls back
                to ``"Leg N · wpN → wpN+1"`` for missing entries.
            locale: ``"fr"`` (default) or ``"en"`` — drives widget label text
                and date format.
            timezone: IANA tz for time display in the widget (default
                ``"Europe/Paris"``).

        ## Failure modes

        Raises ``ForecastHorizonError`` if the chosen model's horizon doesn't
        cover the passage and ``model != "auto"``. The error message names the
        failing model and suggests longer-range alternatives.
        """
        pts = [Point(w["lat"], w["lon"]) for w in waypoints]
        dep = datetime.fromisoformat(departure)

        report = await _estimate_passage(
            pts,
            dep,
            archetype,
            efficiency=efficiency,
            segment_length_nm=segment_length_nm,
            adapter=fetch_adapter,
            model=model,
        )
        score = _score_complexity(report, max_hs_m=max_hs_m)

        passage_dict = _passage_to_dict(report)
        complexity_dict = asdict(score)

        html: str | None = None
        if render:
            html = render_passage(
                passage_dict,
                complexity_dict,
                waypoints=waypoints,
                boat_name=boat_name,
                leg_titles=leg_titles,
                locale=locale,
                timezone=timezone,
            )

        return {
            "passage": passage_dict,
            "complexity": complexity_dict,
            "html": html,
            "openwind_url": build_openwind_url(waypoints, departure, archetype),
        }

    return server
