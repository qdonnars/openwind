# OpenWind — Brief produit & plan d'exécution

> Source : brief utilisateur du 2026-04-25. Ce document est le **plan de référence**, archivé tel quel. Les amendements et challenges sont dans `01-challenges.md`. Les décisions actées sur les questions résiduelles sont dans `02-decisions.md`.

## 1. Vision produit

**OpenWind est un assistant de planification météo-marine en langage naturel pour la plaisance méditerranéenne.**

L'utilisateur ne consulte pas un outil. Il **discute** avec un LLM (Claude Desktop, Claude.ai, ou tout client MCP) du genre :

> "Quand penses-tu que je devrais aller à Porquerolles cette semaine, j'ai un Sun Odyssey 32 ?"

Et le système :

1. Récupère la météo marine sur la fenêtre demandée
2. Identifie les jours candidats (le LLM raisonne sur les prévisions)
3. Estime le trajet sur le ou les jours retenus (durée, indice de complexité)
4. Génère un lien vers une app web qui affiche le plan de nav précalculé

L'app web actuelle (consultation libre des prévisions multi-modèles) **continue d'exister en parallèle** comme outil d'exploration. Elle gagne en plus un mode "plan de nav" qui se charge avec un trajet précalculé en URL params.

**L'app web est strictement standalone : elle ne propose jamais de "lancer une conversation Claude".** Le point d'entrée conversationnel est l'autre côté (l'utilisateur ouvre Claude Desktop / Claude.ai et discute). L'app web est le renderer + l'éditeur, pas le portail.

## 2. Architecture cible — version cloud-agnostique

```
┌─────────────────────────────────────────────────────────────┐
│  Utilisateur en conversation avec un LLM (Claude Desktop)  │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP protocol
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenWind MCP Space (Gradio + FastMCP, sur HF Spaces)      │
│  - mcp.openwind.fr (custom domain)                          │
│  - Mince wrapper Gradio qui expose 4 outils MCP             │
│  - Importe openwind_mcp_core (qui importe openwind_data)    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  openwind_mcp_core (Python pkg, cloud-agnostic)            │
│  - Définit les 4 outils MCP en pur FastMCP                  │
│  - Aucune dépendance à HF ni à Gradio                       │
│  - Re-déployable sur Fly, Modal, AWS Lambda, VPS, etc.      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  openwind_data (Python pkg, métier pur)                    │
│  - OpenMeteo adapter (vent + marine)                        │
│  - Polaires archétypes (5 JSON)                             │
│  - Routing : géométrie, passage, complexité                 │
└─────────────────────────────────────────────────────────────┘

                       + en parallèle, indépendant :

┌─────────────────────────────────────────────────────────────┐
│  App web (React, openwind.fr, GitHub Pages)                │
│  - Mode "exploration" : carte + tableau multi-modèles       │
│    (continue de fetcher Open-Meteo côté client)             │
│  - Mode "plan de nav" : route /plan?params=...              │
│    qui affiche un trajet précalculé fourni par le MCP       │
└─────────────────────────────────────────────────────────────┘
```

**Principe directeur :** la séparation entre `data`, `mcp-core` et le wrapper de déploiement (`hf-space`) est **stricte**. Si demain on veut basculer sur Fly.io, AWS, ou un VPS, on remplace seulement le wrapper. Le code métier reste identique.

## 3. Cible utilisateur & scope métier

**Cible** : plaisancier méditerranéen, 30-50 ans, sortie 1-3 jours, voilier de croisière, qui en a marre des interfaces marines des années 90.

**Méditerranée only en V1.** Conséquences :

- Marées ignorées (marnage < 40 cm)
- Courants tidaux ignorés
- AROME pondéré plus fort que les autres modèles (résolution 1.3 km, capture les vents thermiques et locaux)
- Vents locaux à reconnaître : mistral, tramontane, sirocco, marin, levante, libeccio
- Zones d'accélération côtière à signaler explicitement *(retiré, cf. 02-decisions.md)*

**Scope V1 délibérément limité** :

- Trajets en ligne droite (orthodromie), waypoints intermédiaires possibles si l'utilisateur veut éviter une côte
- Pas de routing fin avec optimisation
- Pas de polaires personnalisées (5 archétypes seulement)
- Pas d'AIS, pas de courants, pas de marées
- Pas de scoring numérique des fenêtres météo : le LLM raisonne sur les prévisions brutes

