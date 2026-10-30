# CHANGELOG

## 0.8.1 — vérification sur site (30 oct, soir)

- Déployé v4.0.0 (version majeure : module `macro`, action Rovo). Vérifié sur `antemortem-dev` : publication Confluence sous *Projected incidents*, 5 tickets d'action NFS-91…95, panneau issue sur NFS-87, cycle *averted* (2 actions Done → page archivée sous *Averted incidents*, €40 000 évités), what-if et History sur données réelles, macro insérée depuis `/Antemortem`.
- Corrigés à cette occasion : onglet Settings blanc (hooks imbriqués dans un effet) ; lien « Source decision » rendu en texte (argument mal placé) ; prévision — les actions qui existent sans avancer ne baissent plus la probabilité (sinon l'incident s'évitait tout seul à l'analyse suivante) ; 0,075 par hypothèse cassée pour que le what-if reste monotone ; en-tête Overview quand aucun post-mortem n'est dû ou que rien n'est analysé ; macro lisant les pages publiées (Forge SQL est par installation : Confluence ne voit pas la base de Jira) ; statuts des actions relus depuis Jira avant la prévision (une action rouverte recomptait sinon pour toujours comme terminée) ; panneau issue affichant aussi les incidents évités.
- Vérifié après redéploiement : en-tête « No post-mortem due » à 50 % ; macro lisant l'espace.
- Non vérifié : agent Rovo — Rovo Chat n'est pas disponible sur le site de dev (redirige vers la page marketing). À régler côté admin/licence avant de tester l'agent.

## 0.8.0 — aller plus loin

- What-if : sur la chaîne causale, chaque événement a une case « et si c'était réglé ? » ; la probabilité est recalculée sans cette preuve, sans rien écrire. Une case « toutes les interventions ouvertes restaurées dans le SLA » montre que la période ferme quand même sous 95 %.
- History (backtest) : rejoue le moteur sur l'état du travail tous les deux jours depuis le début de la période ; courbe, date de franchissement du seuil, jours d'avance. Vue « as of » du graphe.
- Détecteur de tendance : plus de signal sur moins de 10 tickets résolus.
- Détecteur `person_silent` : ≥ 2 tickets ouverts détenus sans activité depuis ≥ 5 jours.
- Onglet Portfolio ; macro Confluence ; action Rovo `read-page-for-decision` + hypothèses typées dans `record-decision` ; resolvers `whatIf`, `backtest`, `getMacroSummary`.

## 0.7.0 — passe de densité

- Post-mortem : Impact en deux phrases ; suppression des commentaires éditoriaux (« Nothing in Jira or Confluence linked… », « Italic rows are projections… », « Deterministic: no language model… ») ; facteurs contributifs limités à ce que la cause racine ne dit pas déjà ; section Evidence réduite à la décision source (les tickets sont déjà liés dans la timeline) ; méthode condensée en trois lignes.
- App : lede de chaque onglet réduit à une phrase ; suppression du résumé répété sous le titre d'incident, du mode d'emploi sous les actions correctives et de l'horodatage par ligne ; chaîne causale raccourcie (titres de décision non répétés) ; explication du score sur une ligne.
- Agent Rovo : réponses limitées à quatre phrases, sans explication du produit.


## Semaines 5–7 (anticipées) — 30 oct 2026

- **Agent Rovo « Antemortem »** (`rovo:agent`, prompt en ressource) avec cinq actions : `get-next-incident`, `explain-obligation`, `list-obligation-status`, `list-corrective-actions`, `record-decision`. Scope `read:chat:rovo` : les actions sont utilisables comme outils par les agents créés par les clients (argument pour le bonus Best Agents).
- **Panneau de ticket** (`jira:issueContext`, UI Kit) : obligations alimentées par le ticket, hypothèses qui le mentionnent (avec leur décision), décisions contredites, incidents projetés où il apparaît.
- **Durcissement** : webtrigger protégé par jeton (généré à la demande, jamais renvoyé par les résolveurs de settings), analyse via la file ; carte « Automation hook » dans Settings.
- **Documents de soumission** : `JUDGE_INSTRUCTIONS.md` (parcours juge en 7 étapes, 10 min, en anglais) et `DEMO_SCRIPT.md` (plan de tournage chronométré à 3:00, voix off, règles de tournage).
- Manifest : nouveaux modules + scope → **montée de version majeure, `forge install --upgrade` sur Jira et Confluence**. Premier module UI Kit du projet (`src/frontend/issue-context.jsx`, `@forge/react`).

À vérifier sur site : déploiement (linter UI Kit), panneau sur NFS-87, agent dans Rovo, puis le parcours complet de JUDGE_INSTRUCTIONS.md.

## Semaine 4 — 30 oct 2026 (moteur, partie 2 : le document)

- **Narratif** (`engine/narrative/`) : composition déterministe du post-mortem du futur — Impact, Root cause (la décision et ses hypothèses brisées), Timeline (faits datés puis projection en italique, liens vers les preuves), Contributing factors, Corrective actions (une par signal causal), Evidence, How this forecast was computed. Rendu en format de stockage Confluence (panneaux info / tip / warning selon l'état).
- **Cycle de vie** (`engine/publish.js`) : au-dessus du seuil → page Confluence sous « Projected incidents » + tickets Jira d'actions correctives (labels `antemortem`, `corrective-action`) + mise à jour à chaque analyse (statuts d'actions synchronisés depuis Jira) ; sous le seuil → **averted** : page déplacée sous « Averted incidents » avec bandeau et coût évité ; date dépassée et obligation toujours rompue → **materialized** ; rejet manuel → **dismissed** avec motif. Les actions faites continuent de peser sur le score après l'aversion (pas de republication en boucle).
- **Analyse en arrière-plan** : *Run analysis now* passe par la file d'événements (publication trop longue pour les 25 s d'un résolveur) ; l'UI interroge la dernière exécution.
- **UI** : carte d'incident en tête de l'Overview (titre daté, probabilité, coût, bouton *Open post-mortem*, actions avec statut Jira en direct, *Dismiss* avec motif) ; onglet **Averted** (registre + total des pénalités évitées).
- Scénario : dates des décisions reculées (D-7 en septembre, cohérent avec son titre).
- Tests : 27 (narratif : titre, impact, root cause, timeline, actions, arithmétique, rendu).

