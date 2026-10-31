# ANTEMORTEM — Build Book

> *This app writes your post-mortems before the incidents happen — then helps you make sure they never get written for real.*

Nom de code : **Antemortem** (latin « avant la mort », l'inverse exact de post-mortem). Nom de travail, à valider ; vérifier la disponibilité sur le Marketplace avant la vidéo.

Ce fichier est la source de vérité du projet. Il se pose à la racine du dépôt et sert à la fois de cadrage, de spec, de plan et de checklist de soumission. Il est écrit pour être lu par des humains **et** par des agents de code (Claude Code, Rovo Dev, Cursor…) : les sections 5 à 8 sont rédigées pour être données telles quelles en contexte.

---

## 0. Décisions prises (ne pas rouvrir sans raison)

| Sujet | Décision | Pourquoi |
|---|---|---|
| Concept | Post-mortems du futur, générés depuis le graphe, avec cycle de vie (publié → évité / matérialisé) | Inversion temporelle d'un format que tout juge connaît ; les concepts « contrat vivant » et « registre des décisions » deviennent les moteurs internes |
| Catégorie | **Apps for Business Teams** | Le concept est universel ; le scénario de démo est ops/sous-traitance, mais le pitch ne doit pas enfermer le produit dans un secteur. Bascule possible vers *Specialized Industries* au moment de soumettre si la concurrence en Business Teams est trop dense (on peut lire la galerie de projets avant de choisir). |
| Bonus visé | **Un seul**, choisi en semaine 6 : Teamwork Graph si l'accès EAP est obtenu **avant la fin de la semaine 4**, sinon **Best Agents (Rovo)** | Une soumission ne gagne qu'un grand prix + un bonus. Le Rovo agent se construit de toute façon ; TWG a un risque d'accès (voir §2). |
| Équipe | **Solo** (Arnaud) + Claude pour le code. `rovo:mcp` et l'option LLM (§6.5) sont **hors périmètre** d'emblée. | Le temps libéré va dans le design et la vidéo (40 % de la note). |
| Sites | Dev : `antemortem-dev.atlassian.net` · Test « juge » (vierge, jamais de dev dessus) : `arnaudlothe.atlassian.net` | Le test d'installation depuis zéro est hebdomadaire (§9). |
| Dépôt / app | GitHub `Kilanga/antemortem` · Forge app id `29a1ae10-bc1f-4027-a192-00aa16fa9d20` · Developer Space `antemortem` | — |
| Génération du texte | **Déterministe** (moteur de règles + templates), pas de LLM externe | L'app doit tourner telle quelle dans l'environnement du juge, sans clé API, sans egress. Chaque phrase du post-mortem est adossée à une preuve ; un LLM affaiblirait l'argument d'explicabilité. Option LLM désactivée par défaut, voir §6.5. |
| Démo | L'app embarque un **scénario de démo auto-installable** en un clic | Le juge installe l'app sur un site vide ; sans données, il voit une coquille vide. |
| Langue | Tout en anglais : code, UI, vidéo, description, instructions | Exigence des règles ; évite la traduction. |
| Stockage | Forge SQL pour le modèle, KVS pour la config | Le modèle est relationnel (obligations ↔ décisions ↔ tickets ↔ signaux) ; le KVS ne suffit pas pour les jointures. |
| UI | Custom UI (React) pour la page globale et la vue post-mortem ; UI Kit pour les panneaux légers | Design = 20 % de la note. Custom UI donne la maîtrise du rendu. |
| Propriété | Projet perso, hors temps/matériel/données employeur ; données de démo 100 % fictives | Règles IP + prudence vis-à-vis de l'employeur |

---

## 1. Le concept en une page (à relire avant chaque arbitrage)

**Le problème.** Toute organisation produit, après chaque échec, le même document : le post-mortem. Timeline, cause racine, facteurs contributifs, actions correctives. C'est le document le plus honnête de l'entreprise, et il arrive toujours trop tard. Les informations qui auraient permis de l'écrire *avant* existaient — dispersées dans des tickets, des pages, des décisions de réunion, des congés — mais personne ne les relie.

**Le produit.** Antemortem lit en continu le graphe de travail de l'organisation et, quand une trajectoire de rupture devient probable, rédige dans Confluence le post-mortem complet de l'incident à venir, **daté dans le futur**. Chaque ligne de la timeline pointe vers une preuve réelle, présente aujourd'hui. Les actions correctives sont créées comme tickets Jira. Quand elles sont faites, le post-mortem se dissout et rejoint le registre des **incidents évités**, avec le coût épargné.

**Ce que l'app sait que l'organisation ne sait pas elle-même.** Pas « le ticket 4521 est en retard » — ça, Jira le sait. Mais : « la décision du comité de septembre reposait sur la disponibilité de Karim ; Karim est réaffecté depuis lundi ; les trois tickets qui en dépendent conditionnent l'obligation O-3 du contrat Meridian ; O-3 bascule en pénalité le 14 décembre ; coût : 40 000 €. » Aucune brique de cette phrase n'est un objet Atlassian aujourd'hui. Les trois primitives que nous construisons :

1. **Obligation** — une règle contractuelle mesurable (« 95 % des interventions du lot 3 sous 4 h, mesuré mensuellement, sinon 2 % de pénalité »), reliée aux tickets qui la nourrissent.
2. **Décision avec hypothèses** — « on a choisi A plutôt que B parce qu'on supposait C ». L'hypothèse C est un objet surveillable.
3. **Chaîne causale** — le lien obligation ← décision ← hypothèse ← fait du graphe (ticket, personne, dépendance).

Le post-mortem du futur est la surface visible de ces trois objets. Le vrai travail est dans le modèle et le moteur (§5, §6), pas dans le document.

**Test anti-dashboard.** À chaque fonctionnalité, poser la question : *est-ce que ça affiche quelque chose que l'utilisateur pouvait déjà voir ailleurs ?* Si oui, c'est du décor. Si ça relie deux choses que rien ne reliait, c'est le produit.

---

## 2. Contraintes externes et risques

### 2.1 Calendrier

- Soumission : jusqu'au **22 décembre 2026, 12:00 PST** (21:00 heure de Paris).
- Objectif interne : **soumission le 15 décembre**, une semaine de marge pour les imprévus et le swag des 300 premiers.
- Jugement : 5 janvier – 3 février 2027. Résultats ~15 février 2027.

### 2.2 Ce que les règles imposent (checklist en §10)

- App Forge, manifest + au moins un module Forge, intégrée à ≥ 1 produit (nous : Jira, JSM, Confluence, Rovo, TWG).
- **Lien d'installation** testable par les juges sur leur site ; l'app doit fonctionner comme dans la vidéo.
- Vidéo < 5 min, YouTube public, **tout l'essentiel dans les 3 premières minutes** (les juges ne sont pas tenus d'aller au-delà).
- Pas de marques tierces ni de musique protégée dans la vidéo. Données de démo fictives.
- Étape 1 du jugement = pass/fail « colle au thème + utilise vraiment Forge ». Étape 2 = 5 critères à 20 %. Départage : implémentation technique d'abord.

