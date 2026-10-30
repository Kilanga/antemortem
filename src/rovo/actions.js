/**
 * Rovo actions — small, read-mostly functions the Antemortem agent (and any
 * customer-built agent, via read:chat:rovo) can call as tools.
 *
 * Each returns plain JSON the model can quote. Nothing here invents a figure:
 * every number comes from stored forecasts, signals and incidents that the
 * engine computed from evidence.
 */
import { query, parseJson } from '../db/client.js';
import { futureIncidents, obligations, decisions, assumptions, linkObjects, hydrate, listObligationsWithContract } from '../db/repo/index.js';
import { getSiteUrl } from '../engine/publish.js';
import { fmtMoney, longDate } from '../engine/narrative/index.js';

/** What is my next post-mortem? */
export async function getNextIncident() {
  const open = await futureIncidents.list({ where: "status IN ('draft','published')", orderBy: 'incident_date ASC', limit: 5 });
  if (!open.length) {
    const averted = await futureIncidents.list({ where: "status = 'averted'", orderBy: 'averted_at DESC', limit: 1 });
    return {
      nextIncident: null,
      message: 'No projected incident is currently published. Every active obligation holds, or its forecast is below the publish threshold.',
      lastAverted: averted[0] ? summarise(averted[0]) : null,
    };
  }
  const siteUrl = await getSiteUrl();
  return {
    nextIncident: summarise(open[0], siteUrl),
    others: open.slice(1).map((fi) => summarise(fi, siteUrl)),
    note: 'Dates are projections; the incident has not happened. Each page links to the evidence.',
  };
}

/** Why is obligation X at risk? */
export async function explainObligation(payload) {
  const code = String(payload?.obligationCode ?? '').trim().toUpperCase();
  if (!code) return { error: 'obligationCode is required (e.g. "O-3").' };
  const [o] = await obligations.list({ where: 'code = ?', params: [code], limit: 1 });
  if (!o) return { error: `No obligation with code ${code}.`, known: (await obligations.list({ limit: 50 })).map((x) => `${x.code} — ${x.title}`) };
  const [fc] = (await query('SELECT * FROM forecast WHERE obligation_id = ? AND superseded_by IS NULL ORDER BY computed_at DESC LIMIT 1', [o.id])).map((r) => hydrate('forecast', r));
  const chainFp = new Set((fc?.chain ?? []).map((e) => e.signalFingerprint).filter(Boolean));
  const signals = (await query('SELECT type, severity, subject_type, subject_id, fingerprint, evidence FROM risk_signal WHERE resolved_at IS NULL AND archived_at IS NULL'))
    .filter((s) => (s.subject_type === 'obligation' && s.subject_id === o.id) || chainFp.has(s.fingerprint))
    .map((s) => ({ type: s.type, severity: s.severity, evidence: parseJson(s.evidence) }));
  const deps = await query("SELECT to_id AS decision_id FROM link WHERE archived_at IS NULL AND from_type = 'obligation' AND from_id = ? AND relation = 'depends_on' AND to_type = 'decision'", [o.id]);
  const decs = [];
  for (const d of deps) {
    const dec = await decisions.get(d.decision_id);
    if (!dec) continue;
    const asm = await assumptions.list({ where: 'decision_id = ?', params: [dec.id] });
    decs.push({ title: dec.title, statement: dec.statement, status: dec.status, assumptions: asm.map((a) => ({ statement: a.statement, kind: a.kind, status: a.status })) });
  }
  const [incident] = await futureIncidents.list({ where: "obligation_id = ? AND status IN ('draft','published')", params: [o.id], limit: 1 });
  return {
    obligation: { code: o.code, title: o.title, metric: o.metric_type, threshold: o.threshold, slaHours: o.sla_hours, penalty: o.penalty_type === 'percent_of_invoice' ? `${o.penalty_value} % of ${fmtMoney(o.invoice_basis)}` : fmtMoney(o.penalty_value) },
    forecast: fc ? { probability: fc.probability, projectedBreachDate: fc.projected_breach_date, projectedCost: fc.projected_cost, currency: fc.currency, metric: fc.explanation?.metric, howComputed: fc.explanation?.steps } : null,
    signals,
    decisionsItDependsOn: decs,
    projectedIncident: incident ? summarise(incident, await getSiteUrl()) : null,
  };
}

