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
* The response includes a ready-to-display ``html``: inject it verbatim in
  your response — no markdown code-block fence, no reformatting. Use
  ``openwind_url`` as fallback on text-only clients.
* ``get_marine_forecast`` is the escape hatch for sea-state lookup or model
  comparison — not needed for the typical "A → B by date X" question.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

from mcp.server.fastmcp import FastMCP
from openwind_data.adapters.base import MarineDataAdapter
from openwind_data.adapters.openmeteo import AUTO_MODEL, OpenMeteoAdapter
from openwind_data.routing import (
    Point,
    _build_conditions_summary,
    list_archetypes,
)
from openwind_data.routing import (
    estimate_passage as _estimate_passage,
)
from openwind_data.routing import (
    estimate_passage_windows as _estimate_passage_windows,
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


_METHODOLOGY = """\
# OpenWind — Calculation method

How `plan_passage` simulates a passage. Defaults below are what the server
uses unless overridden by tool parameters.

## Polar speed model

- 5 ORC-style archetypes (cruiser_30ft / cruiser_40ft / cruiser_50ft /
  racer_cruiser / catamaran_40ft).
- Lookup is bilinear interpolation in (TWS, TWA), clamped at grid edges.
- TWA symmetric on [0, 180] only (no port/starboard distinction).

## Boat speed adjustments

- Efficiency factor (default 0.75): ORC polars are theoretical maxima;
  real cruising loses ~25% (sail trim, comfort margins, helm, untracked
  currents). Override per call: 0.85 racing, 0.65 loaded family cruising,
  0.55 heavy seas / fouled hull.

- VMG / tacking correction: when route TWA is below the boat's optimal
  upwind angle (typically ~42-48 deg), the simulator assumes the sailor
  tacks at the optimal VMG angle. Effective speed toward destination =
  polar(opt_TWA) * cos(opt_TWA - route_TWA). At dead upwind this reduces
  to polar(opt) * cos(opt) ~= polar / sqrt(2). At route_TWA=20 deg with
  opt=45 deg, the reduction is only cos(25 deg) ~= 0.91 (much less penalty).

- Wave derate (opt-in): max(0.5, 1 - 0.05 * Hs^1.75 * cos^2(TWA/2)).
  Off by default; sea state feeds the warning bar instead of slowing.

- Minimum boat speed: 0.5 kn floor to avoid blow-up in extreme stalls.

## Timing

- Single-pass approximation: a 6 kn heuristic estimates segment mid-times,
  then real polar speeds are computed at each mid-time's actual wind. No
  convergence iteration. Bias bounded by Mediterranean wind correlation.
- Routes split into ~10 nm sub-segments by default for weather sampling.

## Multi-window sweep mode

`plan_passage` accepts an optional `latest_departure` to sweep N hourly
departure windows over the same route. Weather is fetched once (cache
prewarm), simulations are in-memory. Hard cap: 14 d x 24 h = 336 windows.
Returns a list of windows; the LLM picks qualitatively (no server-side
ranking).

## Mediterranean defaults

- Tides ignored (< 40 cm, negligible vs forecast uncertainty).
- Currents ignored (Liguro-Provencal too weak / variable for V1).
- Wind model: AROME 1.3 km (<= 48 h horizon, captures thermals and local
  winds). Auto-falls back to ICON-EU (<= 5 d) -> GFS (<= 16 d).
- Wave model: Open-Meteo Marine (significant Hs, period, direction).

## What is NOT modelled (V1)

- No automatic routing optimisation (LLM + human choose).
- No coastal acceleration zones (caller adds intermediate waypoints).
- No port/starboard polar asymmetry, no spinnaker-specific curves.
- No hull condition modelling beyond the `efficiency` knob.
"""


def _build_window_dict(report: Any, score: Any, waypoints_raw: list[dict[str, float]]) -> dict[str, Any]:
    dep_iso = report.departure_time.isoformat()
    warnings = list(report.warnings) + [w.message for w in score.warnings]
    return {
        "departure": dep_iso,
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
        "warnings": warnings,
        "openwind_url": build_openwind_url(waypoints_raw, dep_iso, report.archetype),
    }


def build_server(*, adapter: MarineDataAdapter | None = None) -> FastMCP:
    """Build a FastMCP server with all OpenWind tools registered.

    Args:
        adapter: optional `MarineDataAdapter` used by data-fetching tools.
            Defaults to a process-wide `OpenMeteoAdapter`. Override in tests.
    """
    server: FastMCP = FastMCP("openwind")
    fetch_adapter: MarineDataAdapter = adapter or OpenMeteoAdapter()

    @server.tool()
    def read_me() -> str:
        """Return OpenWind's calculation methodology as Markdown.

        Call this when the user asks how passage timing, complexity, or
        boat speed are computed (e.g. "comment c'est calculé ?",
        "what assumptions does the model use?", "is tacking modelled?").

        The returned text covers: polar lookup, default efficiency 0.75,
        VMG / tacking correction, wave derate, single-pass timing,
        multi-window sweep semantics, Mediterranean simplifications
        (tides, currents), and what is intentionally NOT modelled in V1.
        """
        return _METHODOLOGY

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
        latest_departure: str | None = None,
        sweep_interval_hours: int = 1,
        target_eta: str | None = None,
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

        **IMPORTANT — inject ``html`` verbatim, no wrapper.**
        Copy the exact string from ``result["html"]`` into your response as-is.
        Do NOT wrap it in a markdown code block (no ```html``` fence) — that
        prevents rendering. Do NOT reconstruct or reformat the widget manually.
        On text-only clients (terminal, Le Chat), skip ``html`` and present
        ``openwind_url`` as a "View full plan →" link instead.

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

        ## Sweep mode (latest_departure set)

        When ``latest_departure`` is provided, the tool sweeps departure times
        from ``departure`` to ``latest_departure`` every ``sweep_interval_hours``
        (default 1 h). Returns ``{"mode": "multi_window", "sweep": {...},
        "windows": [...]}`` instead of the single-passage payload. Each window
        contains ``departure``, ``arrival``, ``duration_h``, ``distance_nm``,
        ``complexity``, ``conditions_summary``, ``warnings``, and its own
        ``openwind_url``. HTML is never rendered in sweep mode — the LLM reasons
        qualitatively over the windows and presents 2-3 options; the user picks
        one; the LLM then calls ``plan_passage`` once more with that specific
        departure to get the rendered widget.

        ``target_eta``: optional ISO-8601 datetime. When set, only windows that
        arrive within ±2 h of the target are returned. If none match, all windows
        are returned with a ``meta_warnings`` note.

        ## Failure modes

        Raises ``ForecastHorizonError`` if the chosen model's horizon doesn't
        cover the passage and ``model != "auto"``. The error message names the
        failing model and suggests longer-range alternatives.
        """
        pts = [Point(w["lat"], w["lon"]) for w in waypoints]
        dep = datetime.fromisoformat(departure)

        # --- SWEEP MODE ---
        if latest_departure is not None:
            latest_dep = datetime.fromisoformat(latest_departure)
            reports = await _estimate_passage_windows(
                pts,
                dep,
                latest_dep,
                archetype,
                sweep_interval_hours=sweep_interval_hours,
                efficiency=efficiency,
                segment_length_nm=segment_length_nm,
                adapter=fetch_adapter,
                model=model,
            )
            windows = [_build_window_dict(r, _score_complexity(r, max_hs_m=max_hs_m), waypoints) for r in reports]

            meta_warnings: list[str] = []
            if target_eta is not None:
                target_utc = datetime.fromisoformat(target_eta).astimezone(UTC)
                tolerance = timedelta(hours=2)
                filtered = [
                    w for w in windows
                    if abs((datetime.fromisoformat(w["arrival"]) - target_utc).total_seconds())
                    <= tolerance.total_seconds()
                ]
                if not filtered:
                    meta_warnings.append(
                        f"aucune fenêtre n'arrive dans ±2h de target_eta={target_eta} ; "
                        f"toutes les {len(windows)} fenêtres retournées"
                    )
                else:
                    windows = filtered

            return {
                "mode": "multi_window",
                "sweep": {
                    "earliest": dep.isoformat(),
                    "latest": latest_dep.isoformat(),
                    "interval_hours": sweep_interval_hours,
                    "window_count": len(windows),
                },
                "windows": windows,
                "meta_warnings": meta_warnings,
            }

        # --- SINGLE MODE (unchanged) ---
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
