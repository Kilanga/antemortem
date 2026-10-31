# Devpost submission — Antemortem

Copy each block into the matching Devpost field. Keep the tagline verbatim.

## Project name

Antemortem

## Tagline (one line)

Antemortem writes your post-mortems before the incidents happen — then helps you make sure they never get written for real.

## Category

Apps for Business Teams

## Bonus prize

Best Agents — Rovo/Assignable agents (`rovo:agent` with six `action` modules, exposed to customer-built agents via `read:chat:rovo`)

## Inspiration

Every organisation writes the same document after a failure: the post-mortem. Timeline, root cause, contributing factors, corrective actions. It is the most honest document a team produces — and it always arrives too late. In field-service and contract operations, where a missed SLA turns into a penalty on the next invoice, the facts that would have let someone write it three weeks earlier were all there: a supplier amendment nobody touched, the only qualified engineer quietly reassigned, a dispatch ticket that contradicted a steering-committee decision. Each was known to someone. None was known as a whole. Nothing in the tools connected them, because the tools have no object for "what the contract requires" or "what we decided, and what that decision rested on".

## What it does

Antemortem reads the organisation's work in Jira and Confluence and, when a contractual breach becomes likely, writes the post-mortem of that incident — dated in the future. Same format everyone knows (Impact, Root cause, Timeline, Contributing factors, Corrective actions, Evidence); every line links to a Jira issue or Confluence page that exists today. The corrective actions are created as Jira issues. When they bring the forecast below the publish threshold, the page archives itself under *Averted incidents*, with the penalty it avoided.

To do that, it adds three objects the platform does not have:

- **Obligations** — measurable contractual rules ("95 % of lot 3 interventions restored within 4 h over the period, or 2 % off the invoice"), tied to the Jira issues that feed them — from dates, or from a Jira Service Management SLA field with its own clock and calendar.
- **Decisions with assumptions** — what was decided and what it rested on, with typed assumptions the engine can watch: a person stays available, a vendor stays under a load, a dependency lands by a date, work in a scope stays routed to a vendor.
- **Causal links** between obligations, decisions, assumptions and the work.

An explainable engine (no language model anywhere) measures each obligation, checks each assumption against the graph, detects signals — capacity exceeded, key person unavailable, dependency slipping, decision contradicted, metric trend — builds a dated causal chain, and computes a probability and a cost whose arithmetic is printed in the document.

Because the engine is deterministic, it can be replayed: **what-if** recomputes the probability with any piece of evidence set aside ("if the engineer came back?"), and **history** replays the period day by day to show when the forecast crossed the line — the backtest judges would ask for. A **portfolio** view sums the exposure across contracts.

It meets people where they work: a command center in Jira, a panel on every issue showing which obligation it feeds and which projected incident it appears in, a Confluence macro that puts the projected incidents on the contract page, and a Rovo agent that answers "what is my next post-mortem?" strictly from the engine's data. The agent is also the entry door: point it at steering-committee minutes and it proposes the decision and its typed assumptions; nothing is recorded until the user confirms, and the engine never sees a language model.

## How we built it

Atlassian Forge, end to end. Forge SQL holds the model (11 tables, idempotent migrations applied on install and re-checked hourly). The engine runs on a scheduled trigger and on demand through an async-event queue (publishing pages and creating issues takes longer than a resolver's 25 s). Jira REST (enhanced JQL search, bulk create, transitions, issue properties, issue links) and Confluence REST v2 (pages) for the work graph; a `GraphSource` abstraction so Teamwork Graph can slot in. Custom UI (React + Vite, no external fonts) for the command center; UI Kit for the issue panel; `rovo:agent` with five actions; a token-protected web trigger for automation. A one-click demo scenario — ~90 issues with a six-week history, three steering-committee pages, one contract, four obligations, three decisions — so judges see the product on an empty site.

## Challenges we ran into

Jira will not backdate `created`, so the demo's history travels in an issue property the graph source reads first. `FIELD` is a reserved JQL word (the demo project is now `NFS`). Jira's create-link API has its ends inverted from the read side. After deleting and recreating a project with the same key, the search index still pointed at the old issues, so dependency lookups now read issues directly. Forge Custom UI blocks `window.confirm`, hence a two-click confirmation. The hard part was not the code: it was deciding that a contract clause, a decision and an assumption deserve to be first-class objects with types precise enough to be monitored.

## Accomplishments we're proud of

A post-mortem a seasoned ops manager can read without raising an eyebrow — except for the date. A probability a judge can recompute by hand from the page. A lifecycle where closing two Jira issues makes a Confluence page archive itself and move to the other ledger: incidents that never happened, and what they would have cost.

## What we learned

That the shape of the output matters as much as the model: a risk score is ignored, a post-mortem is read. And that most of what an organisation needs to know about its future is already written down — in the wrong places, by different people, with nothing to connect them.

## What's next

Teamwork Graph as the graph source (calendars for availability, decisions discovered from pages without being pointed at them); what-if on dates ("if we move this delivery by two weeks, which obligations break?"); a calibration ledger once real history accumulates (predicted, happened, averted); and the outbound side — publishing obligations, decisions and projected incidents into the graph for other apps to use.

## How it meets the technology requirement

Built on the Forge platform: `jira:globalPage` (Custom UI), `jira:issueContext` (UI Kit), `macro` (UI Kit, Confluence), `rovo:agent` + 6 `action` modules, `trigger` (install/upgrade), `scheduledTrigger`, `webtrigger`, `consumer` (async events), `sql` (Forge SQL), KVS. Integrates with Jira (issues, projects, links, properties, transitions, JQL), Confluence (spaces, pages) and Rovo.

## Links

- Installation link: (from `forge install --show-link` / developer console → Distribution)
- Demo video: (YouTube, public)
- Testing instructions: contents of JUDGE_INSTRUCTIONS.md