/** Corrective actions and their status for the open incident(s). */
export async function listCorrectiveActions(payload) {
  const code = payload?.obligationCode ? String(payload.obligationCode).trim().toUpperCase() : null;
  let open = await futureIncidents.list({ where: "status IN ('draft','published')", orderBy: 'incident_date ASC', limit: 10 });
  if (code) {
    const [o] = await obligations.list({ where: 'code = ?', params: [code], limit: 1 });
    open = o ? open.filter((fi) => fi.obligation_id === o.id) : [];
  }
  return {
    incidents: open.map((fi) => ({ title: fi.title, incidentDate: fi.incident_date, page: fi.confluence_page_url, actions: (fi.actions?.items ?? []).map((a) => ({ title: a.title, issueKey: a.issue_key, status: a.status, url: a.url })) })),
    note: open.length ? 'Closing an action in Jira and running the analysis lowers the forecast; below the publish threshold the post-mortem archives itself as averted.' : 'No open projected incident.',
  };
}

/** Record a decision with its assumptions (free text; the engine monitors typed ones later). */
export async function recordDecision(payload) {
  const title = String(payload?.title ?? '').trim().slice(0, 255);
  const statement = String(payload?.statement ?? '').trim().slice(0, 4000);
  if (!title || !statement) return { error: 'title and statement are required.' };
  const rationale = payload?.rationale ? String(payload.rationale).trim().slice(0, 4000) : null;
  const assumptionsText = payload?.assumptions ? String(payload.assumptions) : '';
  const code = payload?.obligationCode ? String(payload.obligationCode).trim().toUpperCase() : null;

  const dec = await decisions.create({ title, statement, rationale, decided_at: new Date(), decided_by: [], source_type: 'manual', status: 'active', alternatives_rejected: [] });
  const lines = assumptionsText.split(/\n|;/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  for (const line of lines) {
    const a = await assumptions.create({ decision_id: dec.id, statement: line, kind: 'freeform', params: {}, status: 'holding' });
    await linkObjects('decision', dec.id, 'rests_on', 'assumption', a.id);
  }
  let linked = null;
  if (code) {
    const [o] = await obligations.list({ where: 'code = ?', params: [code], limit: 1 });
    if (o) { await linkObjects('obligation', o.id, 'depends_on', 'decision', dec.id); linked = o.code; }
  }
  return {
    recorded: { id: dec.id, title, assumptions: lines.length, supportsObligation: linked },
    note: 'Recorded as a decision with free-text assumptions. To have the engine monitor an assumption, edit it in Antemortem → Decisions and give it a type (capacity, person available, dependency done by, routing).',
  };
}

/** The obligations and their current state — for "how are we doing?" */
export async function listObligationStatus() {
  const obls = await listObligationsWithContract({ where: "status = 'active'", orderBy: 'code ASC' });
  const out = [];
  for (const o of obls) {
    const [fc] = (await query('SELECT * FROM forecast WHERE obligation_id = ? AND superseded_by IS NULL ORDER BY computed_at DESC LIMIT 1', [o.id])).map((r) => hydrate('forecast', r));
    out.push({ code: o.code, title: o.title, contract: o.contract?.name ?? null, probabilityOfBreach: fc?.probability ?? null, projectedBreachDate: fc?.projected_breach_date ?? null, projectedCost: fc?.projected_cost ?? null, metric: fc?.explanation?.metric ?? null });
  }
  return { obligations: out };
}

function summarise(fi, siteUrl = '') {
  return {
    title: fi.title,
    status: fi.status,
    incidentDate: fi.incident_date,
    incidentDateLong: longDate(fi.incident_date),
    probability: fi.actions?.probability ?? null,
    projectedCost: fi.actions?.cost != null ? fmtMoney(fi.actions.cost, fi.actions.currency) : null,
    summary: fi.summary,
    page: fi.confluence_page_url ?? null,
    correctiveActions: (fi.actions?.items ?? []).map((a) => `${a.status}: ${a.title}${a.issue_key ? ` (${a.issue_key})` : ''}`),
    costAvoided: fi.cost_avoided ?? null,
  };
}
