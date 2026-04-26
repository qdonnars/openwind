"""Static HTML template + rendering instructions returned by the ``read_me`` tool.

Kept in its own module so ``server.py`` remains small and the template is
trivial to inspect / iterate on. Everything here is a plain string — no logic,
no imports — and the resulting payload is self-contained: no external fonts,
images, or network calls.

Theming is **client-agnostic**: the template uses its own CSS custom
properties at ``:root`` and overrides them in ``@media (prefers-color-scheme:
dark)``. We deliberately do NOT depend on Claude design tokens
(``--color-text-primary`` etc.) so the same widget renders correctly in any
MCP client (Claude, Mistral Le Chat, Goose, ChatGPT, …).

Brand accent colours (complexity scale) are constant across both themes — they
encode meaning (green = easy, red = demanding) and shouldn't shift with the
host's appearance.
"""

from __future__ import annotations

PASSAGE_WIDGET_HTML = """\
<style>
  .ow {
    --ow-text: #1A1A1A;
    --ow-text-muted: #4A4A4A;
    --ow-text-faint: #777169;
    --ow-card: #FFFFFF;
    --ow-card-soft: #F1ECDF;
    --ow-border: #E2DDCD;
    --ow-link-bg: #F1ECDF;
    --ow-empty: #D9D5C8;
    --ow-cx-1: #1D9E75;
    --ow-cx-3: #EF9F27;
    --ow-cx-4: #D85A30;
    --ow-cx-5: #E24B4A;

    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--ow-text);
    max-width: 640px;
  }
  @media (prefers-color-scheme: dark) {
    .ow {
      --ow-text: #F2F2F2;
      --ow-text-muted: #B8B5AC;
      --ow-text-faint: #888780;
      --ow-card: rgba(255, 255, 255, 0.04);
      --ow-card-soft: rgba(255, 255, 255, 0.06);
      --ow-border: rgba(255, 255, 255, 0.10);
      --ow-link-bg: rgba(255, 255, 255, 0.06);
      --ow-empty: rgba(255, 255, 255, 0.12);
    }
  }
  .ow-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 12px; }
  .ow-dep { font-size: 12px; color: var(--ow-text-muted); margin-bottom: 2px; letter-spacing: .02em; }
  .ow-time { font-size: 26px; font-weight: 500; line-height: 1.1; }
  .ow-time-tz { font-size: 13px; font-weight: 400; color: var(--ow-text-muted); margin-left: 4px; }
  .ow-date { font-size: 12px; color: var(--ow-text-muted); margin-top: 2px; }
  .ow-badge { display: inline-block; font-size: 11px; padding: 4px 10px; border-radius: 999px; background: var(--ow-card-soft); color: var(--ow-text-muted); white-space: nowrap; }
  .ow-boat { font-size: 13px; color: var(--ow-text-muted); margin: 8px 0 12px; }
  .ow-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
  .ow-stat { background: var(--ow-card-soft); border-radius: 10px; padding: 10px 12px; }
  .ow-stat-label { font-size: 10px; color: var(--ow-text-faint); text-transform: uppercase; letter-spacing: .08em; }
  .ow-stat-val { font-size: 22px; font-weight: 500; margin-top: 2px; }
  .ow-stat-unit { font-size: 12px; font-weight: 400; color: var(--ow-text-muted); margin-left: 2px; }
  .ow-cx { display: flex; gap: 3px; margin-top: 8px; }
  .ow-cx-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--ow-empty); }
  .ow-legs { display: flex; flex-direction: column; gap: 6px; }
  .ow-leg { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--ow-border); background: var(--ow-card); }
  .ow-leg-num { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #fff; flex-shrink: 0; }
  .ow-leg-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ow-leg-title { font-size: 13px; font-weight: 500; }
  .ow-leg-meta { font-size: 11px; color: var(--ow-text-muted); display: flex; gap: 10px; flex-wrap: wrap; }
  .ow-leg-eta { font-size: 13px; font-weight: 500; color: var(--ow-text-muted); flex-shrink: 0; }
  .ow-link { display: block; text-align: center; padding: 10px; border-radius: 10px; background: var(--ow-link-bg); font-size: 13px; font-weight: 500; color: var(--ow-text); text-decoration: none; margin-top: 12px; }
  .ow-link:hover { filter: brightness(0.97); }
</style>
<div class="ow">
  <div class="ow-header">
    <div>
      <div class="ow-dep">DEPARTURE</div>
      <div class="ow-time">{{departure_time}}<span class="ow-time-tz">{{timezone}}</span></div>
      <div class="ow-date">{{departure_date_display}}</div>
    </div>
    <span class="ow-badge">{{num_waypoints}} wpts &middot; {{total_distance}} nm</span>
  </div>
  <div class="ow-boat">{{archetype_display}} &middot; efficiency {{efficiency}}</div>
  <div class="ow-stats">
    <div class="ow-stat">
      <div class="ow-stat-label">Distance</div>
      <div class="ow-stat-val">{{total_distance}}<span class="ow-stat-unit">nm</span></div>
    </div>
    <div class="ow-stat">
      <div class="ow-stat-label">Duration</div>
      <div class="ow-stat-val">{{duration_hours}}h {{duration_minutes}}<span class="ow-stat-unit">m</span></div>
    </div>
    <div class="ow-stat">
      <div class="ow-stat-label">ETA</div>
      <div class="ow-stat-val">{{eta_time}}<span class="ow-stat-unit">{{timezone}}</span></div>
    </div>
    <div class="ow-stat">
      <div class="ow-stat-label">Complexity</div>
      <div class="ow-stat-val">{{complexity_score}}<span class="ow-stat-unit">/ 5</span></div>
      <div class="ow-cx">{{complexity_bars}}</div>
    </div>
  </div>
  <div class="ow-legs">{{legs}}</div>
  <a class="ow-link" href="{{openwind_url}}" target="_blank" rel="noopener">Open in OpenWind &rarr;</a>
</div>\
"""