### 2.3 Risque n°1 : l'API Teamwork Graph est en EAP

L'API de lecture du graphe (`requestTeamworkGraph`, scopes `read:graph:jira` / `read:graph:confluence`) est en Early Access : il faut être accepté via un formulaire, et Atlassian demande de n'installer ces apps que sur des organisations de test. Le hackathon propose pourtant un bonus TWG, donc l'accès est vraisemblablement ouvert aux participants, mais **ce n'est pas garanti ni daté**.

Mitigation :
- **Jour 1** : remplir le formulaire EAP TWG (lien dans la doc « Teamwork Graph API reference overview ») ET poster sur community.developer.atlassian.com avec le tag du concours pour demander la procédure d'accès pour les participants.
- **Architecture** : toute lecture du graphe passe par une interface `GraphSource` (§6.1) avec deux implémentations : `TwgGraphSource` (Cypher via TWG) et `RestGraphSource` (Jira/Confluence REST + notre propre table de liens). L'app est complète avec la seconde ; la première est un plus.
- Si l'accès arrive tard ou pas du tout : bonus **Best Agents (Rovo)**, qui est GA, et le pitch TWG devient « Antemortem construit son propre sous-graphe causal ». Ce qui est vrai et défendable.

### 2.4 Autres risques

| Risque | Impact | Mitigation |
|---|---|---|
| Forge SQL : le DDL ne s'exécute que dans des scheduled triggers / install hooks | Schéma non créé → app vide chez le juge | Migration câblée sur l'événement d'installation **et** sur un scheduled trigger ; bouton « Repair database » dans l'admin ; test sur site vierge chaque semaine (§9) |
| Rovo non activé sur le site du juge | Agent invisible | L'agent est un bonus, pas le cœur ; l'app doit être complète sans. Préciser dans les instructions comment activer Rovo. |
| Scheduled trigger minimum horaire → démo lente | Impossible de montrer « en direct » | Bouton « Run analysis now » (résolveur) + webtrigger ; le scheduler est pour la vie réelle, la démo pousse à la main |
| Scope creep | Produit incomplet | Périmètre gelé en semaine 6 ; toute idée nouvelle va dans `BACKLOG.md`, pas dans le code |
| Vidéo bâclée | −20 % direct | Script écrit en semaine 5, tournage semaine 7, montage semaine 8 (§11) |

---

## 3. Mise en route (jour 1, ~2 heures)

### 3.1 Comptes et accès
1. Compte sur la plateforme du concours → inscription (chaque membre).
2. **Atlassian Cloud Developer License** (go.atlassian.com/cloud-dev) → un site de dev avec Jira, JSM et Confluence. Activer Rovo sur ce site (admin → Atlassian Intelligence / Rovo).
3. Un **second site vierge** (ou un second compte dev) réservé aux tests d'installation « comme un juge ». Ne jamais développer dessus.
4. Formulaire EAP Teamwork Graph + question sur la communauté (tag du concours).
5. Dépôt Git privé. Branches : `main` (toujours déployable en `development`), `feat/*`.

