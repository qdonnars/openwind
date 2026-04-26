"""FastMCP server factory.

`build_server()` returns a `FastMCP` instance with all tools registered. It is
cloud-agnostic: no Gradio, no `huggingface_hub`. The HF Spaces wrapper, the
local stdio runner, and any future deployment all import this same factory.

Tools exposed (V1):

1. ``list_boat_archetypes`` — descriptive list for LLM mapping ("Sun Odyssey 32"
   → ``cruiser_30ft``). No server-side mapping table.
2. ``get_marine_forecast`` — wind+sea around a point/window for one or more models.
3. ``estimate_passage`` — per-segment timing along a polyline for a given
   archetype + departure time.
4. ``score_complexity`` — 1-5 difficulty score from a passage + optional Hs max.
5. ``render_passage_widget`` — server-side render of the passage widget to
   final HTML. Fast path: substitution happens in Python, the LLM doesn't
   regenerate ~5 KB of markup token by token.
6. ``read_me`` — returns the HTML template + rendering instructions for
   clients/LLMs that want to substitute placeholders themselves (fallback,
   debugging, customisation). Client-agnostic (no Claude CSS-variable
   coupling — palette switches via ``prefers-color-scheme``).

Typical orchestration pattern (LLM perspective):

* Call ``list_boat_archetypes`` once at the start of the conversation, map the
  user's commercial model from ``examples`` + ``length_ft`` + ``type``.
* Then loop ``estimate_passage`` (and optionally ``score_complexity``) over
  candidate departure windows. Use ``model="auto"`` so the server picks
  AROME (≤48 h) → ICON-EU (≤5 d) → GFS (≤16 d) automatically — the chosen
  model is reflected in ``PassageReport.model``.
* ``get_marine_forecast`` is the lower-level escape hatch for sea-state lookup
  or model comparison; you don't need it for the typical "A → B by date X"
  question.
* Sea state (``Hs``): pass ``max_hs_m`` to ``score_complexity`` if you read it
  from a forecast and want it factored into the difficulty score.
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

from .render import render_passage
from .widget import PASSAGE_WIDGET_INSTRUCTIONS


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
    async def estimate_passage(
        waypoints: list[dict[str, float]],
        departure: str,
        archetype: str,
        efficiency: float = 0.75,
        segment_length_nm: float = 10.0,
        model: str = AUTO_MODEL,
    ) -> dict[str, Any]:
        """Estimate passage timing along a polyline.

        Args:
            waypoints: list of ``{"lat": ..., "lon": ...}`` dicts (>=2). The
                caller is responsible for keeping the polyline off land —
                add intermediate waypoints to skirt capes and peninsulas.
            departure: ISO-8601 datetime, timezone-aware.
            archetype: one of ``list_boat_archetypes()`` names.
            efficiency: multiplier on polar speed. Reference values:
                ``0.85`` racing trim, ``0.75`` cruising (default), ``0.65``
                loaded family cruising, ``0.55`` heavy seas / fouled hull.
            segment_length_nm: target sub-segment length. Default 10 nm
                balances precision against Open-Meteo request budget; drop
                to 5 for tight coastal work, raise to 20 for long offshore
                legs.
            model: wind model. Default ``"auto"`` tries AROME (≤48 h) →
                ICON-EU (≤5 d) → GFS (≤16 d). The actually-chosen model is
                returned in ``model``. Pass an explicit name to bypass.

        On horizon overflow, raises a ``ForecastHorizonError`` whose message
        names the failing model and suggests longer-range alternatives.
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
        return _passage_to_dict(report)

    @server.tool()
    async def score_complexity(
        waypoints: list[dict[str, float]],
        departure: str,
        archetype: str,
        max_hs_m: float | None = None,
        efficiency: float = 0.75,
        segment_length_nm: float = 10.0,
        model: str = AUTO_MODEL,
    ) -> dict[str, Any]:
        """Score a passage on a 1-5 difficulty scale (wind + optional sea).

        Computes the passage internally. Pass ``max_hs_m`` if you have a
        sea-state estimate from ``get_marine_forecast`` and want it factored
        into the score; otherwise the score is wind-only.

        Same ``model`` semantics as ``estimate_passage`` (default ``"auto"``).
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
        return asdict(score)

    @server.tool()
    def render_passage_widget(
        passage: dict[str, Any],
        complexity: dict[str, Any] | None = None,
        waypoints: list[dict[str, float]] | None = None,
        boat_name: str | None = None,
        leg_titles: list[str] | None = None,
        locale: str = "fr",
        timezone: str = "Europe/Paris",
    ) -> str:
        """Render the passage widget to final, self-contained HTML.

        Pass the dicts returned by ``estimate_passage`` and (optionally)
        ``score_complexity``. The server substitutes every placeholder, picks
        complexity colours, formats dates/durations, and returns ~5 KB of
        ready-to-display HTML. The LLM either relays the string verbatim or
        hands it to the host client's artifact / show_widget capability.

        Prefer this over manually substituting the ``read_me`` template —
        deterministic, ~10x faster, no formatting mistakes.

        Args:
            passage: dict from ``estimate_passage``.
            complexity: dict from ``score_complexity``. If omitted, the
                complexity card renders empty (score "-", bars unfilled).
            waypoints: original user waypoints for the deep-link URL. If
                omitted, derived from segment endpoints (less accurate when
                segments were sub-divided).
            boat_name: optional commercial name (e.g. ``"OTAGO III"``);
                prepended to the boat line.
            leg_titles: optional human-friendly per-leg titles (e.g.
                ``["Sortie rade", "Cap Sicié → Grand Ribaud"]``). Falls back to
                ``"Leg N · wpN → wpN+1"`` for missing entries.
            locale: ``"fr"`` (default) or ``"en"`` — drives label text and
                date format.
            timezone: IANA tz for time display (default ``"Europe/Paris"``).
        """
        return render_passage(
            passage,
            complexity,
            waypoints=waypoints,
            boat_name=boat_name,
            leg_titles=leg_titles,
            locale=locale,
            timezone=timezone,
        )

    @server.tool()
    def read_me() -> str:
        """Return the OpenWind passage-widget rendering instructions.

        Fallback for clients/LLMs that want to substitute placeholders
        themselves (e.g. to customise the rendering, or for debugging).
        For the standard flow, prefer ``render_passage_widget`` — it does the
        substitution server-side and returns final HTML directly, avoiding
        ~3 minutes of token-by-token regeneration.

        The template adapts to light / dark mode automatically via
        ``prefers-color-scheme`` — no client-specific CSS variables.
        """
        return PASSAGE_WIDGET_INSTRUCTIONS

    return server
