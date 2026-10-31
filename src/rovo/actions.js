/**
 * Rovo actions — small, read-mostly functions the Antemortem agent (and any
 * customer-built agent, via read:chat:rovo) can call as tools.
 *
 * Each returns plain JSON the model can quote. Nothing here invents a figure:
 * every number comes from stored forecasts, signals and incidents that the
 * engine computed from evidence.
 */
import { query, parseJson } from '../db/client.js';
import { futureIncidents, obligations, decisions, assumptions, availability, contracts, linkObjects, hydrate, listObligationsWithContract } from '../db/repo/index.js';
import { getPageAsUser } from '../confluence/client.js';
import { searchIssues, currentUserHasPermission } from '../jira/client.js';

/**
 * Writes from the agent are gated exactly like writes from the UI: the
 * calling user must be a Jira administrator. The agent's "ask the user to
 * confirm" is a convention, not a control; this is the control.
 */
async function requireAdmin() {
  let ok = false;
  try { ok = await currentUserHasPermission('ADMINISTER'); } catch { ok = false; }
  return ok ? null : { error: 'Only a Jira administrator can record this. Ask an admin, or use Antemortem in Jira (Apps → Antemortem).' };
}

/** Only https URLs are stored as sources (they end up in href attributes). */
export const httpsOnly = (v) => { const s = v ? String(v).trim().slice(0, 1024) : ''; return /^https:\/\//i.test(s) ? s : null; };
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
  const denied = await requireAdmin();
  if (denied) return denied;
  const title = String(payload?.title ?? '').trim().slice(0, 255);
  const statement = String(payload?.statement ?? '').trim().slice(0, 4000);
  if (!title || !statement) return { error: 'title and statement are required.' };
  const rationale = payload?.rationale ? String(payload.rationale).trim().slice(0, 4000) : null;
  const assumptionsText = payload?.assumptions ? String(payload.assumptions) : '';
  const code = payload?.obligationCode ? String(payload.obligationCode).trim().toUpperCase() : null;

  const sourceUrl = httpsOnly(payload?.sourceUrl);
  const decidedAt = payload?.decidedAt && !Number.isNaN(Date.parse(payload.decidedAt)) ? new Date(payload.decidedAt) : new Date();
  const dec = await decisions.create({ title, statement, rationale, decided_at: decidedAt, decided_by: [], source_type: sourceUrl ? 'confluence_page' : 'manual', source_url: sourceUrl, status: 'active', alternatives_rejected: [] });
  const lines = assumptionsText.split(/\n/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  let typed = 0;
  for (const line of lines) {
    const parsed = parseAssumptionLine(line);
    if (parsed.kind !== 'freeform') typed += 1;
    const a = await assumptions.create({ decision_id: dec.id, statement: parsed.statement, kind: parsed.kind, params: parsed.params, status: 'holding' });
    await linkObjects('decision', dec.id, 'rests_on', 'assumption', a.id);
  }
  let linked = null;
  if (code) {
    const [o] = await obligations.list({ where: 'code = ?', params: [code], limit: 1 });
    if (o) { await linkObjects('obligation', o.id, 'depends_on', 'decision', dec.id); linked = o.code; }
  }
  return {
    recorded: { id: dec.id, title, assumptions: lines.length, monitored: typed, supportsObligation: linked },
    note: typed === lines.length ? 'Every assumption is typed; the engine checks them at the next analysis.' : `${lines.length - typed} assumption(s) are free text and will not be monitored until given a type in Antemortem → Decisions.`,
  };
}

const KINDS = { capacity: ['teamRef', 'maxOpenIssues'], person_available: ['personRef', 'displayName', 'until'], dependency_done_by: ['issueKey', 'date'], routing: ['scopeJql', 'labelPrefix', 'expected'], obligation_holds: ['obligationId'], freeform: [] };

/** "statement :: kind :: key=value, key=value" → { statement, kind, params }. A bare line is freeform. */
export function parseAssumptionLine(line) {
  const parts = line.split('::').map((s) => s.trim());
  const statement = parts[0].slice(0, 1000);
  const kind = KINDS[parts[1]] ? parts[1] : 'freeform';
  const params = {};
  if (kind !== 'freeform' && parts[2]) {
    for (const kv of parts[2].split(',')) {
      const [k, ...rest] = kv.split('=');
      const key = k?.trim(); const value = rest.join('=').trim();
      if (key && KINDS[kind].includes(key) && value) params[key] = key === 'maxOpenIssues' ? Number(value) : value;
    }
  }
  return { statement, kind, params };
}

/**
 * The text of a Confluence page plus the references the agent may use to
 * type assumptions (people, vendors, obligations, open issues). The agent
 * proposes; the user confirms; only then does record-decision write.
 */
export async function readPageForDecision(payload) {
  const ref = String(payload?.page ?? '').trim();
  const id = ref.match(/\/pages\/(\d+)/)?.[1] ?? ref.match(/^(\d+)$/)?.[1] ?? null;
  if (!id) return { error: 'Give a Confluence page id or URL (…/pages/<id>/…).' };
  // Read as the calling user: the agent must not see what they cannot.
  let page;
  try { page = await getPageAsUser(id); } catch (err) { return { error: `Cannot read page ${id}: ${err?.message ?? err}` }; }
  if (!page) return { error: `Page ${id} does not exist or you do not have access to it.` };
  const text = page.body.replace(/<ac:structured-macro[\s\S]*?<\/ac:structured-macro>/g, ' ').replace(/<\/(p|li|tr|h\d)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 12000);
  const siteUrl = await getSiteUrl();
  const sourceUrl = page.webui ? `${siteUrl}/wiki${page.webui}` : null;

  const obls = await obligations.list({ where: "status = 'active'", limit: 100 });
  const people = await availability.list({ limit: 200 });
  const personRefs = [...new Map(people.map((p) => [p.account_id, p.display_name])).entries()].map(([personRef, displayName]) => ({ personRef, displayName }));
  let vendors = [];
  let openIssues = [];
  let projectKeys = [];
  try {
    const scopes = obls.map((o) => o.jql_scope).filter(Boolean);
    const projects = [...new Set(scopes.map((j) => j.match(/project\s*=\s*"?([A-Z][A-Z0-9_]*)"?/i)?.[1]).filter(Boolean))];
    projectKeys = projects;
    if (projects.length) {
      const issues = await searchIssues(`project in (${projects.map((p) => `"${p}"`).join(', ')}) AND statusCategory != Done ORDER BY updated DESC`, { fields: ["summary", "labels", "duedate"], maxTotal: 100, properties: [] });
      vendors = [...new Set(issues.flatMap((i) => (i.fields?.labels ?? []).filter((l) => l.startsWith('vendor-'))))];
      for (const i of issues) for (const l of i.fields?.labels ?? []) if (l.startsWith('tech-') && !personRefs.some((p) => p.personRef === `label:${l}`)) personRefs.push({ personRef: `label:${l}`, displayName: l.replace('tech-', '') });
      openIssues = issues.filter((i) => i.fields?.duedate || /badge|access|contract|amendment|deliver|supply|order/i.test(i.fields?.summary ?? '')).slice(0, 25).map((i) => ({ key: i.key, summary: i.fields?.summary, due: i.fields?.duedate ?? null }));
    }
  } catch { /* references are a convenience; the text is the point */ }

  return {
    page: { id: page.id, title: page.title, url: sourceUrl },
    text,
    references: { contracts: (await contracts.list({ limit: 50 })).map((c) => ({ name: c.name, counterparty: c.counterparty, currency: c.currency })), obligations: obls.map((o) => ({ code: o.code, title: o.title, scopeJql: o.jql_scope })), people: personRefs, vendors, openIssues, projects: projectKeys },
    howToRecordObligations: 'If the page is a contract or an SLA annex, propose one obligation per measurable clause: code, title, metric (ratio_within_sla with slaHours and threshold 0–1 | count_max or count_min with threshold | deadline), period (monthly, weekly, or custom with dates), penalty (fixed amount, or percent_of_invoice with the invoice basis), and a JQL scope built on a listed project key and the labels the page implies. Ask the user to confirm, then call record-obligation once per obligation.',
    howToRecord: 'Propose a title, the statement, the date decided, the obligation it supports and typed assumptions, then ask the user to confirm. Only after a clear yes call record-decision with sourceUrl, decidedAt and assumptions as lines "statement :: kind :: key=value, key=value". Kinds: capacity (teamRef, maxOpenIssues), person_available (personRef, displayName, until), dependency_done_by (issueKey, date), routing (scopeJql, labelPrefix=vendor-, expected). Use only references listed here; otherwise leave the assumption freeform.',
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

/**
 * Record one obligation proposed from a contract page, after the user
 * confirmed it. Creates the contract if the name is new.
 */
export async function recordObligation(payload) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const p = payload ?? {};
  const sourceUrl = httpsOnly(p.sourceUrl);
  const code = String(p.code ?? '').trim().toUpperCase().slice(0, 32);
  const title = String(p.title ?? '').trim().slice(0, 255);
  if (!code || !title) return { error: 'code and title are required.' };
  const metric = ['ratio_within_sla', 'jsm_sla', 'count_max', 'count_min', 'deadline'].includes(p.metricType) ? p.metricType : null;
  if (!metric) return { error: 'metricType must be ratio_within_sla, jsm_sla, count_max, count_min or deadline.' };
  const contractName = String(p.contractName ?? '').trim().slice(0, 255);
  if (!contractName) return { error: 'contractName is required.' };

  let [contract] = await contracts.list({ where: 'name = ?', params: [contractName], limit: 1 });
  if (!contract) contract = await contracts.create({ name: contractName, counterparty: p.counterparty ? String(p.counterparty).slice(0, 255) : null, currency: p.currency ? String(p.currency).slice(0, 3).toUpperCase() : 'EUR', notes: sourceUrl ? `Recorded from ${sourceUrl}` : null });

  const [dup] = await obligations.list({ where: 'code = ? AND contract_id = ?', params: [code, contract.id], limit: 1 });
  if (dup) return { error: `${code} already exists on this contract (${dup.title}).` };

  const jqlScope = p.jqlScope ? String(p.jqlScope).slice(0, 2000) : null;
  if (jqlScope) {
    const check = await validateJqlAsUser(jqlScope);
    if (check.error) return { error: `JQL scope rejected: ${check.error}` };
  }
  const threshold = p.threshold != null && p.threshold !== '' ? Number(p.threshold) : null;
  const row = {
    contract_id: contract.id, code, title,
    description: p.description ? String(p.description).slice(0, 4000) : (sourceUrl ? `Source: ${sourceUrl}` : null),
    metric_type: metric,
    jql_scope: jqlScope,
    sla_hours: p.slaHours != null && p.slaHours !== '' ? Number(p.slaHours) : null,
    sla_name: p.slaName ? String(p.slaName).slice(0, 255) : null,
    threshold: (metric === 'ratio_within_sla' || metric === 'jsm_sla') && threshold != null && threshold > 1 ? threshold / 100 : threshold,
    period: ['monthly', 'weekly', 'custom', 'one_shot'].includes(p.period) ? p.period : 'monthly',
    period_starts_on: p.periodStartsOn && !Number.isNaN(Date.parse(p.periodStartsOn)) ? String(p.periodStartsOn).slice(0, 10) : null,
    period_ends_on: p.periodEndsOn && !Number.isNaN(Date.parse(p.periodEndsOn)) ? String(p.periodEndsOn).slice(0, 10) : null,
    penalty_type: ['fixed', 'percent_of_invoice'].includes(p.penaltyType) ? p.penaltyType : null,
    penalty_value: p.penaltyValue != null && p.penaltyValue !== '' ? Number(p.penaltyValue) : null,
    invoice_basis: p.invoiceBasis != null && p.invoiceBasis !== '' ? Number(p.invoiceBasis) : null,
    status: 'active',
  };
  const saved = await obligations.create(row);
  return {
    recorded: { id: saved.id, code, title, contract: contract.name, metric, scopeJql: row.jql_scope },
    note: row.jql_scope ? 'The scope JQL can be tested in Antemortem → Obligations → Edit → Test JQL. The next analysis measures it.' : 'No JQL scope: give it one in Antemortem → Obligations before the engine can measure this obligation.',
  };
}

/** The JQL must parse and run for the calling user (asUser search): what they cannot see cannot become a scope. */
async function validateJqlAsUser(jql) {
  const { default: api, route } = await import('@forge/api');
  const res = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=1&fields=key`, { headers: { Accept: 'application/json' } });
  if (res.ok) return { ok: true };
  let msg = `HTTP ${res.status}`;
  try { const j = await res.json(); msg = (j.errorMessages ?? []).join(' ') || msg; } catch { /* keep */ }
  return { error: msg };
}
