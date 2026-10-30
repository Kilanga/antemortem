# Antemortem

> Antemortem writes your post-mortems before the incidents happen — then helps you make sure they never get written for real.

An Atlassian Forge app for Jira, Confluence and Rovo, built for **Codegeist 2026**. It gives an organisation three objects the platform does not have — contractual **obligations**, **decisions with the assumptions they rest on**, and the **causal links** between them and the work — and an explainable engine that, when a breach becomes likely, writes the post-mortem of that incident in Confluence, dated in the future, with every line linked to evidence that exists today. Corrective actions become Jira issues; when they bring the forecast down, the page archives itself under *Averted incidents* with the penalty it avoided.

- **Project book (French):** [BUILD.md](BUILD.md) — concept, architecture, data model, engine, demo scenario, plan.
- **For judges (English):** [JUDGE_INSTRUCTIONS.md](JUDGE_INSTRUCTIONS.md) — install and test in 10 minutes.
- **What it does, in one screen:** obligations, decisions with typed assumptions, an explainable forecast, a post-mortem published in the future, what-if and history on the causal chain, a portfolio across contracts, an issue panel, a Confluence macro and a Rovo agent that proposes decisions from pages.
- **Submission text:** [DEVPOST.md](DEVPOST.md). **Video plan:** [DEMO_SCRIPT.md](DEMO_SCRIPT.md). **History:** [CHANGELOG.md](CHANGELOG.md). **Out of scope:** [BACKLOG.md](BACKLOG.md).

## Develop

```bash
npm install && npm run install:ui
npm test                      # 35 tests, offline, on the demo scenario
npm run deploy:dev            # build the UI + forge deploy (development)
forge install --upgrade --non-interactive -e development --site <site>.atlassian.net --product jira
forge install --upgrade --non-interactive -e development --site <site>.atlassian.net --product confluence
```

Design the command center without Jira: `cd static/command-center && npm run dev`, then open the dev URL with `?mock=1`.

## Layout

```
manifest.yml                 Forge modules, scopes, runtime
resource/agent/prompt.txt    Rovo agent prompt
src/index.js                 function entry points
src/resolvers/               Custom UI resolvers (admin guard on writes)
src/triggers/                install / hourly / webtrigger
src/rovo/                    Rovo actions
src/frontend/                UI Kit issue-context panel
src/db/                      Forge SQL: migrations, runner, repositories
src/graph/                   GraphSource abstraction (REST today, Teamwork Graph later)
src/engine/                  metrics → signals → chain → forecast → narrative → publish
src/jira/ src/confluence/    REST clients
src/demo/                    demo scenario, async loader, reset
static/command-center/       React 18 + Vite command center (mock mode for design)
test/                        node --test, with an in-memory graph source
```

## Things learned the hard way

- `FIELD` is a reserved JQL word; always quote project keys in JQL.
- Jira's create-link API: `{ inwardIssue: A, outwardIssue: B, type: Blocks }` reads "A blocks B"; the read side on issue X lists `outwardIssue` for "X blocks Y".
- After deleting and recreating a project with the same key, `key in (...)` can return the old issues; read issues directly by key.
- Forge SQL: `timeoutSeconds` only on scheduled triggers and consumers; `id: undefined` in a spread clobbers a generated id; `SIGNAL` is a reserved table name.
- Forge Custom UI blocks `window.confirm`; `@forge/bridge` throws at import outside a product.
