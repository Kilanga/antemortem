# CHANGELOG

## Semaine 2 — 30 oct 2026 (en avance sur le plan)

- **Modèle** : repositories pour les 11 tables, CRUD contrats / obligations / décisions / hypothèses / liens, garde « admin Jira » (évaluée `asUser` via `mypermissions`) sur toutes les écritures.
- **RestGraphSource** : lecture Jira (JQL paginée, liens « Blocks », labels `lot-*` / `vendor-*` / `tech-*`), disponibilité des personnes en table locale. Les dates d'un ticket peuvent être portées par la propriété d'issue `antemortem` (Jira n'autorise pas l'antidatage de `created` via l'API) ; sinon `created` / `resolutiondate` / `duedate`.
- **Scénario de démo** (BUILD.md §8) : générateur déterministe relatif à « aujourd'hui », ~90 tickets, projet `NFS`, espace `ANTE`, 3 pages de COPIL, 1 contrat, 4 obligations, 3 décisions, 6 hypothèses, 2 absences. Chargement **asynchrone** (consumer Forge, 15 min max) avec progression par étape en KVS et reprise idempotente ; *Reset* supprime projet, espace et lignes du modèle.
- **UI** : onglets Overview / Obligations / Decisions / Settings ; éditeurs avec test JQL en direct ; hypothèses typées (`person_available`, `capacity`, `dependency_done_by`, `routing`, `obligation_holds`, `freeform`) ; boutons de démo avec confirmation en deux clics (pas de `window.confirm` dans la sandbox Custom UI).
- **Manifest** : module `consumer` + queue `antemortem-jobs` ; scopes `manage:jira-configuration` (création/suppression du projet de démo), `read:space:confluence`, `read:page:confluence`, `write:page:confluence` (API v2), `write:confluence-space` (API v1, création/suppression d'espace). Les scopes classiques `read:confluence-content.all` / `write:confluence-content` sont retirés (API v1 content dépréciée).
- **Migration** v012 : `obligation.period_starts_on` / `period_ends_on` (fenêtres contractuelles).
- Tests : 13 (schéma + scénario).

✅ Vérifié sur `antemortem-dev` le 30 oct (v3.0.0 → v3.2.0) : chargement de la démo de bout en bout (projet, 90 tickets, 55 transitions, propriétés, lien, espace, 3 pages, modèle), onglets Obligations / Decisions peuplés, reset propre (projet + espace supprimés), rechargement, JQL quoté → 12 interventions lot 3 ouvertes.

Correctifs trouvés sur site : (1) l'id généré était écrasé par `id: undefined` → ligne SQL sans id ; (2) **`FIELD` est un mot réservé JQL** → clé de projet de démo renommée `NFS`, clés toujours quotées dans les JQL ; (3) lien « source » des décisions préfixé `/wiki`.

## Semaine 1 — 29 oct 2026

- Manifest : `jira:globalPage` (Custom UI), `trigger` install/upgrade, `scheduledTrigger` horaire, `webtrigger`, `sql`, 4 fonctions, scopes Jira + Confluence déclarés d'emblée (évite une montée de version majeure plus tard).
- Forge SQL : 11 tables (BUILD.md §5) en migrations idempotentes, runner avec retry sous le timeout de fonction, exécuté à l'installation, toutes les heures, et via **Repair database**.
- Moteur : point d'entrée `runAnalysis` câblé (table `analysis_run`), détecteurs non implémentés (semaine 3).
- Settings en KVS (espace Confluence, projet Jira, seuil de publication, source de graphe).
- Command center : React 18 + Vite, écran de santé (stockage, moteur, configuration, modèle), boutons *Run analysis now* / *Repair database*.
- Tests : `npm test` vérifie l'intégrité du schéma.
- Décisions solo : `rovo:mcp` et option LLM retirés du périmètre ; TWG conditionné à un accès EAP avant fin semaine 4.

✅ Vérifié sur `antemortem-dev` le 29 oct 23:55 : déploiement v2.0.0 `development`, installation Jira + Confluence, 11 tables `ready` dès l'installation, trigger horaire exécuté seul, *Run analysis now* OK, settings ANTE/NFS sauvegardés.

Correctif : `timeoutSeconds` n'est autorisé que sur les fonctions de `scheduledTrigger`/`consumer` (retiré du trigger d'installation et du webtrigger ; fenêtre de retry des migrations ramenée à 18 s).

Reste à faire pour clore la semaine : installation depuis zéro sur `arnaudlothe` (test juge).
