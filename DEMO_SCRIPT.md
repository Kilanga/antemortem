# Antemortem — Demo video script

Target **3:00**; hard stop 4:30. Judges are not required to watch beyond three minutes, so the problem, the product, the "wow" and the averted ending all land before 3:00. English, subtitled. 1920×1080, browser zoom 110 %, no notifications, demo site only (no real names, no bookmarks bar). Voice recorded separately and laid over the screen capture.

## Before recording

- Fresh demo load the same day (dates are relative to today).
- Analysis already run once, so the incident page exists; open these tabs in order:
  1. a real post-mortem page (write a plain one in ANTE for the opening shot — "Incident 2026-06-12 — Lot 2 outage", past tense)
  2. Antemortem → Overview
  3. the projected incident page in Confluence
  4. Jira issue list `labels = antemortem AND project = NFS`
  5. issue NFS-87
  6. Rovo chat with the Antemortem agent selected
- Cursor visible, slow movements, 1 s pause before each click.

## Shot list

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:18 | Tab 1: an ordinary post-mortem page, scrolling slowly past *Timeline* and *Root cause* | "Every organisation writes the same document after things go wrong. Timeline, root cause, corrective actions. It's the most honest document we produce — and it always comes too late. The facts were there weeks earlier. Nobody had connected them." |
| 0:18–0:30 | Cut to black; title card **Antemortem** with the tagline | "Antemortem writes your post-mortems before the incidents happen." |
| 0:30–0:55 | Tab 2: Overview. Hover the headline *Next post-mortem in 16 days*, then the O-3 row and its meter | "This is a field-service contract. Lot 3 must be restored within four hours in 95 % of cases, or the client takes 2 % of the monthly invoice. Today the rate is 93 %, trending to 83 %. Antemortem gives it an 80 % chance of breaching in 16 days. Forty thousand euros." |
| 0:55–1:35 | Click **Open post-mortem** → Tab 3. Scroll: banner, Impact, Root cause with its four bullets | "So it wrote the post-mortem. Dated the fourteenth. Same format you know. Read the root cause: it isn't a late ticket. It's a decision from September — keep lot 3 with the subcontractor — that rested on four assumptions. All four have quietly stopped being true." |
| 1:35–2:05 | Scroll to Timeline; click two evidence links (the blocked badges issue, the Helios reassignment) and come back | "Each line of the timeline is a fact that exists today, with its evidence one click away. The supplier amendment nobody touched for nine days. The only HV-qualified engineer reassigned last week while still holding four jobs. A dispatch ticket that contradicts the steering-committee decision. Jira knew each of these. Nothing knew them together." |
| 2:05–2:20 | Scroll to *How this forecast was computed* | "No language model, no black box. The probability is arithmetic you can check, and the cost is the contract's own formula." |
| 2:20–2:40 | Back to Overview, O-3 row: click **History** (the curve), then tick two what-if boxes on the chain | "Replay the period: the forecast crossed the line days before the breach. And what if we fixed two of these? Sixty percent. Still not enough — which tells you where to act." |
| 2:40–3:00 | Tab 4: the five corrective-action issues. Move two to Done (drag or transition). Back to Tab 2, **Run analysis now**, wait for the refresh | "The corrective actions are real Jira issues. Close two of them, run the analysis again —" |
| 3:00–3:15 | The incident card is gone; open **Averted**: *€40,000 of penalties that never happened*; click the page: the green banner | "— and the post-mortem archives itself. It joins the other ledger: the incidents that never happened, and what they would have cost." |
| 3:15–3:40 | Tab 5: issue NFS-87 with the Antemortem panel; Tab 6: the macro on the contract page; Tab 7: ask Rovo *"Why is O-3 at risk?"* | "It meets people where they work: on the issue, on the contract page, and in Rovo — the agent only ever answers from the engine's evidence." |
| 3:40–4:00 | Back to Overview, hold on the headline. End card: *Antemortem — Forge · Jira · Confluence · Rovo* | "Built on Forge, Jira, Confluence and Rovo. Antemortem: write the post-mortem first. Then make sure it's never needed." |
| 4:00–4:30 (optional) | Architecture slide: three primitives → detectors → explainable forecast → document lifecycle | For judges still watching: the model, the engine, the install link. |

## Lines to keep exactly (the pitch in three sentences)

1. *Every organisation writes the same document after things go wrong, and it always comes too late.*
2. *Antemortem writes it before — dated in the future, every line backed by evidence that exists today.*
3. *Close the actions, and the post-mortem archives itself: the incidents that never happened, and what they would have cost.*

## Do not

- Show any real company, client or person; the demo universe is fictional (Meridian, Nordlink, Boreal, Helios).
- Use music with rights; silence or a royalty-free bed.
- Let the browser show other tabs' titles or the site name if it contains your name (use the `antemortem-dev` site).
- Explain the install; that's in the written instructions.
