"""FastMCP server factory.

`build_server()` returns a `FastMCP` instance with all tools registered. It is
cloud-agnostic: no Gradio, no `huggingface_hub`. The HF Spaces wrapper, the
local stdio runner, and any future deployment all import this same factory.

Tools exposed (V1):

1. ``list_boat_archetypes`` — descriptive list for LLM mapping ("Sun Odyssey 32"
   → ``cruiser_30ft``). No server-side mapping table.
2. ``get_marine_forecast`` — wind+sea around a point/window for one or more models.
3. ``plan_passage`` — single-shot end-to-end: timing along the polyline,
   1-5 complexity score, rendered MCP App widget, and openwind.fr deep-link.

## Rich rendering (MCP Apps)

``plan_passage`` declares ``_meta.ui.resourceUri`` pointing at
``ui://openwind/plan-passage`` — a sandboxed HTML resource that iframes
``openwind.fr/plan?...``. Hosts that support the MCP Apps spec (Claude,
Claude Desktop, ChatGPT, VS Code Copilot, Goose, Postman, MCPJam — see the
`extension client matrix`_) render the widget inline. Hosts that do NOT
support MCP Apps (Cursor, Le Chat, terminal, …) silently fall back to the
tool's text response: a compact summary plus the ``openwind_url`` deep link.

The dead-on-arrival ``html`` field that older versions returned has been
dropped — relying on every host to render arbitrary HTML in chat was fragile
by design (see PR #74 for the full reasoning).

.. _extension client matrix: https://modelcontextprotocol.io/extensions/client-matrix
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

from .render import build_openwind_url

# MCP Apps UI resource URI for plan_passage. The host fetches this resource
# and renders it in a sandboxed iframe; the resource itself iframes
# openwind.fr/plan, so the rendered widget IS the live web app — single
# source of truth, no duplicate widget code to maintain.
PLAN_UI_RESOURCE_URI = "ui://openwind/plan-passage"
PLAN_UI_MIME = "text/html;profile=mcp-app"
PLAN_UI_FRAME_DOMAINS = ["https://openwind.fr"]

# Body of the MCP Apps UI resource. Vanilla JS implementing the actual MCP
# Apps spec handshake (per https://github.com/modelcontextprotocol/ext-apps,
# spec rev 2026-01-26):
#
#   1. Iframe sends ``ui/initialize`` JSON-RPC request on load.
#   2. Host responds (we ignore the body — we just need the handshake done).
#   3. Host pushes ``ui/notifications/tool-result`` when the tool finishes,
#      with the standard ``CallToolResult`` shape:
#      ``{ structuredContent: { ...tool return... }, content: [...], ... }``
#   4. We extract ``openwind_url`` (single mode) or ``windows[0].openwind_url``
#      (sweep mode) and bind the iframe src.
#
# Defensive fallback paths kept for shape variations across hosts
# (Claude.ai vs Claude Desktop vs ChatGPT vs MCPJam may differ slightly).
_PLAN_WIDGET_HTML = """<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OpenWind</title>
  <style>
    html,body{margin:0;height:100%;background:#FAF7EE;color:#1A1A1A;
      font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
    iframe{width:100%;height:100%;border:0;display:block}
    .placeholder{display:flex;flex-direction:column;align-items:center;
      justify-content:center;height:100%;padding:2rem;text-align:center;gap:.6rem}
    .placeholder .dim{color:#777169;font-size:.9rem}
    .placeholder a{color:#1D9E75;text-decoration:none;padding:.55rem 1rem;
      border:1px solid #1D9E75;border-radius:8px;font-weight:600}
    @media (prefers-color-scheme:dark){
      html,body{background:#15140F;color:#F2F2F2}
      .placeholder .dim{color:#888780}
      .placeholder a{color:#2BBE93;border-color:#2BBE93}
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="placeholder">
      <p>Chargement du plan…</p>
      <p class="dim">Si rien n'apparaît :</p>
      <a id="fallback" href="https://openwind.fr/plan" target="_blank" rel="noopener">openwind.fr →</a>
    </div>
  </div>
  <script>
  (function(){
    var bound = false;
    var nextId = 1;

    function send(msg){
      try { window.parent && window.parent.postMessage(msg, '*'); }
      catch(e){}
    }

    function bindIframe(url){
      if(bound) return;
      bound = true;
      var root = document.getElementById('root');
      var iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.title = 'OpenWind passage plan';
      iframe.allow = 'clipboard-write';
      iframe.referrerPolicy = 'no-referrer';
      root.innerHTML = '';
      root.appendChild(iframe);
    }

    function updateFallbackLink(url){
      var a = document.getElementById('fallback');
      if(a && url){ a.href = url; }
    }

    // CallToolResult.structuredContent -> openwind_url, with sweep fallback
    // and a few defensive lookups for older or alternate framings.
    function extractUrl(payload){
      if(!payload || typeof payload !== 'object') return null;
      var sc = payload.structuredContent
            || (payload.params && payload.params.structuredContent)
            || (payload.result && payload.result.structuredContent)
            || payload;
      if(!sc) return null;
      if(typeof sc.openwind_url === 'string') return sc.openwind_url;
      if(Array.isArray(sc.windows) && sc.windows[0] && sc.windows[0].openwind_url){
        return sc.windows[0].openwind_url;
      }
      return null;
    }

    window.addEventListener('message', function(ev){
      var msg = ev.data;
      if(!msg) return;
      var method = msg.method;

      // Spec method we care about: tool result delivered to the view.
      if(method === 'ui/notifications/tool-result'
         || method === 'notifications/tool-result'
         || method === 'ui/tool-result'){
        var url = extractUrl(msg.params || msg);
        if(url){ bindIframe(url); updateFallbackLink(url); }
        return;
      }

      // Some hosts may push the tool result as a plain message (non-JSON-RPC).
      if(!method){
        var url2 = extractUrl(msg);
        if(url2){ bindIframe(url2); updateFallbackLink(url2); }
      }
    });

    // Spec initialize handshake. Without it, several hosts won't push the
    // tool-result notification.
    function initialize(){
      send({
        jsonrpc: '2.0', id: nextId++, method: 'ui/initialize',
        params: {
          protocolVersion: '2026-01-26',
          appCapabilities: {},
          clientInfo: { name: 'openwind-plan-widget', version: '1' }
        }
      });
    }
    if(document.readyState === 'complete'){ initialize(); }
    else { window.addEventListener('load', initialize); }
  })();
  </script>
</body>
</html>
"""


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

## Compare-windows mode

`plan_passage` accepts an optional `latest_departure` that turns the call
into a window comparison: it walks N hourly departures over the same route
and returns one entry per window. Weather is fetched once (cache prewarm),
simulations are in-memory. Hard cap: 14 d x 24 h = 336 windows. The LLM
picks qualitatively (no server-side ranking).

## Mediterranean defaults

- Tides ignored (< 40 cm, negligible vs forecast uncertainty).
- Currents ignored (Liguro-Provencal too weak / variable for V1).
- Wind model: AROME 1.3 km (<= 48 h horizon, captures thermals and local
  winds). Auto-falls back to ICON-EU (<= 5 d) -> ECMWF IFS 0.25 deg
  (<= 10 d) -> GFS (<= 16 d).
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

    @server.resource(
        PLAN_UI_RESOURCE_URI,
        name="OpenWind plan widget",
        mime_type=PLAN_UI_MIME,
        meta={"ui": {"csp": {"frameDomains": PLAN_UI_FRAME_DOMAINS}}},
    )
    def plan_widget_resource() -> str:
        """MCP Apps UI resource — iframe wrapper for openwind.fr/plan.

        Receives the tool's ``structuredContent`` over postMessage (per the
        MCP Apps spec — the host pushes results to the iframe via a
        JSON-RPC dialect on the postMessage channel) and binds the inner
        iframe's ``src`` to ``openwind_url`` from the result.

        Defensive against multiple message shapes — different hosts have
        different framings, and the spec is young — and falls back to a
        deep-link CTA if no result arrives within 6 s.
        """
        return _PLAN_WIDGET_HTML

    @server.tool()
    def read_me() -> str:
        """Return OpenWind's calculation methodology as Markdown.

        Call this when the user asks how passage timing, complexity, or
        boat speed are computed (e.g. "comment c'est calculé ?",
        "what assumptions does the model use?", "is tacking modelled?").

        The returned text covers: polar lookup, default efficiency 0.75,
        VMG / tacking correction, wave derate, single-pass timing,
        compare-windows mode semantics, Mediterranean simplifications
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

    @server.tool(
        meta={"ui": {"resourceUri": PLAN_UI_RESOURCE_URI}},
    )
    async def plan_passage(
        waypoints: list[dict[str, float]],
        departure: str,
        archetype: str,
        efficiency: float = 0.75,
        segment_length_nm: float = 10.0,
        model: str = AUTO_MODEL,
        max_hs_m: float | None = None,
        latest_departure: str | None = None,
        sweep_interval_hours: int = 1,
        target_eta: str | None = None,
    ) -> dict[str, Any]:
        """Plan an A→B passage. Compare departure windows by default; pin a
        single departure only when the user gives an explicit time.

        ## Tool routing — read this first

        Before calling, classify the user's question:

        1. **Pure weather lookup at a point** ("y aura-t-il du vent à Cassis
           samedi à 14h ?", "quelles vagues dimanche au cap Sicié ?") — call
           ``get_marine_forecast`` and answer in text. Do NOT call
           ``plan_passage``: there's no route to plan.

        2. **Trajet question with a flexible date** ("Marseille → Porquerolles
           ce week-end", "demain ou après-demain", "dans les prochains jours")
           — call ``plan_passage`` in **compare-windows mode**: pass
           ``latest_departure`` (e.g. earliest+48h) and ``sweep_interval_hours``
           (3 or 6 typically) so the user sees several departure scenarios
           side-by-side. Then pick 2-3 good ones and let the user choose.
           This is the **default** for trajet planning — same API cost as a
           single passage thanks to cache prewarm, much more value.

        3. **Trajet with a precise hour pinned by the user** ("je pars demain
           à 8h", "départ Saturday 9am") — call ``plan_passage`` in single
           mode (no ``latest_departure``). Used for the final "show me the
           detailed plan for THIS departure" view, often after step 2.

        4. **Methodology question** ("comment c'est calculé ?",
           "quelle efficacité par défaut ?") — call ``read_me``.

        Rule of thumb: if the user does NOT give an exact hour, prefer
        compare-windows. The widget renders one of the windows by default
        and the chat lets the user pick another.

        ## Returned payload

        Single mode:

        - ``passage``: per-segment timing report (distance_nm, duration_h,
          model used, segments[] with TWS/TWA/boat_speed/Hs, warnings).
        - ``complexity``: 1-5 difficulty score with wind/sea breakdown and a
          human-readable rationale.
        - ``openwind_url``: deep-link to openwind.fr/plan that renders the
          same passage in the standalone web app.

        Compare-windows mode (``latest_departure`` set):

        - ``mode``: ``"multi_window"``.
        - ``sweep``: ``earliest`` / ``latest`` / ``interval_hours`` /
          ``window_count``.
        - ``windows[]``: each entry has ``departure``, ``arrival``,
          ``duration_h``, ``distance_nm``, ``complexity`` (level + label +
          rationale), ``conditions_summary`` (tws_min/max, predominant sail
          angle, hs_min/max), ``warnings``, ``passage`` (full per-segment
          report), ``complexity_full`` (full score), ``openwind_url``.
        - ``meta_warnings``: top-level notes ("3 fenêtres ignorées …").

        ## How it renders

        On hosts that support MCP Apps (Claude, Claude Desktop, ChatGPT, VS
        Code Copilot, Goose, Postman, MCPJam), the response is automatically
        accompanied by an interactive widget — the live openwind.fr/plan view
        served via the ``ui://openwind/plan-passage`` resource declared on
        this tool's ``_meta``. The widget reads ``openwind_url`` from the
        structured output and embeds the matching plan view as an iframe.

        On hosts without MCP Apps support (Cursor, Le Chat, terminal), present
        a short text summary of the result (route, ETA, complexity, warnings)
        and offer ``openwind_url`` as the "View full plan →" link.

        ## ALWAYS include the openwind_url(s) in your text reply

        Even when the widget renders inline, the user wants the link spelled
        out so they can open the full app, share it, or bookmark it. Treat
        this as a hard requirement, not a fallback:

        - **Single mode**: end your reply with a Markdown link, e.g.
          ``[Voir le plan détaillé →](https://openwind.fr/plan?…)``.
        - **Compare-windows mode**: list 2-4 of the most relevant windows
          and give each its own link, e.g.
          ``- Sam 2 mai 09h · 11h12 · ⚡2/5 — [voir →](url)``.
          The user picks one from the chat, not the widget.

        Phrase the link with intent ("voir le plan détaillé", "ouvrir cette
        fenêtre dans l'app"), not just a bare URL — the user should know
        what clicking does.

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
                ICON-EU (≤5 d) → ECMWF IFS 0.25° (≤10 d) → GFS (≤16 d).
                Pass an explicit name to bypass.
            max_hs_m: optional max significant wave height (meters) over the
                route — pass it if you have a sea-state estimate from
                ``get_marine_forecast`` and want it factored into the score.
                Defaults to wind-only scoring.

        ## Compare-windows mode (latest_departure set)

        When ``latest_departure`` is provided, the tool switches into a
        window-comparison call: it walks departure times from ``departure``
        up to ``latest_departure`` every ``sweep_interval_hours`` (default
        1 h). Returns ``{"mode": "multi_window", "sweep": {...}, "windows":
        [...]}`` instead of the single-passage payload. Each window contains
        ``departure``, ``arrival``, ``duration_h``, ``distance_nm``,
        ``complexity``, ``conditions_summary``, ``warnings``, and its own
        ``openwind_url``.

        ``target_eta``: optional ISO-8601 datetime. When set, only windows that
        arrive within ±2 h of the target are returned. If none match, all
        windows are returned with a ``meta_warnings`` note.

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

        # --- SINGLE MODE ---
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

        return {
            "passage": _passage_to_dict(report),
            "complexity": asdict(score),
            "openwind_url": build_openwind_url(waypoints, departure, archetype),
        }

    return server
