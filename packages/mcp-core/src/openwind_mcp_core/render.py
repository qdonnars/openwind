"""Server-side rendering of OpenWind widgets to final HTML.

Companion to ``widget.py`` (which holds the static template + rendering
instructions returned by ``read_me``). Where ``read_me`` lets the LLM do the
substitution itself, this module performs the same substitution in Python and
hands back ready-to-display HTML — no placeholders left.

Why two paths:
- ``read_me`` stays the fallback for clients that want to customise rendering
  or for debugging. Cross-client by definition (LLM emits HTML).
- ``render_passage`` is the fast path: deterministic Python substitution moves
  the work off the LLM's slow output stream. The LLM passes the structured
  output of ``estimate_passage`` (+ optionally ``score_complexity``) and gets
  back a self-contained HTML string it can either relay verbatim or hand to
  the host client's artifact / show_widget capability.

Both paths share the same underlying ``PASSAGE_WIDGET_HTML`` template — single
source of visual truth. Only the substitution mechanism differs.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from .widget import PASSAGE_WIDGET_HTML

_CX_COLORS: dict[int, str] = {
    1: "#1D9E75",
    2: "#1D9E75",
    3: "#EF9F27",
    4: "#D85A30",
    5: "#E24B4A",
}

_FR_DAYS = ("Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim")
_FR_MONTHS = (
    "janv.",
    "févr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "août",
    "sept.",
    "oct.",
    "nov.",
    "déc.",
)
_EN_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_EN_MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

_LABEL_FR: dict[str, str] = {
    ">DEPARTURE<": ">DÉPART<",
    ">Distance<": ">Distance<",
    ">Duration<": ">Durée<",
    ">ETA<": ">ETA<",
    ">Complexity<": ">Complexité<",
    ">Open in OpenWind &rarr;<": ">Ouvrir dans OpenWind &rarr;<",
}

_LEG_TEMPLATE = (
    '<div class="ow-leg">'
    '<div class="ow-leg-num" style="background:{color}">{index}</div>'
    '<div class="ow-leg-info">'
    '<div class="ow-leg-title">{title}</div>'
    '<div class="ow-leg-meta">'
    "<span>{distance} nm</span>"
    "<span>TWS {tws}kn</span>"
    "<span>TWA {twa}&deg;</span>"
    "<span>VMG {vmg}kn</span>"
    "</div></div>"
    '<div class="ow-leg-eta">{eta}</div>'
    "</div>"
)

_CX_BAR_FILLED = '<span class="ow-cx-bar" style="background:{color}"></span>'
_CX_BAR_EMPTY = '<span class="ow-cx-bar"></span>'

SUPPORTED_LOCALES = ("fr", "en")


def _format_date(dt: datetime, locale: str) -> str:
    if locale == "fr":
        return f"{_FR_DAYS[dt.weekday()]} {dt.day} {_FR_MONTHS[dt.month - 1]} {dt.year}"
    return f"{_EN_DAYS[dt.weekday()]} {dt.day} {_EN_MONTHS[dt.month - 1]} {dt.year}"


def _archetype_display(archetype: str) -> str:
    """``cruiser_30ft`` -> ``Cruiser 30ft``."""
    return " ".join(p.capitalize() for p in archetype.split("_"))


def build_openwind_url(
    waypoints: list[dict[str, float]],
    departure_iso: str,
    archetype: str,
) -> str:
    """Build the openwind.fr/plan deep-link URL.

    Public so ``plan_passage`` can include it in its response payload as the
    fallback CTA for clients that don't render HTML inline (Le Chat, Goose,
    terminals).
    """
    wpts = ";".join(f"{w['lat']:.3f},{w['lon']:.3f}" for w in waypoints)
    dep = quote(departure_iso, safe="")
    return f"https://openwind.fr/plan?wpts={wpts}&departure={dep}&archetype={archetype}"


def _waypoints_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, float]]:
    """Reconstruct user-supplied waypoints from sub-segments — start of seg[0] +
    end of every seg.

    Note: segments are sub-segments after polyline splitting, so this returns
    *sub-segment* boundaries, not the original user waypoints. Caller should
    pass `waypoints` explicitly when the original ones are known — this is a
    last-resort fallback for the deep-link URL.
    """
    if not segments:
        return []
    out: list[dict[str, float]] = [
        {"lat": segments[0]["start"]["lat"], "lon": segments[0]["start"]["lon"]}
    ]
    out.extend({"lat": s["end"]["lat"], "lon": s["end"]["lon"]} for s in segments)
    return out


def _localize_labels(html: str, locale: str) -> str:
    if locale == "fr":
        for old, new in _LABEL_FR.items():
            html = html.replace(old, new)
    return html


def render_passage(
    passage: dict[str, Any],
    complexity: dict[str, Any] | None = None,
    *,
    waypoints: list[dict[str, float]] | None = None,
    boat_name: str | None = None,
    leg_titles: list[str] | None = None,
    locale: str = "fr",
    timezone: str = "Europe/Paris",
) -> str:
    """Render the passage widget to final, self-contained HTML.

    Args:
        passage: dict shaped like the output of ``estimate_passage``
            (ISO datetimes, segments[], etc.).
        complexity: dict shaped like the output of ``score_complexity``.
            If ``None``, the complexity bars render empty and the score shows ``-``.
        waypoints: original user waypoints for the deep-link URL. If ``None``,
            inferred from segment endpoints (less accurate).
        boat_name: optional commercial name (e.g. ``"OTAGO III"``); prepended to
            the boat line.
        leg_titles: optional human-friendly per-leg titles (e.g.
            ``["Sortie rade", "Cap Sicié → Grand Ribaud"]``). Falls back to
            ``"Leg N · wpN → wpN+1"`` for missing entries.
        locale: ``"fr"`` (default) or ``"en"``. Drives label text and date format.
        timezone: IANA tz for time display. Default ``Europe/Paris`` (the
            project's primary cruising area).
    """
    if locale not in SUPPORTED_LOCALES:
        raise ValueError(f"locale must be one of {SUPPORTED_LOCALES}, got {locale!r}")

    tz = ZoneInfo(timezone)

    dep_iso = passage["departure_time"]
    arr_iso = passage["arrival_time"]
    dep_dt = datetime.fromisoformat(dep_iso).astimezone(tz)
    arr_dt = datetime.fromisoformat(arr_iso).astimezone(tz)

    duration_total_min = round(passage["duration_h"] * 60)
    duration_hours = duration_total_min // 60
    duration_minutes = duration_total_min % 60

    archetype = passage["archetype"]
    archetype_line = _archetype_display(archetype)
    if boat_name:
        archetype_line = f"{boat_name} &middot; {archetype_line}"

    segments = passage["segments"]
    if waypoints is None:
        waypoints = _waypoints_from_segments(segments)

    if complexity is not None:
        cx_level = complexity["level"]
        cx_color = _CX_COLORS[cx_level]
        complexity_score = str(cx_level)
        bars = [
            _CX_BAR_FILLED.format(color=cx_color) if i <= cx_level else _CX_BAR_EMPTY
            for i in range(1, 6)
        ]
    else:
        cx_level = 0
        cx_color = _CX_COLORS[1]
        complexity_score = "-"
        bars = [_CX_BAR_EMPTY] * 5
    complexity_bars = "".join(bars)

    leg_blocks: list[str] = []
    for i, seg in enumerate(segments):
        idx = i + 1
        if leg_titles and i < len(leg_titles):
            title = leg_titles[i]
        else:
            title = f"Leg {idx} &middot; wp{idx} &rarr; wp{idx + 1}"
        end_dt = datetime.fromisoformat(seg["end_time"]).astimezone(tz)
        # "VMG" here is speed-made-good toward the next waypoint. Segments
        # follow the rhumb line, so this equals boat_speed_kn directly — more
        # useful for passage planning than the racing VMG-to-wind.
        leg_blocks.append(
            _LEG_TEMPLATE.format(
                color=cx_color,
                index=idx,
                title=title,
                distance=f"{seg['distance_nm']:.1f}",
                tws=f"{seg['tws_kn']:.1f}",
                twa=round(seg["twa_deg"]),
                vmg=f"{seg['boat_speed_kn']:.1f}",
                eta=end_dt.strftime("%H:%M"),
            )
        )

    substitutions: dict[str, str] = {
        "{{departure_time}}": dep_dt.strftime("%H:%M"),
        "{{departure_date_display}}": _format_date(dep_dt, locale),
        "{{timezone}}": dep_dt.tzname() or "",
        "{{num_waypoints}}": str(len(waypoints)),
        "{{total_distance}}": f"{passage['distance_nm']:.1f}",
        "{{archetype_display}}": archetype_line,
        "{{efficiency}}": f"{passage['efficiency']:.2f}",
        "{{duration_hours}}": str(duration_hours),
        "{{duration_minutes}}": str(duration_minutes),
        "{{eta_time}}": arr_dt.strftime("%H:%M"),
        "{{complexity_score}}": complexity_score,
        "{{complexity_bars}}": complexity_bars,
        "{{legs}}": "".join(leg_blocks),
        "{{openwind_url}}": build_openwind_url(waypoints, dep_iso, archetype),
    }

    html = PASSAGE_WIDGET_HTML
    for placeholder, value in substitutions.items():
        html = html.replace(placeholder, value)

    return _localize_labels(html, locale)