### 3.2 Outillage local
```bash
# Node 24 (runtime Forge nodejs24.x). Sous Windows avec nvm-windows : nvm use 24.22.1 (ou plus récent)
npm install -g --allow-scripts=@forge/cli,cloudflared,keytar @forge/cli@latest
forge login            # token API Atlassian
forge create           # template : jira-global-page-custom-ui ; nom : antemortem  (déjà fait)
cd antemortem
npm install && npm run install:ui
npm run deploy:dev      # = build Vite + forge deploy --non-interactive -e development
forge install --non-interactive -e development --site antemortem-dev.atlassian.net --product jira
forge install --non-interactive -e development --site antemortem-dev.atlassian.net --product confluence
```

Pour les agents de code : brancher le **Forge MCP Server** officiel (developer.atlassian.com/platform/forge/forge-mcp) dans Claude Code / Cursor / Rovo Dev, et commencer chaque prompt de génération par « use the Forge MCP tools to base the solution on current Forge documentation ». Ça évite 80 % des erreurs de manifest.

### 3.3 Vérifier que tout parle
- `forge tunnel` fonctionne et la page globale s'affiche dans Jira.
- Un appel `api.asApp().requestJira('/rest/api/3/myself')` passe.
- Un appel `api.asApp().requestConfluence('/wiki/api/v2/spaces')` passe.
- `forge module add` → Rovo → `rovo:agent` : l'agent apparaît dans le sélecteur Rovo.
- Si EAP accordé : `requestTeamworkGraph` avec la query `echo`.

---

## 4. Architecture Forge

### 4.1 Modules (manifest cible)

| Module | Rôle |
|---|---|
| `jira:globalPage` (Custom UI, React) | **Command center** : post-mortems à venir, incidents évités, obligations, décisions |
| `jira:issueContext` (UI Kit) | Sur un ticket (panneau latéral, toujours visible) : obligations alimentées, hypothèses et décisions liées, « ce ticket apparaît dans le post-mortem du 14/12 » |
| `jira:issueAction` (UI Kit, modal) | « Record a decision from this issue » |
| `confluence:contentAction` ou macro (UI Kit) | « Record a decision from this page » ; macro « Decision card » |
| `scheduledTrigger` (hour) | Lance le moteur d'analyse + migrations SQL |
| `trigger` (événements Jira : issue created/updated/transitioned, assignee changed, comment) | Recalcul incrémental ; `filter.ignoreSelf: true` |
| `trigger` (`avi:forge:installed:app`) | Création du schéma + config par défaut |
| `webtrigger` | « Run analysis now » appelable depuis la démo et les tests |
| `rovo:agent` + `action` ×5 | Agent *Antemortem* : *what is my next post-mortem?*, *why is obligation X at risk?*, *how are our obligations doing?*, *corrective actions*, *record a decision* |
| `rovo:mcp` (optionnel, si temps) | Exposer les mêmes actions comme outils MCP |
| `sql` | Base du modèle |
| `function` | Résolveurs Custom UI, moteur, générateur |

### 4.2 Scopes (prévoir le minimum, le juge voit la liste au moment d'installer)
```yaml
permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - read:jira-user
    - read:servicedesk-request       # SLA JSM si utilisés
    - read:confluence-content.all
    - write:confluence-content
    - read:confluence-space.summary
    - storage:app
    - read:chat:rovo                  # actions utilisables par des agents clients
    # - read:graph:jira               # uniquement si EAP TWG
```

### 4.3 Structure du dépôt
```
antemortem/
├── BUILD.md                  ← ce fichier
├── BACKLOG.md                ← idées hors périmètre
├── DEMO_SCRIPT.md            ← script vidéo + déroulé démo (§11)
├── JUDGE_INSTRUCTIONS.md     ← instructions d'installation pour les juges (§10)
├── manifest.yml
├── package.json
├── src/
│   ├── index.js              # export des handlers
│   ├── resolvers/            # Custom UI resolvers (une fonction par écran)
│   ├── triggers/             # installed, scheduled, jira events, webtrigger
│   ├── rovo/                 # actions de l'agent
│   ├── db/
│   │   ├── migrations/       # 001_init.sql, 002_… (DDL idempotent)
│   │   ├── migrate.js
│   │   └── repo/             # accès données par entité
│   ├── graph/
│   │   ├── GraphSource.js    # interface
│   │   ├── RestGraphSource.js
│   │   └── TwgGraphSource.js
│   ├── engine/
│   │   ├── signals/          # détecteurs (un fichier par signal)
│   │   ├── chains.js         # construction des chaînes causales
│   │   ├── forecast.js       # projection temporelle et scoring
│   │   └── narrative/        # templates du post-mortem
│   ├── confluence/           # création / mise à jour / archivage de pages
│   ├── jira/                 # création des tickets d'actions correctives
│   └── demo/                 # scénario de démo (seed + reset)
├── static/
│   └── command-center/       # React 18 + Vite → dist/ (référencé par le manifest)
└── test/                     # node --test (schéma, moteur, narratif)
```

---

## 5. Modèle de données (Forge SQL, MySQL-compatible)

Toutes les tables ont `id` (UUID), `created_at`, `updated_at`. Clés étrangères déclarées ; suppression logique (`archived_at`) plutôt que `DELETE`.

### 5.1 Entités cœur

**`contract`** — `name`, `counterparty`, `start_date`, `end_date`, `currency`, `confluence_page_id` (page source, optionnel), `notes`.

