# Challenges du plan — points à trancher avant de coder

Lecture critique du brief produit (`00-vision-and-execution.md`). Chaque point identifie soit une incohérence, soit un risque, soit une décision implicite qu'il faut rendre explicite. Classés par sévérité.

---

## 🔴 Bloquants — à régler avant Sprint 0

### 1. État de départ du Sprint 0 est faux

Le brief dit : *"État de départ : le repo a déjà été renommé open_wind → openwind"*.

**Réalité (vérifiée 2026-04-25) :**
- Working directory local : `/home/qdonnars/projects/open_wind/`
- `git remote get-url origin` → `git@github.com:qdonnars/open_wind.git`

Le rename n'a **pas** été fait. Sprint 0 doit l'inclure comme première étape : rename GitHub puis `git remote set-url origin`. Optionnellement, renommer le dossier local (impacte les chemins de session).

### 2. Conflit de périmètre avec le `.claude/CLAUDE.md` actuel

Le fichier projet actuel ([.claude/CLAUDE.md](/home/qdonnars/projects/open_wind/.claude/CLAUDE.md)) dit :

> Améliorer le DESIGN et l'UX uniquement. Pas de nouvelle feature.
> Ne pas changer la logique métier ou l'API

Ce brief est l'**inverse** : on ajoute un backend Python complet, des outils MCP, on change l'API. Si Claude charge ces instructions au démarrage et trouve une contradiction, comportement imprévisible.

→ **Action** : Sprint 0 doit explicitement remplacer ce fichier par le nouveau `CLAUDE.md` racine. Ne pas le laisser traîner.

### 3. CNAME file manquant pour GitHub Pages custom domain

Le plan détaille les enregistrements DNS et le toggle "Custom domain" dans Settings, mais **omet le fichier `public/CNAME`**. Sans lui, GitHub Pages reset le custom domain à chaque deploy et l'app sert sur `qdonnars.github.io/openwind/` jusqu'à ce qu'on reconfigure manuellement. Classique.

→ **Action** : ajouter `public/CNAME` contenant `openwind.fr` au Sprint 0 étape 2.

### 4. Le `vite.config.ts` change `base`, mais le `dist/` checked-in reste obsolète

Le repo a un `dist/` versionné (visible dans `ls -la`) qui contient des assets buildés avec `base: '/open_wind/'`. Après changement de `base`, il faudra : soit ne plus commiter `dist/` (recommandé, c'est ce que fait l'action `actions/upload-pages-artifact`), soit le rebuild.

→ **Action** : vérifier `.gitignore` et retirer `dist/` du tracking si présent.

---

## 🟠 Importants — à clarifier en sprint

### 5. Contradiction "AROME pondéré plus fort" ↔ "le LLM raisonne sur les prévisions brutes"

Section 3 dit "AROME pondéré plus fort que les autres modèles". Section 10 dit "Pas de `find_best_window` : Claude raisonne sur les prévisions brutes". Si on ne fait pas de scoring, qu'est-ce que "pondéré" veut dire concrètement ?

**Interprétations possibles :**
- (a) AROME est le **modèle par défaut** quand `models` n'est pas spécifié dans `get_marine_forecast`
- (b) On retourne tous les modèles mais l'ordre des clés met AROME en premier (signal pour le LLM)
- (c) Dans `estimate_passage`, c'est AROME qui est utilisé pour le calcul (et les autres modèles ne servent que pour `get_marine_forecast`)

→ **Action** : trancher entre (a)+(c) (recommandé, simple) ou autre. Documenter dans `docs/data-sources.md` au Sprint 1.

### 6. Open-Meteo Marine API ≠ même grille temporelle/spatiale que Forecast

