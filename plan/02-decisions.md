# Décisions actées sur les questions résiduelles

Réponses du 2026-04-25 aux 5 questions résiduelles de la section 11 du brief.

## 1. Mapping nom commercial → archétype

**Décision** : pas de mapping côté serveur. L'utilisateur (humain ou LLM) **choisit** parmi les 5 archétypes proposés.

**Conséquences concrètes** :
- `list_boat_archetypes()` reste la seule source de vérité. Sa réponse doit être suffisamment descriptive pour qu'un LLM ou un humain puisse mapper "Sun Odyssey 32" → `cruiser_30ft` **sans table** côté serveur.
- Le brief original dit "Permet à Claude de mapper 'j'ai un Sun Odyssey 32' → cruiser_30ft" — c'est exactement ça : Claude raisonne, on ne ship pas de CSV de modèles commerciaux.
- Chaque archétype expose dans son JSON : `name`, `length_ft`, `type` (monocoque/cata), `category` (croisière/course-croisière), `examples` (3-4 modèles connus à titre indicatif), `performance_class` (relative aux autres archétypes).
- Si l'utilisateur a un bateau hors-catégorie (ex : open 60), le LLM doit le dire à l'utilisateur et proposer l'archétype le plus proche.

## 2. Zones d'accélération côtière

**Décision** : retiré du scope V1.

**Conséquences concrètes** :
- Pas de `routing/zones_med.py`.
- `PassageReport.warnings` reste une liste, mais alimentée uniquement par les seuils de complexité (vent/mer) en V1.
- Section 3, 5 et Sprint 3 du brief original sont caducs sur ce point — voir annotations dans `00-vision-and-execution.md`.
- Mention dans `CLAUDE.md` racine à retirer également.
- Réintroduction possible en V2 si retours utilisateurs le demandent.

## 3. Format de l'URL `/plan`

**Décision** : à trancher parmi les options proposées dans `03-url-format.md`. Recommandation : Option B (single `wp` param, separator pipe).

## 4. Stratégie autosleep HF

**Décision** : pas de pré-warming. On accepte le cold-start de quelques secondes.

**Conséquences concrètes** :
- Pas de cron HF, pas de ping de keep-alive.
- Le `description` du tool MCP `get_marine_forecast` peut mentionner "première requête après inactivité : ~5s de cold-start" pour que le LLM puisse en informer l'utilisateur si pertinent.
- Si avant une démo critique on veut éviter le cold-start, fix manuel : ouvrir `mcp.openwind.fr` dans un onglet 30s avant.

## 5. GitHub Actions pour sync `hf-space/` → repo HF Space

**Décision** : oui, auto-deploy via GitHub Action.

**Conséquences concrètes** :
- Workflow déclenché sur `push` à `main` qui modifie `packages/hf-space/**`.
- Utilise `huggingface_hub` ou un `git push` vers le repo Space avec un token HF stocké en secret GitHub (`HF_TOKEN`).
- Le repo Space est traité comme un miroir : on ne push jamais dessus à la main, single source of truth = repo GitHub.
- À implémenter au Sprint 4. Détail technique du workflow dans `04-hf-deployment.md` (à créer en Sprint 4).