PASSAGE_WIDGET_INSTRUCTIONS = f"""\
# OpenWind passage preview — rendering instructions

When the user asks for a sailing route, passage estimate, or ETA between
waypoints, render an inline visual preview card alongside your textual answer.

## When to render

- After calling `estimate_passage` (and usually `score_complexity`) for an A→B
  question. The card replaces a long textual leg-by-leg dump.
- Skip the card for simple weather lookups (`get_marine_forecast` only) or when
  the user is in a dialogue refining waypoints — render once the route is set.

## How to render

Use whatever inline-HTML capability your client offers:
- Claude (Visualizer / artifacts): pass the HTML to `show_widget` /
  `display_artifact`. Suggested loading messages:
  - EN: ["Plotting waypoints", "Computing leg estimates", "Coloring complexity"]
  - FR: ["Tracé des waypoints", "Calcul des estimations", "Score de complexité"]
- Other MCP clients: emit the HTML as a fenced ```html block, or as the
  client's equivalent of an inline preview. The template is fully
  self-contained (no external fonts, images, fetches, iframes) and adapts to
  light / dark mode automatically via `prefers-color-scheme`, so it renders
  correctly anywhere.

Render the widget at most ONCE per route. If the user revises waypoints,
re-render with fresh data rather than appending a second card.

## HTML template

Substitute every `{{{{placeholder}}}}` with real data. Do not introduce other
markup, scripts, fetches, or iframes — the widget must stay static.

```html
{PASSAGE_WIDGET_HTML}
```

## Data mapping

From the `estimate_passage` response:
- `total_distance_nm` -> `{{{{total_distance}}}}` (1 decimal)
- `departure_time` (ISO) -> `{{{{departure_time}}}}` (HH:MM, in the departure
  tz), `{{{{departure_date_display}}}}` (e.g. "Sun 26 Apr"),
  `{{{{timezone}}}}` (e.g. "CEST")
- `arrival_time` (ISO) -> `{{{{eta_time}}}}` (HH:MM, same tz)
- `duration_s` -> `{{{{duration_hours}}}}` and `{{{{duration_minutes}}}}`
  (integers; floor-divide by 3600 / 60)
- `archetype` -> `{{{{archetype_display}}}}` (humanised, e.g.
  "Sun Odyssey 380" or fallback "Cruiser 30ft"). Pair with `{{{{efficiency}}}}`
  formatted as `0.75`.
- `len(segments) + 1` (or however many waypoints the user gave) ->
  `{{{{num_waypoints}}}}`
- `segments[]` -> `{{{{legs}}}}` (see below)

From the `score_complexity` response:
- `level` -> `{{{{complexity_score}}}}`
- the same level drives `{{{{complexity_bars}}}}` (see below)

## Building `{{{{legs}}}}`

Render ONE block per segment, in order. For each segment compute its CX colour
(see colour table below) from the segment's score (or, if unavailable, the
overall score):

```html
<div class="ow-leg">
  <div class="ow-leg-num" style="background:{{{{leg.color}}}}">{{{{leg.index}}}}</div>
  <div class="ow-leg-info">
    <div class="ow-leg-title">Leg {{{{leg.index}}}} &middot; wp{{{{leg.from}}}} &rarr; wp{{{{leg.to}}}}</div>
    <div class="ow-leg-meta">
      <span>{{{{leg.distance}}}} nm</span>
      <span>TWS {{{{leg.tws}}}}kn</span>
      <span>TWA {{{{leg.twa}}}}&deg;</span>
      <span>VMG {{{{leg.vmg}}}}kn</span>
      <span>CX {{{{leg.cx}}}}/5</span>
    </div>
  </div>
  <div class="ow-leg-eta">{{{{leg.eta}}}}</div>
</div>
```

Round numbers: distances and speeds to 1 decimal, TWA to integer.

## Building `{{{{complexity_bars}}}}`

Render exactly 5 `<span class="ow-cx-bar">` elements. Bars 1..score get the
score's colour as a `style="background:..."`; bars (score+1)..5 keep the
default empty background (no `style`):

```html
<span class="ow-cx-bar" style="background:#1D9E75"></span>
<span class="ow-cx-bar" style="background:#1D9E75"></span>
<span class="ow-cx-bar" style="background:#1D9E75"></span>
<span class="ow-cx-bar"></span>
<span class="ow-cx-bar"></span>
```

(example: score = 3 with the green colour — pick the colour by score, not by
position.)

## Colour table (CX score -> hex)

| Score | Colour    | Hex      |
|-------|-----------|----------|
| 1-2   | green     | #1D9E75  |
| 3     | amber     | #EF9F27  |
| 4     | coral     | #D85A30  |
| 5     | red       | #E24B4A  |

These colours stay constant across light/dark mode — they encode meaning.

## URL construction (`{{{{openwind_url}}}}`)

```
https://openwind.fr/plan?wpts=<lat1>,<lon1>;<lat2>,<lon2>;...&departure=<ISO>&archetype=<archetype>
```

URL-encode the departure ISO datetime (in particular `+` -> `%2B`). Example
for two waypoints leaving Marseille on 2026-04-26 at 13:00 CEST on a
`cruiser_30ft`:

```
https://openwind.fr/plan?wpts=43.295,5.375;43.000,6.200&departure=2026-04-26T13%3A00%3A00%2B02%3A00&archetype=cruiser_30ft
```

The `/plan` route on openwind.fr will read these params and render the same
passage server-side (deep-link).

## Calling discipline

- Call `read_me` ONCE per conversation — its content is stable. Cache the
  template for the rest of the session.
- Do not paraphrase or trim the HTML. Substitute placeholders verbatim.
- Keep your textual answer (advice, caveats, recommended departure) above or
  below the widget — the widget is a summary, not a replacement for sailing
  judgement.
"""
