# CHANGELOG

## Semaine 1 — 29 oct 2026

- Manifest : `jira:globalPage` (Custom UI), `trigger` install/upgrade, `scheduledTrigger` horaire, `webtrigger`, `sql`, 4 fonctions, scopes Jira + Confluence déclarés d'emblée (évite une montée de version majeure plus tard).
- Forge SQL : 11 tables (BUILD.md §5) en migrations idempotentes, runner avec retry sous le timeout de fonction, exécuté à l'installation, toutes les heures, et via **Repair database**.
- Moteur : point d'entrée `runAnalysis` câblé (table `analysis_run`), détecteurs non implémentés (semaine 3).
- Settings en KVS (espace Confluence, projet Jira, seuil de publication, source de graphe).
- Command center : React 18 + Vite, écran de santé (stockage, moteur, configuration, modèle), boutons *Run analysis now* / *Repair database*.
- Tests : `npm test` vérifie l'intégrité du schéma.
- Décisions solo : `rovo:mcp` et option LLM retirés du périmètre ; TWG conditionné à un accès EAP avant fin semaine 4.

À vérifier sur site (Arnaud) : déploiement `development`, installation Jira + Confluence sur `antemortem-dev`, schéma complet sur l'écran, puis installation depuis zéro sur `arnaudlothe`.
