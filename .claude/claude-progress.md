# OpenWind — Progress Log

Ce fichier est lu et mis a jour par chaque agent a chaque iteration.
Il sert de memoire inter-sessions pour eviter les regressions et garder le contexte.

---

## Etat actuel

- **Iteration**: 2 (actions completes, en attente d'eval)
- **Score global**: 6.4/10 (eval iter1) — cible iter2 : wind_table ≥ 7
- **Branche**: amelioration-design

## Historique des scores

| Critere | v1 | v2 | v3 | iter1 |
|---|---|---|---|---|
| Layout | 4 | 6 | 6 | **7** ✅ |
| Typographie | 3 | 6 | - | **6** ❌ |
| Couleurs | 5 | 5 | - | **7** ✅ |
| Touch targets | 6 | 6 | - | **6** ❌ |
| Tableau vent | 4 | - | - | **6** ❌ |
| Carte | 5 | - | - | **5** ❌ |
| Loading/Etats | 5 | - | - | **7** ✅ |
| Responsive | 3 | 6 | 6 | **7** ✅ |
| Polish | 3 | - | - | **6** ❌ |
| Identite | 4 | - | - | **6** ❌ |
| **Global** | **4.2** | **6.2** | **6.8*** | **6.4** |

*v3 = estimé avec critères partiels. 6.4 est le premier score complet.

## Changements recents (iter2 — sprint wind_table)

- **WindCell.tsx** : vitesse vent 13px→17px mobile, 15px→20px desktop (seuil 16px+ atteint)
- **WindCell.tsx** : rafales 11px→13px mobile, 12px→14px desktop, opacity 85→90
- **WindCell.tsx** : hauteur cellules h-10→h-12 mobile (48px, conforme 44px Apple), h-14→h-16 desktop
- **TimelineHeader.tsx** : highlight "Now" renforcé (bg-teal-900/40 → bg-teal-700/70, text-teal-100, font-bold)
- **WindTable.tsx** : tooltip natif (title) sur les noms de modeles avec description/resolution/origine

## Regressions connues

- Aucune regression constatee visuellement (mobile 375x812 + desktop 1440x900)
- Criteres proteges verifies : layout OK, colors intactes, loading_states non touches, responsive OK
- Le tableau est plus haut verticalement (+8px/cellule mobile, +8px desktop) mais reste dans le scroll

## Prochaines priorites (criteres FAIL < 7, tries par urgence)

### TRAITÉ en iter2 (en attente d'eval)
1. ~~**Tableau vent** (score 6, poids 2.0)~~ — 5 actions appliquees, cible ≥ 7
2. ~~**Touch targets** (score 6, poids 1.0)~~ — cellules h-12 (48px) > seuil 44px (corrige via action 3)

### URGENT — Impact fort
3. **Typographie** (score 6, poids 1.5) — partiellement corrige par iter2 (tailles tableau)
   - Reste a verifier : echelle globale hors tableau
4. **Identite** (score 6, poids 1.5) — trop generique, manque d'âme "vent/outdoor"
   - Action: element visuel distinctif marine/vent, ou renforcer signature Beaufort

### NORMAL — Impact moyen
5. **Polish** (score 6, poids 1.0) — manque transitions d'etat (changement spot, selection colonne)
   - Action: fade cross entre skeleton et nouveau tableau, transition colonne selectionnee

### FAIBLE — Impact faible
6. **Carte** (score 5, poids 0.75) — fleches vent confuses, pas de legende
   - Action: ameliorer presentation fleches quand heure selectionnee

## Pour atteindre 7.0 global

Score cible : 7.0
Score actuel : 6.4
Besoin : +0.6 points ponderes = +7.5 points bruts

Minimum requis :
- Tableau vent : 6 → 7 (+2.0 pts ponderes)
- Typographie : 6 → 7 (+1.5 pts ponderes)
- Touch targets : 6 → 7 (+1.0 pts ponderes)
Ces 3 seuls = +4.5 pts ponderes → global 6.4 + (4.5/12.5) = 6.76 ≈ 6.8

Pour 7.0 ferme, il faut aussi : Identite 6 → 7 (+1.5) et/ou Polish 6 → 7 (+1.0)

## Notes pour le prochain agent

- Ne pas toucher a la logique metier ni aux appels API
- Le tableau vent a ete traite en iter2 — attendre le score eval avant d'y retoucher
- Prochains criteres a cibler : Typographie (1.5), Identite (1.5), Polish (1.0)
- Les tailles de police du tableau sont maintenant : speed 17/20px, gusts 13/14px, labels 12/13px
- Les cellules font h-12 (48px mobile) / h-16 (64px desktop) — ne pas reduire
- Le highlight "Now" est bg-teal-700/70 text-teal-100 font-bold — ne pas affaiblir
- Eviter de casser le layout side-by-side desktop qui fonctionne bien
- Tester sur 375x812 ET 1440x900
