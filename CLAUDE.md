# OpenWind — Working Notes for Claude

## Mission

Open-source Mediterranean sailing planner powered by an MCP server and a public web app.
The user describes their trip in natural language to an LLM (Claude Desktop, Claude.ai, any MCP client).
The LLM orchestrates marine data fetches, estimates passage time and complexity via MCP tools,
and renders a precomputed plan in the standalone web app.

The web app is **strictly standalone** — it never proposes "talk to Claude". Conversational entry happens on the user's MCP client side.

## Architecture (cible)

- `packages/web/` — React 19 + TypeScript + Vite, deployed to GitHub Pages on **openwind.fr**
- `packages/data-adapters/` — Python lib, pure domain logic (marine data adapters, polars, routing, complexity)
- `packages/mcp-core/` — Python lib, FastMCP server definition (cloud-agnostic, redeployable anywhere)
- `packages/hf-space/` — Thin Gradio wrapper for Hugging Face Spaces deployment, served at **mcp.openwind.fr**

État actuel (2026-04-26) : la migration vers cette structure est en cours, voir `plan/` à la racine.

## Cloud-agnostic principle (non-négociable)

The MCP server core (`mcp-core`) MUST stay deployment-agnostic.
The `hf-space/` package is a thin wrapper for HF Spaces.
We could re-deploy on Fly.io, Modal, or self-hosted by writing a different wrapper without touching `mcp-core` or `data-adapters`.

→ Concrètement : aucun import de `gradio` ou de `huggingface_hub` dans `mcp-core` ou `data-adapters`. Si tu en vois un, c'est un bug.

## Domain knowledge — Sailing

- Wind speeds always in **knots**, never km/h
- Wind directions in TWD/TWA/AWA/AWS conventions, document explicitly when used
- True heading vs magnetic heading — V1 uses true throughout
- Mediterranean specifics:
  - Tides negligible (< 40 cm), ignored in V1
  - Tidal currents not significant; permanent currents (Liguro-Provençal) ignored in V1
  - **AROME** is the default high-resolution model (1.3 km, captures thermal and local winds). When `models` not specified, return AROME first / use AROME for passage estimation.
  - Local wind names: mistral (NW), tramontane (NW), sirocco (SE), marin (SE-S), levante (E), libeccio (SW)

## Data sources of record

- **Open-Meteo Forecast API** — wind, multi-model (AROME, ICON, GFS, ECMWF), keyless
- **Open-Meteo Marine API** — wave height, period, direction, wind wave vs swell, keyless
- (V2 candidates) Météo-France API for official BMS bulletins

## Conventions

- Python: ruff for lint + format, pytest for tests, uv for env management
- TypeScript: ESLint flat config (existing)
- Commits: **conventional commits** (`feat:`, `fix:`, `refacto:`, `docs:`, `chore:`, `test:`)
- All adapters implement `MarineDataAdapter` Protocol from `adapters/base.py`
- Async everywhere (httpx, asyncio.gather)
- Browser automation : **Chrome DevTools MCP** (Playwright débranché)

## Failure modes — things to avoid

- ❌ Don't add heavy backend deps to `packages/web/` — must stay GH Pages-deployable
- ❌ Don't ship API keys in the bundle (Open-Meteo is keyless, keep it that way)
- ❌ Don't break `main` branch deployment during refactos — work on branches
- ❌ Don't replace LLM qualitative judgment with numerical scoring (no `find_best_window` in V1)
- ❌ Don't try to compete with real routing tools (Predict Wind, qtVlm) on optimization
- ❌ Don't couple `mcp-core` to Gradio or HF Spaces — those belong only in `hf-space/`
- ❌ Don't make the web app propose "chat with Claude" — it stays standalone
- ❌ Don't réintroduire les zones d'accélération côtière (retiré V1, cf. `plan/02-decisions.md`)
- ❌ Don't shipper de mapping "Sun Odyssey 32 → cruiser_30ft" en dur côté serveur — le LLM décide à partir des descriptions de `list_boat_archetypes()`

## HF Space deployment notes

- Space type: Gradio, hardware CPU Basic (free)
- Custom domain `mcp.openwind.fr` via CNAME to `hf.space`
- Space autosleeps; first call after idle has ~5s cold start — accepté en V1, pas de pré-warming
- Public README of the Space is `packages/hf-space/README.md` — treat as marketing surface
- Auto-deploy via GitHub Action (push `packages/hf-space/**` → repo HF Space, secret `HF_TOKEN`)

## URL `/plan` format

Format actée : Option B (cf. `plan/03-url-format.md`).

```
https://openwind.fr/plan?v=1&wp=43.30,5.35|43.10,5.80|43.00,6.20&dep=2026-04-26T08:00&boat=cruiser_30ft
```

- `v=1` : version du format
- `wp` : waypoints `lat,lon` séparés par `|`, 4 décimales max
- `dep` : ISO 8601 local time (Europe/Paris implicite)
- `boat` : slug d'archétype

## Workflow

- Plan files in `plan/` are the source of truth for scope and decisions
- Tests must pass before commit
- After-action: every recurring mistake gets logged here as a new "Failure mode"
- Pour toute tâche browser/UI : utiliser Chrome DevTools MCP, pas Playwright

## Plan en cours

Voir `plan/README.md` pour l'index. Sprints 0 → 4 documentés, Sprint 0 en attente d'actions humaines (rename GitHub repo + DNS Gandi).
