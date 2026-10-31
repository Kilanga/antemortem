---
name: antemortem-forecasts
description: Use Antemortem's tools when a user asks what contractual breach is coming, why an obligation is at risk, which corrective actions are open, or wants a decision or an obligation recorded from a Confluence page. Antemortem writes post-mortems of incidents before they happen; every figure comes from its deterministic engine, never from the model.
allowed-tools: get-next-incident explain-obligation list-obligation-status list-corrective-actions read-page-for-decision record-decision record-obligation
license: MIT
---

# Antemortem forecasts

Antemortem watches contractual obligations (SLA ratios, counts, deadlines), the decisions they depend on and the typed assumptions those decisions rest on. When a breach becomes likely it publishes a projected incident: a post-mortem page dated in the future, with corrective actions as Jira issues. When the actions bring the forecast down, the page archives itself as an averted incident.

## Rules

- Call a tool before stating any date, probability, cost or status. Quote what the tool returns; never invent or round differently.
- Answer in at most four short sentences: date, probability and cost; the cause; the next action. Link the post-mortem page when one is returned.
- Projected incidents have not happened. Say so once if the user seems to think otherwise.
- If a tool returns `error`, say what is missing instead of guessing.

## Which tool

| The user asks | Tool |
|---|---|
| what is coming, what is my next post-mortem | `get-next-incident` |
| why is O-3 at risk, explain an obligation | `explain-obligation` with the code |
| how are we doing, status of the obligations | `list-obligation-status` |
| what should we do, what are the actions | `list-corrective-actions` (optionally with a code) |
| record the decision / the obligations from this page | `read-page-for-decision` with the page URL, then propose, then confirm |

## Recording from a page

`read-page-for-decision` returns the page text and the references you may use to type what you record (people, vendors, obligations, open issues, project keys). Propose first, as a short list; record only after the user says yes.

- A decision: `record-decision` with `title`, `statement`, `decidedAt`, `sourceUrl`, `obligationCode`, and `assumptions` as one line each: `statement :: kind :: key=value, key=value`. Kinds: `capacity` (teamRef, maxOpenIssues), `person_available` (personRef, displayName, until), `dependency_done_by` (issueKey, date), `routing` (scopeJql, labelPrefix, expected). A line without `::` is free text and is not monitored.
- An obligation: `record-obligation` once per clause, with `metricType` (`ratio_within_sla`, `jsm_sla`, `count_max`, `count_min`, `deadline`), `threshold`, `slaHours` or `slaName`, `period` (`monthly`, `weekly`, or `custom YYYY-MM-DD YYYY-MM-DD`), `penalty` (`fixed <amount>` or `percent <value> of <invoice basis>`), and a `jqlScope` on a listed project key.

Both recording tools require the user to be a Jira administrator; they return an `error` otherwise. Do not retry.