Le plan dit "fetch les deux endpoints en parallèle via `asyncio.gather`" comme si c'était symétrique. En réalité :
- Forecast (vent) : pas horaire, modèles AROME/ICON/GFS/ECMWF
- Marine (mer) : pas horaire en surface mais le modèle sous-jacent est typiquement **wave-only ECMWF**, pas multi-modèle. Couverture côtière fine = ?
- Couverture en zones côtières fermées (golfe de Marseille) : à vérifier — la grille marine peut avoir des trous près des côtes.

→ **Action** : Sprint 1 — au moment d'écrire l'adapter, faire 2-3 requêtes manuelles à Open-Meteo Marine sur des points méditerranéens (Marseille, Porquerolles, Bonifacio) et **vérifier qu'on récupère bien des données** avant de coder. Si la grille marine a des trous, prévoir un fallback (interpolation au point voisin, ou Hs absent traité comme "data manquante").

### 7. Algo `estimate_passage` : pas de fixed-point sur l'ETA

L'algo est : "pour chaque sous-segment, fetch météo au midpoint **à l'heure estimée**, calcule la vitesse, avance l'horloge". Le piège : l'heure estimée d'arrivée au segment N dépend de la vitesse au segment N, qui dépend du vent au segment N, qui dépend de l'heure d'arrivée. Boucle.

En pratique, avec des segments de 5 NM et un bateau à 5 nds, on arrive ~1h plus tard, et les données Open-Meteo sont au pas horaire — donc tant que la vitesse change peu d'un segment au suivant, single-pass suffit. Mais c'est une approximation à documenter.

→ **Action** : ajouter un comment dans `passage.py` qui dit "single-pass approximation, no iterative refinement", et un test qui mesure l'écart sur un trajet où le vent change vite (ex : passage frontal).

### 8. `efficiency=0.75` par défaut : valeur magique

0.75 sur la polaire ORC est conservateur (équipage croisière, mer formée). Mais il n'est pas justifié dans le plan, et c'est une variable qui change l'ETA de ±15%.

→ **Action** : Sprint 2 — documenter l'origine de la valeur (e.g. "facteur empirique pour équipage croisière, mer formée 1-2m, sans optimisation de réglages") dans `boat-archetypes.md`. Permettre à `estimate_passage` de prendre `efficiency` en param explicite (déjà prévu) pour que le LLM puisse l'ajuster si l'utilisateur dit "je suis seul" (0.65) vs "régate" (0.85).

### 9. Test Sprint 2 : assertion floue ("entre 8h et 12h")

Le brief dit "Vérification que la durée totale a du sens (entre 8h et 12h pour Marseille-Porquerolles selon vent)". Avec un mock de vent constant, la durée est **déterministe**. L'assertion doit être exacte (à ±1 min près).

→ **Action** : Sprint 2 — pour les tests à vent constant mocké, calculer manuellement l'attendu et asserter à l'égalité. Garder les fourchettes pour les tests d'intégration en bout de chaîne (Sprint 3) où on appelle vraiment Open-Meteo.

### 10. `generate_plan_url` : la spec reste imprécise

Section 4 dit juste "URL longue avec tous les params encodés". Pas de spec.

→ **Réglé** dans `03-url-format.md`. Voir.

### 11. Qui calcule le passage affiché dans `/plan` côté web ?

#### Variantes du calcul du passage

L'utilisateur clique sur le lien `openwind.fr/plan?v=1&wp=...&dep=...&boat=...` reçu de Claude. Question : que voit-il exactement, et quel composant fait le boulot ?