**`obligation`** — la primitive n°1.
- `contract_id`, `code` (ex. `O-3`), `title`, `description`
- `metric_type` : `ratio_within_sla | count_max | count_min | deadline | custom`
- `jql_scope` : les tickets qui nourrissent la mesure (ex. `project = "NFS" AND labels = lot-3` — toujours quoter la clé : `FIELD` est un mot réservé JQL, leçon de la semaine 2)
- `sla_hours` (si `ratio_within_sla`), `threshold` (ex. `0.95`), `period` : `monthly | weekly | one_shot | custom` (+ `period_starts_on` / `period_ends_on` pour les fenêtres contractuelles)
- `penalty_type` : `fixed | percent_of_invoice`, `penalty_value`, `invoice_basis` (montant pour calculer un %)
- `owner_account_id`

**`decision`** — la primitive n°2.
- `title`, `statement` (ce qui a été décidé), `rationale`
- `decided_at`, `decided_by` (account ids), `source_type` : `jira_issue | confluence_page | manual`, `source_id`, `source_url`
- `alternatives_rejected` (JSON : `[{label, reason}]`)
- `status` : `active | superseded | contradicted | retired`

**`assumption`** — ce sur quoi une décision repose ; **c'est l'objet que le moteur surveille**.
- `decision_id`, `statement`, `kind` :
  - `person_available` (`account_id`, `until`)
  - `capacity` (`team_or_vendor`, `max_open_issues`)
  - `dependency_done_by` (`issue_key`, `date`)
  - `obligation_holds` (`obligation_id`)
  - `routing` (`scopeJql`, `labelPrefix`, `expected`) — le travail dans un périmètre garde une valeur de label (ex. lot 3 → `vendor-boreal`) ; c'est le détecteur de contradiction de décision
  - `freeform` (surveillance manuelle)
- `params` (JSON), `status` : `holding | shaken | broken`, `last_checked_at`, `evidence` (JSON)

**`link`** — la primitive n°3, la chaîne causale explicite.
- `from_type`, `from_id`, `to_type`, `to_id`, `relation` :
  - `obligation -feeds_from-> issue`
  - `obligation -depends_on-> decision`
  - `decision -rests_on-> assumption`
  - `assumption -about-> person | issue | obligation`
  - `issue -blocks-> issue` (importé de Jira)
- `origin` : `user | import | inferred`, `confidence` (0–1)

### 5.2 Moteur

**`signal`** — un fait détecté, horodaté, avec preuve.
- `type` (voir §6.2), `severity` (1–5), `subject_type`, `subject_id`, `detected_at`, `evidence` (JSON : clés de tickets, dates, valeurs mesurées, URLs), `resolved_at`

**`forecast`** — une trajectoire de rupture calculée.
- `obligation_id`, `projected_breach_date`, `probability` (0–1, voir §6.3), `projected_cost`, `currency`
- `chain` (JSON ordonné : liste de `{signal_id | assumption_id | decision_id | issue_key, role, date}`)
- `computed_at`, `superseded_by`

### 5.3 Le document

**`future_incident`** — le post-mortem du futur.
- `forecast_id`, `title` (ex. *Incident 2026-12-14 — Meridian contract, Lot 3 SLA breach*)
- `incident_date` (futur), `status` : `draft | published | averted | materialized | dismissed`
- `confluence_page_id`, `confluence_page_url`, `version`
- `summary`, `impact_statement`, `root_cause`, `timeline` (JSON), `contributing_factors` (JSON), `actions` (JSON : `[{title, issue_key, status}]`)
- `averted_at`, `cost_avoided`, `materialized_at`

**`action_item`** — `future_incident_id`, `title`, `description`, `issue_key`, `status` (miroir Jira), `prevents_signal_types` (JSON) — permet de savoir quelles actions éteignent quels signaux.

### 5.4 Config
KVS : `settings` (espace Confluence cible, projet Jira des actions, seuils de publication, mode démo on/off), `migration_version`.

---

## 6. Le moteur (le cœur technique, là où vont les semaines 3 et 4)

### 6.1 `GraphSource` — abstraction d'accès au graphe
```js
// Contrat d'interface, les deux implémentations doivent le respecter
class GraphSource {
  async issuesInScope(jql, fields)              // tickets + SLA + assignee + liens
  async issueLinks(issueKey)                    // blocks / is blocked by
  async personAvailability(accountId, from, to) // présence (calendrier si TWG, sinon table locale)
  async teamLoad(teamOrVendor)                  // charge ouverte
  async pagesMentioning(terms)                  // décisions candidates (Confluence)
  async decisionsAround(issueKey)               // TWG : décisions/pages reliées ; REST : table link
}
```
`RestGraphSource` suffit pour tout le périmètre ; `TwgGraphSource` enrichit `decisionsAround` et `personAvailability` via Cypher quand l'EAP est actif. Un flag `GRAPH_SOURCE=rest|twg|auto`.

### 6.2 Détecteurs de signaux (un module par type, tous idempotents)

