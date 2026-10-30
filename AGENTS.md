# Working on Antemortem with a coding agent

Read **BUILD.md** first: it is the single source of truth (concept, architecture, data model, engine, demo scenario, plan). CHANGELOG.md says what is done and verified; BACKLOG.md holds ideas that are out of scope.

Rules of the repo:

- Node 24, Forge CLI. `npm test` must pass before any push; it runs offline on the demo scenario (`test/helpers/fakeGraph.mjs`).
- Everything the app emits is in English (UI, pages, issues, agent). Project notes may be French.
- Never put secrets, site names or real company/people names in code or demo data. The demo universe is fictional (Meridian, Nordlink, Boreal, Helios).
- Scopes are minimal and justified in `manifest.yml` comments; adding one is a major version bump (`forge install --upgrade`).
- Writes go through resolvers guarded by `admin()`; SQL uses `?` placeholders only; identifiers never come from user input.
- Quote project keys in JQL (`project = "NFS"`); `FIELD` is a reserved word. Read issues by key with `issuesByKeys`, not `key in (...)`.
- The engine is deterministic: no language model, every figure traceable to evidence. Keep it that way.
- Custom UI: no external fonts or scripts (Forge sandbox); `window.confirm` is blocked — use `ConfirmButton`. `?mock=1` renders the UI with fixtures outside Jira.
- Use the Forge MCP server (`.mcp.json`) to check manifest shapes and REST scopes (`get-api-required-scopes`) before adding modules or endpoints.