Cas d'usage à servir :
1. **Clic immédiat** (< 1 min après génération par Claude) : prévisions identiques à celles que Claude a vues, on veut idéalement ne pas refaire de calcul
2. **Clic différé** (heures ou jours plus tard) : les prévisions ont changé, faut-il recalculer ou afficher l'ancien plan ?
3. **Lien partagé** (ami à qui on envoie l'URL) : il n'a pas eu la conversation, mais il a un trajet à exécuter
4. **Réseau dégradé** (terrain, port, 3G capricieuse) : que se passe-t-il si la requête de calcul échoue ?

---

##### Variante 1 — Calcul côté JS dans le navigateur

L'app web charge `/plan?...`, parse les waypoints/dep/boat, fetch Open-Meteo directement depuis le navigateur (comme le mode exploration le fait déjà), et exécute le routing en TypeScript.

**Ce que ça implique concrètement** :
- Réimplémenter en TS : géométrie (haversine, bearing, segmentation), lookup polaires, interpolation bilinéaire, agrégation de complexité, génération du rationale
- Embarquer les 5 polaires JSON dans le bundle web (~50 KB total, OK)
- Algo identique à `data-adapters/routing/passage.py` mais en TS — **double maintenance**

**+ Avantages** :
- Pas de dépendance au Space pour rendre `/plan` (résilient si HF tombe)
- Pas de cold-start
- Cas (1) (2) (3) gèrent identique : à chaque chargement, prévisions fraîches
- L'app web reste 100% statique, GH Pages-friendly

**− Inconvénients** :
- **Duplication de la logique métier dans deux langages**. Tout changement (correction de bug polaire, tweak du seuil de complexité, nouvel archétype) doit être fait deux fois. Risque de divergence subtile.
- Tests de parité Python/TS à maintenir
- Cas (4) : si Open-Meteo est down côté client, plus rien ne marche. Pas de fallback.
- TS path : packages/web/ devient gros (logique routing), perd sa simplicité de "vue"

**Coût d'implémentation V1** : ~1.5 sprint supplémentaire (port TS + tests de parité).

---

##### Variante 2 — Endpoint REST sur le Space (recommandée)

Le wrapper HF expose deux surfaces côté serveur : (a) le protocol MCP pour les LLMs, (b) un endpoint REST `/api/passage` consommé uniquement par l'app web. Les deux importent `openwind_mcp_core` ou `openwind_data` directement.

**Spec du REST proposée** :
```
POST https://mcp.openwind.fr/api/passage
Content-Type: application/json
{ "waypoints": [[43.30,5.35],[43.10,5.80],[43.00,6.20]],
  "departure_time": "2026-04-26T08:00",
  "boat_archetype": "cruiser_30ft" }
→ 200 { ...PassageReport JSON identique au tool MCP estimate_passage... }
```

**Ce que ça implique concrètement** :
- Ajouter une route FastAPI ou Flask dans `packages/hf-space/app.py` à côté de Gradio (Gradio MCP expose déjà du HTTP, on greffe une route)
- L'app web fait `fetch('https://mcp.openwind.fr/api/passage', { method: 'POST', body: ... })` au chargement de `/plan`
- CORS à configurer (`Access-Control-Allow-Origin: https://openwind.fr`)
- Rate-limit léger côté Space (ex : 60 req/IP/min) pour éviter l'abus

**+ Avantages** :
- **Single source of truth** : la logique de routing vit en Python, point. JS appelle une API.
- Cas (1) (2) (3) : prévisions toujours fraîches au chargement, calcul cohérent avec ce que Claude a vu (même code)
- Évolutions futures (V2 : courants, fixed-point iterative refinement) ne touchent pas l'app web
- L'app web reste mince : juste de l'UI

**− Inconvénients** :
- **Couplage** : si HF dort, l'app web a un cold-start visible (~5s, mais on a accepté ça en décision §2.4)
- Si HF tombe complètement, `/plan` ne marche plus du tout
- CORS + rate-limit = un peu de plomberie sécurité
- Cas (4) (réseau dégradé) reste fragile

**Coût d'implémentation V1** : ~0.5 sprint (route + CORS + fetch côté web).

---

##### Variante 3 — Passage encodé dans l'URL (Option C de la spec URL)

Le tool MCP `generate_plan_url` calcule le passage côté serveur, sérialise tout (waypoints + segments + ETA + complexité + rationale) en JSON, encode en base64 dans l'URL.

**Ce que ça implique concrètement** :
- L'URL devient longue (1-3 KB selon waypoints)
- L'app web décode et affiche, **zéro fetch**
- Passe la limite des ~2000 chars URL pour les longs trajets — il faut basculer sur un POST-redirect ou un short-link

**+ Avantages** :
- **Vraiment standalone** : l'app web n'a aucune dépendance externe au chargement
- Le plan est figé à l'instant de génération (cohérent avec ce que Claude a dit à l'utilisateur)
- Idéal pour l'archivage / partage (le plan ne change pas)

