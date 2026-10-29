# Antemortem

> This app writes your post-mortems before the incidents happen — then helps you make sure they never get written for real.

Atlassian Forge app, built solo for **Codegeist 2026**. Everything about the project — concept, architecture, data model, engine, demo scenario, plan, submission checklist — lives in **[BUILD.md](BUILD.md)**. Read that first.

## Quick start

```bash
npm install && npm run install:ui
npm test
npm run deploy:dev
forge install --non-interactive -e development --site antemortem-dev.atlassian.net --product jira
forge install --non-interactive -e development --site antemortem-dev.atlassian.net --product confluence
```

Then open **Apps → Antemortem** in Jira. The health screen should show every table as `ready` within a minute of installation (Forge applies the schema asynchronously); if not, click **Repair database**.

## Layout

```
manifest.yml                 Forge modules, scopes, runtime
src/index.js                 function entry points
src/resolvers/               Custom UI resolvers
src/triggers/                install / hourly / webtrigger
src/db/                      Forge SQL: migrations, runner, query helpers
src/engine/                  analysis pipeline (detectors → chains → forecast → narrative)
src/settings.js              KVS-backed settings
static/command-center/       React 18 + Vite frontend (build → dist/)
test/                        node --test
```

## Status

See [CHANGELOG.md](CHANGELOG.md). Ideas outside the current scope go to [BACKLOG.md](BACKLOG.md), not into the code.