| Type | Détecte | Preuve stockée |
|---|---|---|
| `obligation_trend` | Sur la période en cours, le ratio projeté passe sous le seuil (régression linéaire simple sur les tickets clos + tickets ouverts proches de l'échéance SLA) | ratio actuel, ratio projeté, nb de tickets restants, marge |
| `assumption_person_unavailable` | `person_available` ⟂ absence connue (table locale `availability` en REST ; calendrier en TWG) sur la fenêtre où ses tickets sont dus | account, dates, tickets concernés |
| `assumption_capacity_exceeded` | `capacity` ⟂ nb de tickets ouverts affectés au vendor/équipe > max | compte, liste |
| `assumption_dependency_slipping` | `dependency_done_by` ⟂ ticket non résolu et date due < `date` – marge, ou ticket bloqué | clé, statut, bloqueurs |
| `decision_contradicted` | Une hypothèse `routing` d'une décision active est violée : un ticket du `scopeJql` porte un label `labelPrefix*` différent de `expected` (ex. décision « lot 3 → Boreal », ticket lot 3 étiqueté `vendor-helios`) | ticket, décision, label divergent |
| `stale_critical_issue` | Ticket dans le `jql_scope` d'une obligation sans mise à jour depuis N jours et échéance proche | clé, jours |
| `single_point_of_failure` | ≥ X % des tickets d'une obligation sur une seule personne | account, % |
| `person_silent` | Une personne détient ≥ 2 tickets ouverts du périmètre, aucun touché depuis ≥ 5 jours (indisponibilité de fait, sans calendrier) | personne, tickets, jours |

Chaque détecteur retourne `[]` ou des signaux avec `evidence` suffisante pour écrire une phrase de timeline **sans aucune autre requête**.

### 6.3 Chaînes et projection (`chains.js`, `forecast.js`)

1. Pour chaque obligation active : collecter les signaux la touchant directement + ceux touchant les décisions dont elle dépend + ceux touchant les hypothèses de ces décisions (parcours via `link`, profondeur ≤ 3).
2. Ordonner la chaîne par date (passée et projetée) → c'est la **timeline** du post-mortem.
3. Date de rupture projetée : min(échéance de période, date où la tendance passe le seuil, date de dépendance manquée).
4. Probabilité (score explicable, pas une boîte noire) :
   - base = gravité pondérée des signaux directs (0–0,6)
   - + 0,1 par hypothèse `broken`, + 0,05 par `shaken` (plafond 0,3)
   - + 0,1 si `decision_contradicted`
   - − 0,1 par action corrective ouverte en cours, − 0,2 par action faite depuis le dernier calcul
   - borné [0,05 ; 0,98]
5. Coût projeté : depuis `penalty_type/value/invoice_basis` ; afficher la formule dans le document (le juge doit pouvoir vérifier le calcul).
6. Seuil de publication (config, défaut 0,6) : au-dessus → `future_incident` créé/mis à jour ; en dessous → forecast conservé mais pas de page.

### 6.4 Narratif (`narrative/`)

Format strictement calqué sur un post-mortem d'incident classique, pour que le choc vienne de la date, pas du format :

```
# Incident 2026-12-14 — Meridian contract, Lot 3 SLA breach   [PROJECTED · 78 %]
> This incident has not happened yet. Every statement below links to evidence that exists today.

## Impact
## Root cause
## Timeline            ← passé (preuves) puis futur (projections), même tableau, les lignes futures en italique
## Contributing factors
## What would have prevented it   ← devient "Corrective actions" avec liens Jira
## Evidence              ← liste de toutes les preuves (clés, pages, dates)
## How this forecast was computed   ← formule du score et du coût, lisible
```

Templates par type de signal (une ou deux phrases chacun), assemblage déterministe, dates relatives rendues en absolu. Ton sobre, factuel, pas de dramatisation. Le document doit rester crédible pour un juge qui a déjà écrit de vrais post-mortems.

### 6.5 Option LLM (désactivée par défaut)
Un `narrative/polisher.js` peut reformuler le résumé via un fournisseur externe si l'admin saisit une clé (egress déclaré, `external.fetch.backend`). Jamais requis, jamais montré en démo principale. À ne construire que s'il reste du temps en semaine 6 ; sinon le retirer du manifest pour ne pas alourdir la liste de permissions.

### 6.6 Cycle de vie du document
- `draft → published` : création de la page Confluence (espace configuré), lien dans le command center, tickets d'actions créés (projet configuré, label `antemortem`, lien vers la page).
- Recalcul (scheduler, événement, bouton) : si probabilité < seuil et toutes les actions faites → `averted` : la page est archivée dans une page parent **« Averted incidents »** avec bandeau *Averted on {date}. Estimated cost avoided: {x}.* ; `cost_avoided` cumulé sur le command center.
- Si `incident_date` dépasse et obligation effectivement rompue → `materialized` : bandeau *This post-mortem was written {n} days before the incident.* (moment fort possible dans la vidéo, mais à n'utiliser que si on a le temps de simuler le passage du temps).
- `dismissed` : l'utilisateur rejette avec un motif ; le motif alimente `evidence` et abaisse le poids du signal correspondant pendant 30 jours.

---

## 7. Écrans et expérience

Design : sobre, dense, typographie forte, une seule couleur d'accent, aucun effet « IA magique ». Utiliser Atlassian Design System (`@atlaskit/*`) pour la cohérence native ; soigner l'état vide et le mode démo.

1. **Command center** (page globale)
   - En-tête : *Next post-mortem in 16 days* + coût cumulé à risque + coût évité à date.
   - Liste des `future_incident` publiés : date, titre, probabilité, coût, nb d'actions restantes, bouton *Open post-mortem*.
   - Onglets : Obligations (état par obligation, barre « ratio actuel / seuil / projeté »), Decisions (avec hypothèses et leur état), Averted incidents (registre), Settings.
   - Bouton discret *Run analysis now*.
2. **Vue post-mortem** (Custom UI en modal + la page Confluence elle-même) : le document, chaque preuve cliquable, chaque action avec son statut Jira en direct, bouton *Dismiss with reason*.
3. **Obligation editor** : formulaire + test JQL en direct (« 47 issues in scope, 44 within SLA this period »).
4. **Record a decision** (issue action, content action, Rovo) : titre, décision, alternatives, et surtout **les hypothèses** avec leur type ; pré-remplissage depuis le ticket/la page.
5. **Issue panel** : « This issue feeds obligation O-3 (Meridian). It appears in the projected incident of 14 Dec. » avec lien. C'est le point d'entrée le plus vu dans la vraie vie.
6. **Rovo agent** : 4 conversation starters, réponses courtes qui renvoient vers la page.

---

## 8. Scénario de démo (embarqué dans l'app, `src/demo/`)

Un bouton **Load demo scenario** dans Settings crée tout (projet Jira `NFS`, ~90 tickets avec statuts et dates cohérents, espace Confluence `ANTE`, 3 pages de décisions, 1 contrat, 4 obligations, 3 décisions, 6 hypothèses, table d'absences). Un bouton **Reset demo** nettoie. Le scénario **converge vers un incident à J+16**, quelle que soit la date d'exécution (fenêtre contractuelle J−14 → J+16, calculée relativement à « aujourd'hui »).

Choix d'implémentation (semaine 2) : le chargement tourne dans un **consumer d'événements asynchrones** (jusqu'à 15 min, les résolveurs sont limités à 25 s), avec progression par étape en KVS et reprise idempotente. Les personnes et prestataires sont des **labels** (`tech-karim`, `vendor-boreal`, `lot-3`) plutôt que des comptes ou des champs personnalisés : aucun utilisateur réel n'existe sur le site du juge, et les labels ne demandent aucune configuration. Les dates historiques sont portées par la **propriété d'issue `antemortem`** (Jira n'antidate pas `created` via l'API) ; `RestGraphSource` la lit en priorité et retombe sur `created` / `resolutiondate` / `duedate` pour les tickets réels.

Univers fictif (aucun nom réel) :
- Client : **Meridian Telecom** · Prestataire : **Nordlink Field Services** (l'organisation qui utilise l'app)
- Contrat *Maintenance curative réseau fixe 2026*, lots 1–4 ; l'histoire se passe sur le lot 3 (zone Nord).
- Obligations : O-1 délai de prise en charge, O-2 taux de réitération, **O-3 95 % d'interventions sous 4 h/mois, pénalité 2 % de la facture mensuelle (2 M€ → 40 k€)**, O-4 reporting mensuel J+5.
- Décision D-7 (COPIL de septembre) : « lot 3 reste chez le sous-traitant Boreal plutôt que d'internaliser », hypothèses : Boreal ≤ 25 tickets ouverts ; Karim (seul habilité HTA côté Nordlink) disponible jusqu'à fin décembre ; livraison des badges d'accès site (ticket NFS-118) avant le 1er décembre.
- Ce qui se passe dans les données : Boreal à 31 tickets ouverts (capacité dépassée) ; Karim réaffecté sur le lot 1 depuis J−3 (hypothèse brisée) ; le ticket « Site access badges » (dû J+2) bloqué par « Badge supplier contract amendment » sans mouvement depuis 9 jours ; ratio O-3 à 93,0 % (40/43) avec 11 tickets ouverts dont 6 proches des 4 h ; un ticket créé J−1 réaffecte 4 interventions lot 3 à Helios (contradiction de D-7). Les clés Jira sont attribuées au chargement (pas de `NFS-118` fixe).
- Résultat attendu : post-mortem *Incident 2026-12-14 — Meridian contract, Lot 3 SLA breach*, probabilité ~0,78, coût 40 000 €, 4 actions correctives (débloquer NFS-097, réaffecter Karim ou habiliter un second technicien, plafonner Boreal, acter formellement l'écart à D-7).
- Déroulé « averted » pour la vidéo : passer 2 actions à Done → relancer l'analyse → probabilité 0,41 → page archivée dans *Averted incidents*, *Estimated cost avoided: €40,000*.

Le même scénario sert aux tests automatisés du moteur (snapshot du post-mortem généré).

---

## 9. Plan sur 8 semaines (29 oct → 22 déc)

**État au 30 oct** : semaines 1–3 livrées et vérifiées sur site ; semaines 4–7 livrées dans le dépôt (narratif, publication, cycle de vie, agent Rovo, panneau, durcissement, instructions juges, script vidéo, passage design), puis v0.7 (passe de densité) et v0.8 (what-if, history/backtest, détecteur `person_silent`, Portfolio, macro Confluence, décisions proposées depuis une page par l'agent) — **le tout en attente de déploiement et de vérification sur site** (version majeure : nouveau module `macro`, nouvelle action Rovo). Puis (30 oct, soir) : déployé en dev **et en production**, vérifié de bout en bout sur `antemortem-dev` et test juge réussi sur `arnaudlothe` (site vierge). Rovo Chat absent des deux sites (Standard gratuit : Rovo exige un plan payant) → l'agent est le seul module non vu en vrai. **Décision** : l'agent reste dans la vidéo ; test obligatoire sur un essai Premium 14 jours (`arnaudlothe`) à lancer vers le 1er décembre, et le bonus Rovo n'est déclaré que si l'agent a tourné correctement. *(31 oct : deux fils communauté signalent Rovo Chat absent même sur des essais Premium récents — lancer l'essai au plus tard le 1er déc. et vérifier Rovo Chat plusieurs jours avant le tournage, pas la veille ; prévoir la vidéo sans agent si besoin.)* Reste : lien d'installation (distribution), vidéo, soumission.

Chaque semaine se termine par : déploiement sur le site de dev, **installation depuis zéro sur le site vierge**, et une courte note dans `CHANGELOG.md`. Règle : à tout moment, `main` doit produire une app installable qui fait *quelque chose* de montrable.

| Sem. | Dates | Objectif | Livrable vérifiable |
|---|---|---|---|
| 1 | 29 oct – 2 nov | Mise en route (§3), accès EAP demandé, squelette Forge avec tous les modules déclarés (vides), Forge SQL + migrations + hook d'installation | App installée sur les deux sites, tables créées, page globale « Hello » |
| 2 | 3 – 9 nov | Modèle (§5) : repos, CRUD obligations/décisions/hypothèses, `RestGraphSource`, **scénario de démo seed/reset** | Bouton *Load demo* → données visibles dans Jira/Confluence et dans l'app |
| 3 | 10 – 16 nov | Moteur partie 1 : détecteurs de signaux + chaînes + projection ; tests snapshot | *Run analysis now* produit des `forecast` cohérents sur la démo |
| 4 | 17 – 23 nov | Moteur partie 2 : narratif, création de la page Confluence, tickets d'actions, cycle de vie (published → averted) | Le post-mortem du 14/12 existe dans Confluence, les actions dans Jira, l'« averted » fonctionne |
| 5 | 24 – 30 nov | Rovo agent + actions ; `TwgGraphSource` si EAP ; issue panel ; **écriture du script vidéo** | Agent répond à *what is my next post-mortem?* ; panel visible sur NFS-118 |
| 6 | 1 – 7 déc | Design pass complet du command center et de la vue post-mortem ; états vides ; Settings ; **gel du périmètre** ; choix du bonus | Parcours complet sans friction, sur un site vierge, par quelqu'un qui n'a pas développé |
| 7 | 8 – 14 déc | Durcissement : erreurs, permissions, perf des requêtes Jira (pagination, champs), `JUDGE_INSTRUCTIONS.md`, lien d'installation, **tournage vidéo** | Installation par un tiers en < 10 min en suivant les instructions ; rushes vidéo prêts |
| 8 | 15 – 22 déc | Montage, description de la soumission, **soumission le 15**, puis corrections mineures tolérées par les règles (on ne touche plus au code après soumission) | Soumission validée ; swag réclamé |

Répartition suggérée si vous êtes deux : A = moteur + modèle + Confluence/Jira ; B = Custom UI + démo + Rovo + vidéo. Si vous êtes trois : C = `GraphSource` TWG + issue panel + instructions juges + tests d'installation. Seul : suivre le tableau tel quel, en coupant `rovo:mcp` et l'option LLM d'emblée.

---

## 10. Checklist de soumission (à cocher littéralement)

**Projet**
- [ ] Manifest Forge avec ≥ 1 module, app créée après le 27 octobre 2026
- [ ] Intégration réelle à Jira, Confluence (et Rovo / TWG selon bonus)
- [ ] Installation **depuis zéro** sur un site vierge réussie par un tiers, en suivant `JUDGE_INSTRUCTIONS.md`
- [ ] Lien d'installation généré (*Distribute your apps → Start sharing your app*), environnement `production` ou `staging` déployé — pas `development`
- [ ] Mode démo : *Load demo scenario* fonctionne sur un site sans aucune donnée préalable ; *Reset* nettoie
- [ ] Aucune clé API, aucun service externe requis
- [ ] Données de démo 100 % fictives, aucun logo ni nom réel

**`JUDGE_INSTRUCTIONS.md`** (copié dans le champ *Testing instructions* de la soumission)
- [ ] Prérequis : site Jira + Confluence, Rovo activé (comment), droits admin
- [ ] Étapes numérotées : installer via le lien (Jira puis Confluence), ouvrir Settings, choisir espace/projet, *Load demo scenario*, *Run analysis now*, ouvrir le post-mortem, faire 2 actions, relancer, voir *Averted*
- [ ] Ce qu'il faut regarder pour le bonus choisi (où est l'agent / où est l'appel TWG)
- [ ] Capture d'écran de chaque étape

**Vidéo**
- [ ] < 5 min, YouTube public, lien dans le formulaire
- [ ] Problème + audience + démo de bout en bout + « averted » **avant 3:00**
- [ ] Pas de musique protégée (musique libre de droits ou aucune), pas de marque tierce visible (masquer les favoris, onglets, noms de sites)
- [ ] Sous-titres anglais (accent + débit : les sous-titres aident toujours)

**Soumission**
- [ ] Titre, tagline (la phrase du §0), description (§12), catégorie, bonus (un seul), lien vidéo, lien d'installation, instructions, 4–5 captures
- [ ] Champ « how it meets the technology requirement » rempli avec la liste des modules Forge et des APIs
- [ ] Représentant de l'équipe désigné ; répartition du prix convenue par écrit entre membres
- [ ] Soumis avant le 15 décembre (objectif), au plus tard le 22 à 21:00 Paris

---

## 11. Script vidéo (cible 3:00, max 4:30)

| Temps | Image | Voix |
|---|---|---|
| 0:00–0:20 | Une vraie page de post-mortem classique, qui défile | *Every organization writes the same document after things go wrong. It's the most honest document we produce. And it always comes too late.* |
| 0:20–0:35 | Titre : Antemortem | *Antemortem writes your post-mortems before the incidents happen.* |
| 0:35–1:10 | Command center, demo loaded : *Next post-mortem in 16 days* ; on ouvre la page Confluence datée du 14 décembre | *This is a post-mortem for an incident that hasn't happened yet: a 40,000-euro contract penalty, 16 days from now. Every line of the timeline links to evidence that exists today.* Clic sur 2 preuves (décision D-7, ticket bloqué). |
| 1:10–1:40 | Scroll : Root cause, Contributing factors, How this forecast was computed | *The root cause is not a late ticket. It's a decision from September that rested on three assumptions, and two of them no longer hold. Nothing in the platform knew these things were connected. Antemortem does, because it makes obligations, decisions and assumptions first-class objects.* |
| 1:40–2:20 | Corrective actions → on passe 2 tickets à Done dans Jira → *Run analysis now* → la page bascule dans *Averted incidents*, *Estimated cost avoided: €40,000* | *The actions are real Jira issues. Close them, and the post-mortem dissolves. It becomes part of a different record: the incidents that never happened.* |
| 2:20–2:45 | Issue panel sur un ticket ; Rovo : *What's my next post-mortem?* | *It meets people where they work: on the issue, or in Rovo.* |
| 2:45–3:00 | Retour command center, coût évité cumulé | *Built on Forge, Jira, Confluence and Rovo. Antemortem: write the post-mortem first, then make sure it's never needed.* |
| 3:00–4:00 (optionnel) | Architecture en un schéma, mention du bonus, how to install | Pour les juges qui continuent. |

Tournage : écran 1920×1080, zoom navigateur 110 %, curseur visible, pas de notifications, site de démo dédié avec un nom neutre. Voix enregistrée séparément et posée au montage.

---

## 12. Texte de soumission (brouillon, anglais)

**Tagline** — *Antemortem writes your post-mortems before the incidents happen — then helps you make sure they never get written for real.*

**Inspiration** — Every organization writes the same document after a failure: the post-mortem. Timeline, root cause, contributing factors, corrective actions. It is the most honest document a team produces, and it always arrives too late. The information needed to write it earlier existed — in tickets, pages, meeting decisions, leave calendars — but nothing connected it.

**What it does** — Antemortem continuously reads the organization's work graph and, when a breach becomes likely, writes the complete post-mortem of the upcoming incident in Confluence, dated in the future. Every line links to evidence that exists today. Corrective actions are created as Jira issues. When they're done, the post-mortem dissolves into a ledger of averted incidents, with the cost avoided.

**How we built it** — Three primitives the platform doesn't have today, built on Forge SQL: contractual *Obligations* (measurable rules linked to the Jira issues that feed them), *Decisions with Assumptions* (what was decided, and what it rested on), and explicit *causal links* between them. A rules-based, fully explainable engine detects signals (broken assumptions, contradicted decisions, capacity overruns, slipping dependencies, SLA trends), builds causal chains, projects a breach date, probability and cost, and renders a deterministic post-mortem — no external LLM, no API key, runs as-is in any site. Forge modules: global page (Custom UI), issue panel, issue and content actions, Jira event triggers, scheduled trigger, web trigger, Rovo agent with four actions, Forge SQL. [+ Teamwork Graph API if used.]

**Challenges / What we learned / What's next** — à compléter en semaine 8 avec du vécu réel (les juges sentent le texte générique).

---

## 13. Hors périmètre (va dans `BACKLOG.md`, pas dans le code)

Import automatique de contrats PDF ; connecteur TWG sortant (publier nos objets dans le graphe) ; what-if sur les dates ; multi-devises ; notifications Slack/Teams ; agent qui commente de lui-même dans les tickets ; Marketplace listing (bonus abandonné : la review prend trop de temps pour ce calendrier).

---

## 14. Règles de travail

- Une seule source de vérité : ce fichier. Si une décision change, on modifie le §0, on ne la garde pas en tête.
- Toute idée nouvelle → `BACKLOG.md`. On n'en parle pas avant la semaine 6.
- Chaque vendredi : installation depuis zéro sur le site vierge par la personne qui n'a pas codé la fonctionnalité.
- Le post-mortem généré doit pouvoir être lu à voix haute à quelqu'un qui a déjà écrit de vrais post-mortems sans qu'il lève un sourcil. C'est le test de qualité du narratif.
- Quand on hésite entre deux fonctionnalités : celle qui relie deux choses que rien ne reliait gagne. L'autre est du décor.