**− Inconvénients** :
- Cas (2) : prévisions périmées au clic différé, l'utilisateur voit un plan obsolète sans warning
- URLs cassent au-delà de ~10-15 waypoints
- Pas de mise à jour si les prévisions changent — pour un trajet J+2, le plan n'est plus pertinent
- Difficile à debugger (le payload est opaque dans l'URL)
- Forcerait Claude à **toujours** appeler `estimate_passage` avant `generate_plan_url`, alors qu'on aimerait pouvoir générer une URL "vide" (juste le trajet) pour exploration

**Coût d'implémentation V1** : ~0.3 sprint (encode/decode + UI), mais souffre de mauvais cas d'usage.

---

##### Variante 4 — Hybride (recalcul + cache léger)

Mix de 2 et 3 : l'URL contient les params bruts (Option B), l'app web tente d'abord un appel REST au Space, et fallback sur un calcul JS minimal si le Space est down.

**+ Avantages** : robuste, cohérent
**− Inconvénients** : combine les coûts d'impl de Variante 1 et 2. Probablement overkill pour V1.

**Coût d'implémentation V1** : ~2 sprints. Hors scope V1.

---

##### Recommandation finale

**Variante 2** pour V1.

Raisons :
- Garde la logique métier en un seul langage (Python)
- Coût d'implémentation faible (0.5 sprint)
- Couplage HF accepté : on a déjà décidé de tolérer le cold-start (§2.4)
- L'app web reste mince et statique, conforme à la doctrine "openwind.fr = juste un renderer"
- Si HF devient un goulot, on peut basculer vers Variante 4 sans changer le format d'URL (rétro-compatible)

À documenter en Sprint 4 : la spec REST, les CORS, le rate-limit. À ajouter dans `CLAUDE.md` : "le Space expose 2 surfaces (MCP + REST `/api/passage`), ne pas croire que MCP est l'unique entrée".

→ **Décision recommandée** : Variante 2 (REST endpoint sur le Space). À confirmer.

---

## 🟡 Mineurs — à garder en tête

### 12. URL longue + Claude Desktop

Avec 10 waypoints, l'URL retournée par `generate_plan_url` peut faire 200+ chars. Claude Desktop **affiche** les URLs des tools, ça reste OK. Mais sur `/plan?...` partagé en SMS ou affiché dans des UIs avec preview, ça peut tronquer. Format Option B est le plus court raisonnable. Option D (ID court) reste l'évolution logique en V2.

### 13. Conventional commits pas enforced

Le brief dit "obligatoire" mais sans hook pre-commit ni CI check. Recommandation : `commitlint` + pre-commit hook au Sprint 0 ou plus tard. Pas bloquant.

### 14. Pas de plan pour les secrets

`HF_TOKEN` doit être un secret GitHub Actions. Pas de gestion d'autres secrets prévue (Open-Meteo est keyless, OK). À acter au Sprint 4 quand on configure le workflow de sync.

### 15. Pas de plan de test pour le mode "plan de nav" web

Sprint 4 décrit ce que ça affiche mais ne spécifie aucun test (Playwright/Vitest/visual regression). On a viré Playwright et on bascule sur Chrome DevTools MCP (claudechrome). Pour V1, tests manuels OK ; à doc dans `CLAUDE.md`.

### 16. React 19 + Vite 8 + Tailwind 4 : edges à surveiller

Stack récente, certains plugins peuvent ne pas être stables. Vérifier au Sprint 0 que le build fonctionne bien depuis `packages/web/` avec workspace npm — les workspaces et les plugins Vite peuvent se marcher dessus sur la résolution des paths.

### 17. Suppression de `src/spots.ts` — vérifier les imports

Le brief dit "Supprimer src/spots.ts (n'exporte qu'un tableau vide) et adapter SpotMap.tsx en conséquence". Avant de supprimer, vérifier que rien d'autre n'importe `spots.ts` (peut-être que `SpotMap` n'est même pas le seul consommateur). Sprint 0 étape 5.

### 18. Conflit `eval_screenshots.ts` / `strategy_improvement.sh` / `test-results/`

Ces fichiers à la racine semblent liés à la phase "amélioration design + Playwright". Avec le pivot et le passage à Chrome DevTools MCP, ils sont probablement obsolètes. À nettoyer au Sprint 0 étape 5 ou via un commit séparé.

---

## 🟢 Décisions implicites du brief, à expliciter

### 19. Timezone du `departure_time`

Le tool `estimate_passage` prend `departure_time` mais ne dit pas s'il est en UTC, local time, ou quelle TZ. La cible est méditerranéenne donc Europe/Paris (CET/CEST). Default sain : accepter ISO 8601 et si pas de TZ explicite, **assumer Europe/Paris**. Documenter dans la docstring du tool.

### 20. Précision lat/lon

Le brief n'impose rien. Recommandation : 4 décimales en entrée et sortie (~11m), arrondir dans `generate_plan_url` pour limiter la longueur.

### 21. Cap sur le nombre de waypoints

Pas mentionné. Recommandation : limite à 30 dans `estimate_passage` pour éviter les abus, retourner une erreur claire au-delà. Le LLM peut être créatif sinon.

### 22. Quoi faire quand un point est sur terre ?

Si un waypoint tombe sur la côte ou dans les terres, Open-Meteo Marine renvoie probablement vide / null. Comportement à définir : reject à l'entrée, ou continuer en signalant ?

→ Recommandation V1 : **reject** avec message explicite. La détection peut être simple (Open-Meteo renvoie null → erreur "waypoint apparemment sur terre, ajuste la position").

### 23. Versioning de la sortie des tools MCP

Pas de versioning des structures de sortie. Si demain on change le shape de `PassageReport`, les LLMs anciens consommateurs cassent. À garder léger en V1 (les LLMs s'adaptent), mais pas oublier qu'à V2 on voudra peut-être un `schema_version` dans chaque réponse.

---

## Synthèse des actions à intégrer au plan

| # | Sprint | Action |
|---|--------|--------|
| 1 | 0 | Renommer le repo GitHub avant tout |
| 2 | 0 | Remplacer `.claude/CLAUDE.md` par le nouveau CLAUDE.md racine |
| 3 | 0 | Ajouter `public/CNAME` contenant `openwind.fr` |
| 4 | 0 | Retirer `dist/` du tracking git |
| 5 | 1 | Documenter sémantique "AROME pondéré" (default model + utilisé dans passage) |
| 6 | 1 | Sanity check Open-Meteo Marine sur points med avant de coder l'adapter |
| 7 | 2 | Comment "single-pass" dans `passage.py` + test sur passage frontal |
| 8 | 2 | Justifier `efficiency=0.75` dans `boat-archetypes.md` |
| 9 | 2 | Tests à vent constant : assertion exacte, pas de fourchette |
| 10 | 4 | Adopter Option B pour URL (cf. `03-url-format.md`) |
| 11 | 4 | Endpoint REST `/api/passage` sur le Space pour le rendu `/plan` |
| 12-23 | divers | Décisions implicites à clarifier au fil de l'eau |

Ces actions ne changent **pas** la stratégie ni le scope V1. Elles précisent les zones grises.