## 4. Définition des outils MCP

### `get_marine_forecast(lat, lon, start_time, end_time, models?)`

Renvoie vent (TWS, TWD, rafales) + mer (hauteur, période, direction houle) à un point, sur une fenêtre temporelle, pour un ou plusieurs modèles. Step horaire. Multi-modèles si demandé (AROME, ICON, GFS, ECMWF). Format de sortie : JSON structuré.

### `estimate_passage(waypoints, departure_time, boat_archetype, efficiency?)`

- `waypoints` : liste de tuples (lat, lon), au minimum 2, autant que voulu pour contourner des côtes
- Découpe en sous-segments d'environ 5 NM
- Pour chaque sous-segment : fetch météo au point milieu à l'heure estimée, calcule TWA = (TWD - bearing) normalisé, lookup polaire, applique efficacité (défaut 0.75)
- Itère : chaque segment fait avancer l'horloge
- Renvoie : ETA, distance, durée totale, segments détaillés (TWA, TWS, vitesse bateau, mer), indice de complexité agrégé

### `list_boat_archetypes()`

Renvoie les 5 archétypes disponibles avec caractéristiques (longueur, type, performance relative). Permet à Claude de mapper "j'ai un Sun Odyssey 32" → `cruiser_30ft`.

### `generate_plan_url(waypoints, departure_time, boat_archetype)`

Renvoie une URL `https://openwind.fr/plan?...` qui ouvre l'app web sur ce trajet. V1 : URL longue avec tous les params encodés (zéro état serveur).

## 5. Domain knowledge à coder

### Polaires (5 archétypes ORC)

- `cruiser_30ft` : voilier de croisière 30 pieds (Sun Odyssey 30, First 31.7)
- `cruiser_40ft` : voilier de croisière 40 pieds
- `cruiser_50ft` : voilier de croisière 50 pieds
- `catamaran_40ft` : catamaran de croisière 40 pieds
- `racer_cruiser` : course-croisière, plus performant à toutes les allures

Format JSON standard : matrice `[TWS][TWA] → boat_speed`, TWS de 4 à 30 nds par pas de 2, TWA de 30° à 180° par pas de 10°. Sources : ORC (data.orc.org).

### Indice de complexité

Score à 4 niveaux (green/yellow/orange/red) basé sur le plus pessimiste des 2 facteurs :

**Vent (sur le trajet entier)** :

- Vert : TWS médian < 15 nds ET max < 22 nds
- Jaune : TWS médian 15-22 nds OU max 22-28 nds
- Orange : TWS médian 22-28 nds OU max 28-35 nds
- Rouge : au-delà

**Mer** :

- Vert : Hs < 1m
- Jaune : Hs 1-2m
- Orange : Hs 2-3m
- Rouge : Hs > 3m

