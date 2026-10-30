# Antemortem — Testing instructions for judges

> Antemortem writes your post-mortems before the incidents happen — then helps you make sure they never get written for real.

Everything below runs on a **fresh Atlassian Cloud site with no data**. The app ships its own demo scenario (entirely fictional), creates it in one click, and removes it in one click. No API key, no external service, no configuration file. Allow **about 10 minutes** end to end.

## Prerequisites

- A Jira Software site with Confluence on the same site, where you are a **Jira administrator** (the app creates a Jira project and a Confluence space for the demo).
- **Rovo** available on the site (needed only for the agent part; the rest works without it).
- The installation link from the submission.

## 1. Install (2 minutes)

1. Open the installation link and install Antemortem on **Jira**, then open the link again and install it on **Confluence** (the app needs both; Forge asks for each product separately).
2. Accept the scopes. `manage:jira-configuration` and `write:confluence-space` are used **only** by the demo loader, to create and delete the demo project and space; the forecasting engine itself only reads work items and writes pages and issues.
3. In Jira, open **Apps → Antemortem** (left sidebar). You should see the command center with the **Overview** tab. Within about a minute of installation every table in *Health* shows `ready`; if one is still `missing`, click **Repair database** (Forge applies the schema asynchronously).

## 2. Load the demo scenario (3 minutes)

1. Open the **Settings** tab.
2. Click **Load demo scenario**, then click it again to confirm (two clicks, no modal).
3. Watch the nine steps complete (about two minutes). This creates:
   - Jira project **NFS** (*Nordlink Field Services — Meridian*): ~90 field-service issues with a six-week history, one blocked dependency, one issue that quietly contradicts a steering-committee decision;
   - Confluence space **ANTE** (*Nordlink Operations*): three steering-committee pages;
   - in Antemortem: one contract, four obligations (**Obligations** tab), three decisions with their monitored assumptions (**Decisions** tab).
   The scenario is generated relative to today: it converges on an incident **16 days from now**, whenever you load it.
4. Settings now points at space `ANTE` and project `NFS`.

## 3. Run the analysis (1 minute)

1. Back on **Overview**, click **Run analysis now**. The analysis runs in the background (10–40 s); the page refreshes when it is done.
2. You should see **"Next post-mortem in 16 days."** — obligation **O-3** (*Restoration ≤ 4 h on 95 % of lot 3 interventions*) at **~80 % probability, €40,000**, and at the top a card titled *Incident <date> — Meridian Telecom, O-3 breach*.
3. Click **Show chain** on O-3: a dated causal chain from the September steering-committee decision to the projected breach, and the arithmetic of the probability.
4. **What if**: tick the checkbox on a chain event (for instance the engineer's reassignment) — the probability is recomputed without that evidence, nothing is written. Tick *every open issue restored within the SLA* to see that even then the period closes below 95 %: the three breaches already in the books weigh.
5. **History**: click **History** on the O-3 row. The engine is replayed on the work as it stood every two days since the period started; the curve shows when the forecast crossed the publish threshold and how many days before the breach.
6. The **Portfolio** tab shows the same from the contract's point of view: penalties projected, penalties at stake, which obligations hold.

## 4. Read the post-mortem of an incident that has not happened (2 minutes)

1. On the incident card, click **Open post-mortem**. It opens the Confluence page, under *Projected incidents* in space ANTE.
2. It is written like any post-mortem — Impact, Root cause, Timeline, Contributing factors, Corrective actions, Evidence — except that its date is in the future. Every timeline row links to the Jira issue or Confluence page that is the evidence. The root cause is not a late ticket: it is a decision whose four assumptions no longer hold.
3. Scroll to **How this forecast was computed**: every term of the probability and the cost formula are printed. No language model is involved anywhere in the app; the text is deterministic.
4. Back in Jira, the five corrective actions exist as issues in project NFS (label `antemortem`).

## 5. Avert the incident (2 minutes)

1. In Jira, open two of the corrective-action issues (for instance *"Unblock NFS-88…"* and *"Restore Karim Benali…"*) and move them to **Done**.
2. In Antemortem, click **Run analysis now** again.
3. The incident card disappears from Overview; the **Averted** tab now lists it with **€40,000 avoided**, and the Confluence page has moved under *Averted incidents* with a banner: *"Averted on <date>. Estimated cost avoided: €40,000. This post-mortem was written 16 days before the projected incident and never had to be written for real."*

## 6. Where it meets people (1 minute)

- **Issue panel**: open issue **NFS-87** (*Site access badges*). The *Antemortem* panel on the right shows the broken assumption it is part of, the decision behind it and the projected incident it appears in.
- **Rovo agent**: open Rovo chat, pick the **Antemortem** agent and ask *"What is my next post-mortem?"* or *"Why is O-3 at risk?"*. The agent answers only from the engine's data through its actions (no invented figures). If you averted the incident in step 5, it says so and names the last averted incident.
- **Decisions from a page**: paste the URL of the *D-7* steering-committee page (space ANTE) to the agent and ask it to record the decision. It reads the page, proposes the decision and typed assumptions, and records nothing until you confirm. The engine stays deterministic: the agent only helps with data entry.
- **Confluence macro**: edit any page in space ANTE, type `/Antemortem` and insert the macro: the projected incidents, their probability and cost, on the page where the contract lives.

## 7. Clean up

Settings → **Reset demo** (two clicks): deletes project NFS, space ANTE and the demo model.

## What to look at for the bonus category

**Best Agents (Rovo)** — `rovo:agent` *Antemortem* with five `action` modules (`get-next-incident`, `explain-obligation`, `list-obligation-status`, `list-corrective-actions`, `record-decision`). The actions are declared with `read:chat:rovo`, so customer-built agents can call them as tools too.

## If something goes wrong

- *Tables show `missing`*: click **Repair database**; Forge's hourly trigger also retries.
- *Demo load failed at a step*: click **Load demo scenario** again — completed steps are skipped. The usual cause is a pre-existing project `NFS` or space `ANTE` from an earlier attempt; use **Reset demo** first.
- *No corrective actions on the incident card*: check that Settings points at project `NFS` (the loader sets it; a manual change may have cleared it).
- *Rovo agent not listed*: Rovo must be enabled on the site, and the app installed on the product where you open the chat.
