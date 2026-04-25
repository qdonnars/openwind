# Format de l'URL `/plan` — Option B actée

> **Décision du 2026-04-26 : Option B retenue.** Spec détaillée plus bas. Les autres options sont gardées comme référence pour V2.

Le tool `generate_plan_url` doit produire une URL qui :
1. encode tous les params du trajet (waypoints, départ, archétype) — zéro état serveur en V1
2. reste lisible / partageable
3. survit aux 10+ waypoints sans dépasser les limites pratiques (~2000 chars)
4. est versionnée pour qu'on puisse changer le format plus tard sans casser les anciens liens

## Option A — query params à plat (proposition initiale du brief)

```
https://openwind.fr/plan?from=43.30,5.35&to=43.00,6.20&via=43.10,5.80;43.05,6.00&dep=2026-04-26T08:00&boat=cruiser_30ft
```

- **+** très lisible, debuggable, partageable en clair
- **−** semi-colon dans `via` est URL-encodé en `%3B`, ça devient illisible une fois encodé
- **−** asymétrie `from`/`to`/`via` casse l'idée de liste ordonnée de waypoints
- **−** pas de `v=` (versioning)

## Option B — single `wp` param (recommandée)

```
https://openwind.fr/plan?v=1&wp=43.30,5.35|43.10,5.80|43.05,6.00|43.00,6.20&dep=2026-04-26T08:00&boat=cruiser_30ft
```

- Format de chaque waypoint : `lat,lon` en décimal, **4 décimales** (~11 m de précision, suffisant)
- Séparateur entre waypoints : `|` (URL-encodé `%7C`)
- `dep` : ISO 8601 en heure locale **sans timezone explicite** (l'app web reconstruit en Europe/Paris). Variante : `dep=1761465600` (epoch s) — plus court mais moins lisible.
- `boat` : slug d'archétype (`cruiser_30ft`, `cruiser_40ft`, …)
- `v` : version du format, à incrémenter si on casse la sémantique
- **+** un seul concept "waypoints", ordre explicite
- **+** versionné
- **+** ~80 chars pour 4 waypoints, scale linéaire (~15 chars/waypoint)
- **−** pipe encodé en `%7C` une fois (acceptable)

## Option C — base64-JSON dans un seul param

```
https://openwind.fr/plan?d=eyJ2IjoxLCJ3cCI6W1s0My4zLDUuMzVdLFs0My4xLDUuOF0sWzQzLjA1LDYuMF0sWzQzLjAsNi4yXV0sImRlcCI6IjIwMjYtMDQtMjZUMDg6MDAiLCJib2F0IjoiY3J1aXNlcl8zMGZ0In0
```

- **+** format évolutif sans casser la signature URL (un seul param qui contient un objet)
- **+** marginalement plus court que B au-delà de 8 waypoints
- **−** non-lisible, non-éditable à la main, non-partageable en clair
- **−** debugging plus chiant (faut décoder pour voir ce qu'on a)

## Option D — ID court vers KV store

`https://openwind.fr/plan/abc123`

- **−** explicitement hors V1 (décision actée : zéro état serveur)
- À garder en tête pour V2 si on veut des liens vraiment courts (Twitter, SMS).

## Recommandation : **Option B**

Lisible, versionnable, scale correctement jusqu'à 30+ waypoints, et le format pivot vers Option C ou D plus tard est trivial (l'app web parse `v=1` et lit en conséquence).

### Spec retenue (sous réserve de validation)

```
https://openwind.fr/plan?v=1
                        &wp=<lat,lon>|<lat,lon>|...
                        &dep=<ISO8601 local time, e.g. 2026-04-26T08:00>
                        &boat=<archetype_slug>
```

Règles :
- minimum 2 waypoints, maximum 30 (limite pratique)
- `dep` arrondi à l'heure (les données Open-Meteo sont au pas horaire)
- `boat` doit faire partie des slugs renvoyés par `list_boat_archetypes()` ; sinon l'app web affiche une erreur claire
- waypoints en lat,lon décimal, 4 décimales max (les arrondir côté `generate_plan_url`)

### Validation côté app web

Au chargement de `/plan?...`, l'app vérifie :
- `v` présent et = `1` (sinon : erreur "version d'URL non supportée, met à jour le client MCP")
- `wp` parse correctement, ≥ 2 waypoints, lat/lon dans plages valides
- `dep` parse en datetime
- `boat` connu

Si invalide : page d'erreur explicative + lien vers le mode exploration.

### Idempotence — qui calcule le passage affiché ?

Question structurante. Voir l'analyse détaillée dans [`01-challenges.md` § Variantes du calcul du passage](01-challenges.md#variantes-du-calcul-du-passage).
