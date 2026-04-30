# Wording suggestions — drafts only, not applied

Each block lists the current text, the *issue* (factual mismatch, missing
feature, or subjective concern), and 2-3 alternatives. Subjective calls are
not made on the maintainer's behalf — pick one or none.

---

## A. HF Space card — tool table (FACTUAL FIX)

**File:** [`packages/hf-space/README.md`](../packages/hf-space/README.md), lines 56-64.

**Current (wrong):**

```markdown
## Five tools

| Tool                      | What it does                                                              |
|---------------------------|---------------------------------------------------------------------------|
| `list_boat_archetypes`    | Five descriptive archetypes; the LLM maps "Sun Odyssey 36" → `cruiser_30ft`. |
| `get_marine_forecast`     | Wind + sea around a point/window, multi-model.                            |
| `estimate_passage`        | Per-segment timing along a polyline of waypoints.                         |
| `score_complexity`        | 1–5 difficulty score from wind (and optional max wave height).            |
| `read_me`                 | Hands the client a self-contained HTML widget for inline rendering.       |
```

**Issue:** `estimate_passage` and `score_complexity` were merged into
`plan_passage` in PR #58 (`b2fbe23`). `read_me` returns calculation
methodology as Markdown, not an HTML widget — see
[`server.py:175-188`](../packages/mcp-core/src/openwind_mcp_core/server.py#L175-L188).

**Replacement** (mirrors root README, single source of truth):

```markdown
## Four tools

| Tool                      | What it does                                                              |
|---------------------------|---------------------------------------------------------------------------|
| `list_boat_archetypes`    | Five descriptive archetypes; the LLM maps "Sun Odyssey 36" → `cruiser_30ft` itself. |
| `get_marine_forecast`     | Wind + sea around a point/window, multi-model.                            |
| `plan_passage`            | End-to-end: per-leg timing + 1–5 complexity + HTML widget + deep-link, in one call. Optional sweep mode for multi-window departures. |
| `read_me`                 | Returns OpenWind's calculation methodology — call when the user asks how things are computed. |
```

---

## B. HF Space landing HTML — tool count (FACTUAL FIX)

**File:** [`packages/hf-space/app.py`](../packages/hf-space/app.py), lines 220-224.

**Current (wrong):**

```html
<h2>Three tools</h2>
<p><code>list_boat_archetypes</code>, <code>get_marine_forecast</code>,
  and <code>plan_passage</code> — the workhorse: one call returns timing,
  1-5 complexity score, a ready-to-display HTML widget, and a deep-link
  to the full plan on openwind.fr.</p>
```

**Issue:** `read_me` is the fourth tool. It's how the LLM answers "how does
this thing actually compute?" without making the user dig into the README.

**Option B1 — keep punchy, just bump the number:**

```html
<h2>Four tools</h2>
<p><code>list_boat_archetypes</code>, <code>get_marine_forecast</code>,
  <code>read_me</code>, and the workhorse <code>plan_passage</code> — one
  call returns timing, a 1-5 complexity score, a ready-to-display HTML
  widget, and a deep-link to the full plan on openwind.fr.</p>
```

**Option B2 — add the "ask how it works" affordance:**

```html
<h2>Four tools</h2>
<p>The workhorse is <code>plan_passage</code>: one call returns timing, a
  1-5 complexity score, a ready-to-display HTML widget, and a deep-link to
  the full plan on openwind.fr. The other three —
  <code>list_boat_archetypes</code>, <code>get_marine_forecast</code>,
  <code>read_me</code> — let the assistant pick a boat, sample the forecast
  ad hoc, or explain the math behind a result.</p>
```

---

## C. Auto-fallback chain — every surface (FACTUAL FIX)

**Issue:** Real chain is AROME → ICON-EU → **ECMWF** → GFS
([`openmeteo.py:AUTO_FALLBACK_CHAIN`](../packages/data-adapters/src/openwind_data/adapters/openmeteo.py)).
Current copy mentions only 3 models everywhere.

**File 1: [`README.md`](../README.md), line 46.** Current:

```
🌊 **Mediterranean-tuned**   | Defaults to AROME 1.3 km — catches thermals, mistral, tramontane. Falls back to ICON-EU/GFS. |
```

**Replacement:**

```
🌊 **Mediterranean-tuned**   | Defaults to AROME 1.3 km — catches thermals, mistral, tramontane. Falls back to ICON-EU → ECMWF → GFS as the horizon stretches out. |
```

**File 2: [`README.md`](../README.md), line 136.** Current:

```
- **Wind model** — AROME 1.3 km (≤48 h horizon, captures thermals and local winds). Auto-falls back to ICON-EU (≤5 d) → GFS (≤16 d) when the passage extends past AROME.
```

**Replacement:**

```
- **Wind model** — AROME 1.3 km (≤48 h horizon, captures thermals and local winds). Auto-falls back to ICON-EU (≤5 d) → ECMWF IFS 0.25° (≤10 d) → GFS (≤16 d) when the passage extends past AROME.
```

**File 3: [`packages/mcp-core/README.md`](../packages/mcp-core/README.md), line 106.** Same pattern, replace `ICON-EU → GFS` with `ICON-EU → ECMWF → GFS`.

**File 4: [`packages/hf-space/README.md`](../packages/hf-space/README.md), line 51.** Current:

```
- **Mediterranean-tuned** — AROME 1.3 km by default, catches thermals & mistral. ICON-EU / GFS for longer reach.
```

**Replacement:**

```
- **Mediterranean-tuned** — AROME 1.3 km by default, catches thermals & mistral. ICON-EU → ECMWF → GFS for longer reach.
```

**File 5: [`packages/mcp-core/src/openwind_mcp_core/server.py`](../packages/mcp-core/src/openwind_mcp_core/server.py), line 23 (server docstring) and line 309-310 (`plan_passage.model` arg).** Same pattern.

**File 6 (CRITICAL — affects what the LLM tells users):
[`packages/mcp-core/src/openwind_mcp_core/server.py`](../packages/mcp-core/src/openwind_mcp_core/server.py),
line 131-133, the `_METHODOLOGY` constant returned by `read_me`:**

Current:

```
- Wind model: AROME 1.3 km (<= 48 h horizon, captures thermals and local
  winds). Auto-falls back to ICON-EU (<= 5 d) -> GFS (<= 16 d).
```

**Replacement:**

```
- Wind model: AROME 1.3 km (<= 48 h horizon, captures thermals and local
  winds). Auto-falls back to ICON-EU (<= 5 d) -> ECMWF IFS 0.25 deg
  (<= 10 d) -> GFS (<= 16 d).
```

---

## D. `docs/architecture.md` — stale tool list (FACTUAL FIX)

**File:** [`docs/architecture.md`](../docs/architecture.md), lines 23-24, 53-58, 97.

**Issue:** Three references to `estimate_passage` and `score_complexity` (no
longer MCP tools — merged into `plan_passage`).

**Replacement plan** — three coordinated edits:

1. ASCII diagram (lines 22-25): replace the four-line tool list with three
   lines:
   ```
        │   ┌── list_boat_archetypes                    │
        │   ├── get_marine_forecast                     │
        │   ├── plan_passage  (timing + complexity)     │
        │   └── read_me                                 │
   ```
2. Orchestration steps 3-4 (lines 53-58): collapse into a single step:
   > 3. **Plan the passage.** `plan_passage(waypoints, departure, archetype)`
   >    returns per-segment timing, a 1-5 complexity score, a rendered HTML
   >    widget, and a deep-link to `openwind.fr/plan`. The server fetches
   >    one wind bundle per segment (single-pass approximation; no
   >    convergence loop).
3. Failure-mode bullet (line 97): rename `estimate_passage` → `plan_passage`.

---

## E. Sweep / Compare / Multi-window — ONE name (subjective)

**Issue:** Same feature has three names depending on where you read about
it. Pick one.

| Surface | Current name | File |
|---|---|---|
| Server payload | `mode: "multi_window"` | `server.py:387` |
| Server arg | `latest_departure`, `sweep_interval_hours` | `server.py:264-265` |
| README (en) | "Multi-window sweep mode" | `README.md:128` |
| Web UI (fr) | "Comparer les fenêtres" / "Compare" | `PlanSidebar.tsx:147` |

**Option E1** — settle on **"compare windows"** for user-facing copy, keep
`sweep_*` and `multi_window` in code (internal). Pros: matches the question
the user asks ("which is the best window?"). Cons: "compare" implies a 2-3
window head-to-head — the actual feature returns up to 336 candidates.

**Option E2** — settle on **"window sweep"** everywhere user-facing (FR:
"balayage des fenêtres", or keep "Comparer" for the verb but call the
feature "le balayage"). Pros: matches the API. Cons: "sweep" in French and
in casual English isn't intuitive.

**Option E3** — settle on **"window finder"** / "Trouver une fenêtre" /
`/find-window`. Pros: matches the user's job-to-be-done. Cons: contradicts
the V1 design principle that the *server* doesn't pick — only the LLM does
(see [`CLAUDE.md`](../CLAUDE.md), "no `find_best_window` in V1").

My read: **E1** is least disruptive to code and most natural in English
copy. The web UI already uses "Comparer". But this is a positioning call.

---

## F. README "Why OpenWind" — promote compare-windows (subjective)

**File:** [`README.md`](../README.md), lines 40-49.

**Issue:** The 5-row "Why OpenWind" table doesn't mention the
compare-windows feature. The closest mention is buried inside the tools
table on line 58.

**Option F1 — add a row:**

```
| 🗓️ **Window-aware**          | One call sweeps a 14-day departure range and lets your LLM pick the calmest weekend slot — no math by hand. |
```

**Option F2 — fold into existing rows:** rewrite the `plan_passage` row of
the tools table:

```
| `plan_passage`            | A → B in one call: per-leg timing, 1–5 complexity, HTML widget, deep-link. Pass `latest_departure` and it sweeps every hour up to 14 days out so the LLM can compare windows side-by-side. |
```

(This is subjective: F1 is louder, F2 is denser. F1 if you want
weekend-sailors as a target.)

---

## G. README — "Run locally" Python version (factual gap)

**File:** [`README.md`](../README.md), line 80-86.

**Issue:** No Python version stated. A first-time contributor on Python
3.10 will hit obscure errors before realising the project requires a newer
ABI (uses `from __future__ import annotations` and `dataclasses` heavily).

**Suggested addition** (after the `cd packages/mcp-core` line, or as an
intro):

```
> **Requires Python ≥ 3.11** (typed dict / new union syntax used throughout) and `uv` ≥ 0.4.
```

(Verify the actual minimum from
[`packages/mcp-core/pyproject.toml`](../packages/mcp-core/pyproject.toml)
before applying — I haven't read that file in this audit pass.)

---

## H. `openwind.fr/` value prop — top-of-funnel fix (subjective)

**File:** [`packages/web/src/App.tsx`](../packages/web/src/App.tsx) and/or
[`packages/web/src/components/Header.tsx`](../packages/web/src/components/Header.tsx).

**Issue:** No copy on the landing. No outbound links to GitHub or the MCP
endpoint. A non-MCP visitor can't discover the rest of the project.

**Option H1 — thin top banner above the wind map (FR):**

> ⛵ **OpenWind** — météo marine + planificateur de passage. Demandez à
> votre IA, ou [tracez votre route ↗](/plan).
> [GitHub](https://github.com/qdonnars/openwind) ·
> [Connecter à un assistant](https://qdonnars-openwind-mcp.hf.space/)

**Option H2 — discreet footer pills (FR), no banner:**

> ⛵ Open source · [GitHub](https://github.com/qdonnars/openwind) ·
> [Serveur MCP](https://qdonnars-openwind-mcp.hf.space/) ·
> [Plan](/plan) · Données [Open-Meteo](https://open-meteo.com)

**Option H3 — empty-state hero on first visit only** (cookied so it
disappears once the user added a spot):

> Bienvenue. OpenWind affiche le vent à n'importe quel point de la
> Méditerranée — ajoutez un spot, ou
> [planifiez une traversée →](/plan).

H1 is loudest, H2 is most respectful of the existing minimal aesthetic, H3
is contextual. Pick by traffic intent: do you optimise for sailor-already-
at-the-map or curious-first-timer?

---

## I. Misc small phrasings (subjective, low priority)

### I.1 "Boat-aware" row, "efficiency knob"

**File:** [`README.md`](../README.md), line 46.

> ⛵ **Boat-aware** | Five archetypes from racer-cruiser to bluewater, real
> polars, an `efficiency` knob.

"Knob" is jargon-y / fond. Two alternatives:

- "real polars and a per-trip `efficiency` factor (racing → loaded family →
  fouled hull)."
- "real polars and an `efficiency` parameter — you say cruising relaxed
  vs racing trim, the boat speed adjusts."

### I.2 README "What the LLM sees" widget paragraph

**File:** [`README.md`](../README.md), lines 61-62.

> The widget switches palette via `prefers-color-scheme` — looks right in
> light and dark hosts, no Claude-specific CSS variables, no vendor
> lock-in.

"vendor lock-in" reads dev-y for a sailor reader. If the audience is dev,
it's fine. If you want both audiences, soften:

> The widget adapts to light/dark hosts automatically and works in any MCP
> client, not just Claude.

### I.3 README — `mcp.openwind.fr` link text

**File:** [`README.md`](../README.md), line 10.

> [**openwind.fr**](https://openwind.fr) · [`mcp.openwind.fr`](https://qdonnars-openwind-mcp.hf.space/) · MIT

The display text `mcp.openwind.fr` suggests a domain that isn't actually
wired (HF custom-domain is gated behind PRO per
[`hf-space/app.py:9-10`](../packages/hf-space/app.py#L9-L10)). Two options:

- **Honest:** show the real URL: `[hf.space](https://qdonnars-openwind-mcp.hf.space/)`
  and drop `mcp.openwind.fr` until the custom domain ships.
- **Aspirational:** keep the text and document the redirect once it ships.
  As long as the `href` works the user gets there fine — but it'll surprise
  anyone who copies the displayed text into an address bar.