**Score global** = max des facteurs (le plus pessimiste l'emporte). Output structuré avec `overall`, `confidence`, `factors`, `rationale` (texte court explicatif), `warnings` (liste).

## 6. Structure du repo cible

```
openwind/  (repo renommé depuis open_wind)
├── packages/
│   ├── data-adapters/                       [Python, pur métier]
│   │   ├── pyproject.toml
│   │   ├── src/openwind_data/
│   │   │   ├── adapters/
│   │   │   │   ├── base.py                  # Protocol MarineDataAdapter + dataclasses
│   │   │   │   └── openmeteo.py             # adapter unifié vent + marine
│   │   │   ├── polars/
│   │   │   │   ├── cruiser_30ft.json
│   │   │   │   ├── cruiser_40ft.json
│   │   │   │   ├── cruiser_50ft.json
│   │   │   │   ├── catamaran_40ft.json
│   │   │   │   └── racer_cruiser.json
│   │   │   ├── routing/
│   │   │   │   ├── geometry.py              # orthodromie, bearing, segments
│   │   │   │   ├── passage.py               # estimate_passage
│   │   │   │   └── complexity.py            # indice + agrégation
│   │   │   └── archetypes.py                # registry des polaires
│   │   └── tests/
│   │
│   ├── mcp-core/                            [Python, FastMCP, cloud-agnostic]
│   │   ├── pyproject.toml
│   │   ├── src/openwind_mcp_core/
│   │   │   ├── server.py                    # build_server() -> FastMCP
│   │   │   └── url_builder.py               # generate_plan_url
│   │   └── tests/
│   │
│   ├── hf-space/                            [Wrapper de déploiement HF]
│   │   ├── README.md                        # vitrine publique du Space
│   │   ├── app.py                           # Gradio + import mcp-core
│   │   ├── requirements.txt                 # deps HF Space (incl. local pkgs)
│   │   └── space_config.yaml                # config HF Space si nécessaire
│   │
│   └── web/                                 [TypeScript, existant]
│       ├── ...
│       └── src/plan/                        # nouveau mode "plan de nav"
│
├── docs/
│   ├── architecture.md
│   ├── data-sources.md
│   ├── boat-archetypes.md
│   └── deployment.md                        # documente HF + alternatives
├── .claude/
│   └── skills/
│       └── add-data-source/SKILL.md
├── .github/workflows/
├── CLAUDE.md                                # racine, working notes
├── README.md
└── LICENSE                                   # MIT
```

## 7. Stack technique imposée

- **Python** : 3.12, gestion deps via `uv`, `pyproject.toml` avec workspaces
- **Lint/format Python** : `ruff`
- **Tests Python** : `pytest` + `pytest-asyncio` + `respx`
- **HTTP Python** : `httpx` (async)
- **MCP** : SDK `mcp` officiel (FastMCP)
- **Wrapper HF** : `gradio` ≥ 5.28
- **Hébergement MCP** : Hugging Face Spaces (CPU Basic, gratuit)
- **TypeScript** : conserve l'existant (React 19, Vite 8, Tailwind 4)
- **Domaine** : `openwind.fr` + sous-domaine `mcp.openwind.fr`
- **Hébergement web** : GitHub Pages (existant)
- **Conventional commits** : `feat:`, `fix:`, `refacto:`, `docs:`, `chore:`, `test:`

## 8. Plan d'exécution global

### Sprint 0 — Infrastructure & domaine

État de départ réel (vérifié 2026-04-25) :
- Repo local : `/home/qdonnars/projects/open_wind/` (PAS encore renommé)
- Remote GitHub : `git@github.com:qdonnars/open_wind.git`
- Domaine `openwind.fr` acheté chez Gandi avec WHOIS protection active

Étapes :

1. **Renommer le repo GitHub** `open_wind` → `openwind` (Settings → Rename), puis `git remote set-url origin git@github.com:qdonnars/openwind.git`. Optionnel : renommer le dossier local en `openwind/`.

2. **Brancher openwind.fr sur GitHub Pages** :
   - GitHub : Settings → Pages → Custom domain → `openwind.fr` → Save → Enforce HTTPS
   - Ajouter `public/CNAME` avec contenu `openwind.fr` (sinon Pages perd le custom domain à chaque deploy)
   - Gandi DNS : 4 enregistrements A pour `@` (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`). CNAME `www` → `qdonnars.github.io.`
   - `vite.config.ts` : `base: '/'`
   - Vérifier propagation : `dig openwind.fr`

3. **Setup Hugging Face** :
   - Compte HF + access token scope `write`
   - Création du Space repoussée au Sprint 4

4. **Refacto monorepo** (branche `refacto/monorepo`) :
   - `packages/web/` ← contenu actuel
   - `package.json` racine avec workspaces npm
   - Adapter `.github/workflows/deploy.yml` (path `packages/web/`)
   - Créer `packages/data-adapters/`, `packages/mcp-core/`, `packages/hf-space/` (squelettes)
   - `docs/`, `.claude/skills/`, `CLAUDE.md` racine

5. **Nettoyage repo** :
   - Supprimer `src/components/QuickSpots.tsx` (non importé)
   - Supprimer `src/spots.ts` (tableau vide) + adapter `SpotMap.tsx`
   - Supprimer bloc `.current-hour-marker` orphelin dans `index.css`
   - README : React 19 (pas 18)

6. **Licence MIT** : créer `LICENSE`.

7. **Migration `.claude/CLAUDE.md`** : le fichier actuel dit "Améliorer le DESIGN et l'UX uniquement. Pas de nouvelle feature." — à remplacer par le nouveau CLAUDE.md racine de la section 9 (le périmètre du projet pivote).

**Livrable Sprint 0** : `openwind.fr` répond en HTTPS sur l'app actuelle, monorepo propre, compte HF prêt.

### Sprint 1 — Fondations data-adapters

1. `packages/data-adapters/pyproject.toml` : `httpx`, `pydantic`. Dev : `pytest`, `pytest-asyncio`, `respx`, `ruff`.
2. `adapters/base.py` : dataclasses `WindPoint`, `SeaPoint`, `ForecastBundle`. Protocol `MarineDataAdapter`.
3. `adapters/openmeteo.py` : classe `OpenMeteoAdapter`, fetch parallèle des deux endpoints via `asyncio.gather`, cache mémoire 30 min, gestion d'erreur réseau.
4. Tests unitaires avec `respx`, fixtures réalistes Open-Meteo, test cache, test erreurs.

**Livrable Sprint 1** : `await adapter.fetch(lat=43.3, lon=5.35, ...)` renvoie une structure propre.

### Sprint 2 — Routing : géométrie, polaires, passage

1. `routing/geometry.py` : `haversine_distance`, `bearing`, `segment_route`, `midpoint`, `normalize_twa`.
2. **Polaires** : 5 polaires ORC (data.orc.org ou specs constructeur). Format JSON `[TWS][TWA] → boat_speed`.
3. `archetypes.py` : registry, `get_polar(name)`, `list_archetypes()`.
4. `routing/passage.py` : dataclasses `SegmentReport`, `PassageReport`. Algo itératif (fetch midpoint, lookup polaire, applique efficacité, avance horloge). Interpolation bilinéaire.
5. Tests : Marseille → Porquerolles avec vent constant mocké. Cas avec waypoints intermédiaires.

**Livrable Sprint 2** : `estimate_passage` rend un rapport complet.

### Sprint 3 — Complexity + `openwind_mcp_core`

1. `routing/complexity.py` : `ComplexityScore`, scoring vent/mer, agrégation max, rationale en f-string.
2. ~~`routing/zones_med.py`~~ retiré (cf. 02-decisions.md).
3. `packages/mcp-core/pyproject.toml`. Deps : `mcp[cli]`, `openwind_data` en local.
4. `mcp_core/server.py` : factory `build_server() -> FastMCP`, 4 outils.
5. Tests d'intégration locaux : `scripts/run_local.py`, config `claude_desktop_config.json`, conversation test end-to-end.
6. `docs/architecture.md` : pattern d'orchestration (forecast → raisonnement LLM → passage).

**Livrable Sprint 3** : conversation Claude Desktop fonctionnelle en local.

### Sprint 4 — Déploiement HF Space + intégration app web

1. **Wrapper HF Space** (`packages/hf-space/app.py`) : Gradio mince qui importe `build_server()` de `openwind_mcp_core`, expose via `mcp_server=True`.
2. **GitHub Action de sync** : workflow qui pousse `packages/hf-space/` vers le repo HF Space à chaque push sur main (cf. 02-decisions.md).
3. **Brancher mcp.openwind.fr** : Custom Domain HF + CNAME `mcp` → `hf.space` chez Gandi. Plan B : URL `qdonnars-openwind-mcp.hf.space`.
4. **Mode plan de nav web** : route `/plan`, parse params URL, polyline coloré par segment, panneau ETA/durée/distance/indice/warnings/breakdown. Lecture seule en V1.
5. **Documentation finale** : `CLAUDE.md`, `README.md` racine, `packages/hf-space/README.md`, `docs/`.
6. **Démo end-to-end** : GIF/Loom de la conversation Claude → trajet → app web.

**Livrable Sprint 4** : démo production-ready.

## 9. CLAUDE.md à initialiser à la racine du repo

(Voir version brouillon dans le brief original — sera créé au Sprint 0 étape 7.)

## 10. Décisions actées

(Voir `02-decisions.md` pour les décisions actées sur les questions résiduelles, notamment : pas de mapping de bateau côté serveur, pas de zones d'accélération, format URL retenu, pas de stratégie autosleep, GitHub Action de sync HF.)