À vérifier sur site : *Run analysis now* → page Confluence datée J+16 sous « Projected incidents » + 5 tickets NFS d'actions ; fermer 2 actions → relancer → page sous « Averted incidents », 40 000 € évités.

## Semaine 3 — 30 oct 2026 (moteur, partie 1)

- **Métriques** (`engine/metrics.js`) : `ratio_within_sla` (ratio courant, projection explicable : tickets ouverts proches du SLA comptés comme futurs manquements, nombre de résolutions à l'heure nécessaires pour revenir au seuil), `count_max/min`, `deadline` ; fenêtre de période calendaire ou contractuelle.
- **Détecteurs** (`engine/signals/`) : `obligation_trend`, `stale_critical_issue`, `single_point_of_failure` sur l'obligation ; vérification des hypothèses `capacity`, `person_available`, `dependency_done_by` (avec bloqueurs et leur inactivité), `routing` (→ `decision_contradicted`). Statut d'hypothèse `holding / shaken / broken` avec preuve. Empreintes stables → signaux upsertés, et résolus quand ils ne sont plus détectés.
- **Projection** (`engine/forecast.js`) : score transparent (signal direct ≤ 0,5 ; hypothèses brisées/ébranlées ≤ 0,3 ; contradiction +0,1 ; actions correctives −0,1/−0,2), borné [0,05 ; 0,98], date de rupture = fin de période, coût depuis la pénalité ; `explanation` imprimable.
- **Chaîne causale** (`engine/analyse.js`) : décision → événements datés (preuves) → mesure → rupture projetée, triée chronologiquement. C'est la timeline du futur post-mortem.
- **Pipeline** (`engine/index.js`) : par obligation active, résolution des décisions liées, persistance signaux / hypothèses / forecasts (supersédés), marquage `contradicted` des décisions.
- **UI** : Overview réécrit — « Next post-mortem in N days », liste des obligations avec jauge courant/projeté/seuil, tags de signaux, chaîne causale dépliable et arithmétique du score ; cartes de santé repliées derrière *Health*.
- **Tests hors ligne** : `test/helpers/fakeGraph.mjs` (GraphSource en mémoire + mini-évaluateur JQL) ; sur le scénario, O-3 → 93 % courant / 83 % projeté, 4 hypothèses brisées, 5 signaux, probabilité 0,80, 40 000 €, rupture au J+16 ; O-1/O-2/O-4 saines. 20 tests.
- Scénario ajusté : O-1 devient « ≤ 8 h sur 98 % du lot 1 » ; la charge Boreal hors lot 3 est de la maintenance préventive (label `preventive`) ; le ticket de réaffectation Helios est `dispatch`, pas `intervention`.

✅ Vérifié sur `antemortem-dev` le 30 oct 00:59 (v3.5.0) : résultat identique aux tests hors ligne — O-3 80 % / 40 000 € / rupture J+16, 4 hypothèses brisées, 5 signaux, chaîne datée ; O-1 (100 %), O-2, O-4 tiennent.

Correctifs trouvés sur site : (1) `forecast.healthy` dérivé côté résolveur (non persisté) ; (2) **création de lien Jira à l'envers** — dans `POST /issueLink`, c'est `inwardIssue` qui porte la description sortante (« A blocks B » = inwardIssue A, outwardIssue B), la lecture suit la convention usuelle ; (3) **`key in (...)` peut renvoyer vide** après suppression/recréation d'un projet avec les mêmes clés (index de recherche obsolète) → `issuesByKeys` lit les tickets directement par clé.

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
