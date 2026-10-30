/**
 * Custom UI resolvers — the only backend surface the React app talks to.
 *
 * Conventions:
 *  - One resolver per screen action, named `verbNoun`.
 *  - Every resolver returns a plain JSON object; errors are returned as
 *    { ok: false, error } rather than thrown so the UI can render them.
 *  - Writes go through `admin()` which checks the caller holds Jira's
 *    ADMINISTER permission (evaluated asUser, so Jira decides, not us).
 */
import Resolver from '@forge/resolver';
import { getSchemaStatus, runMigrations } from '../db/migrate.js';
import { getSettings, saveSettings, ensureWebtriggerToken } from '../settings.js';
import { webTrigger } from '@forge/api';
import { dismissIncident } from '../engine/publish.js';
import { simulateObligation, backtest } from '../engine/simulate.js';
import { actionsSummary } from '../engine/index.js';
import { graphSourceFor } from '../graph/index.js';
import { periodWindow } from '../engine/metrics.js';
import { query, parseJson } from '../db/client.js';
import { currentUserHasPermission, searchIssues } from '../jira/client.js';
import {
  contracts, obligations, decisions, assumptions, availability, futureIncidents,
  listObligationsWithContract, listDecisionsWithAssumptions, linkObjects, hydrate,
} from '../db/repo/index.js';
import { getProgress } from '../demo/seed.js';
import { jobsQueue } from '../demo/consumer.js';

const resolver = new Resolver();

const safe = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (err) {
    console.error('[antemortem] resolver error', err);
    return { ok: false, error: String(err?.message ?? err) };
  }
};

const admin = (fn) => safe(async (req) => {
  if (!(await currentUserHasPermission('ADMINISTER'))) {
    return { ok: false, error: 'This action requires Jira administrator permission.' };
  }
  return fn(req);
});

// ---------------------------------------------------------------------------
// Overview / health
// ---------------------------------------------------------------------------

resolver.define(
  'getOverview',
  safe(async (req) => {
    const [schema, settingsFull, demo] = await Promise.all([getSchemaStatus(), getSettings(), getProgress()]);
    const { webtriggerToken, ...settings } = settingsFull;
    let lastRun = null;
    if (schema.ok) {
      const rows = await query(
        'SELECT id, trigger_source, started_at, finished_at, status, summary, error FROM analysis_run ORDER BY started_at DESC LIMIT 1',
      );
      lastRun = rows[0] ?? null;
    }
    return {
      ok: true,
      app: { name: 'Antemortem', version: '0.8.0', week: 7 },
      user: { accountId: req.context?.accountId ?? null },
      site: { cloudId: req.context?.cloudId ?? null, siteUrl: req.context?.siteUrl ?? null },
      schema,
      settings,
      demo,
      lastRun,
      counts: schema.ok ? Object.fromEntries(schema.tables.map((t) => [t.table, t.rows])) : {},
    };
  }),
);

resolver.define('repairDatabase', admin(async () => {
  const result = await runMigrations({ deadlineMs: 20_000 });
  const schema = await getSchemaStatus();
  return { ok: result.ok && schema.ok, result, schema };
}));

resolver.define('runAnalysisNow', admin(async () => {
  const [running] = await query("SELECT id FROM analysis_run WHERE status = 'running' AND started_at > DATE_SUB(NOW(), INTERVAL 20 MINUTE) LIMIT 1");
  if (running) return { ok: false, error: 'An analysis is already running.' };
  await jobsQueue.push({ body: { job: 'run-analysis', source: 'manual' } });
  return { ok: true, queued: true };
}));

/** Latest analysis run — polled by the UI after "Run analysis now". */
resolver.define('getLastRun', safe(async () => {
  const rows = await query('SELECT id, trigger_source, started_at, finished_at, status, summary, error FROM analysis_run ORDER BY started_at DESC LIMIT 1');
  return { ok: true, lastRun: rows[0] ?? null };
}));

const publicSettings = ({ webtriggerToken, ...rest }) => rest;
resolver.define('getSettings', safe(async () => ({ ok: true, settings: publicSettings(await getSettings()) })));
resolver.define('saveSettings', admin(async (req) => {
  const { webtriggerToken, ...patch } = req.payload ?? {};
  return { ok: true, settings: publicSettings(await saveSettings(patch)) };
}));

// ---------------------------------------------------------------------------
// Demo scenario (async job + polling)
// ---------------------------------------------------------------------------

resolver.define('loadDemo', admin(async (req) => {
  const progress = await getProgress();
  if (progress.status === 'running' || progress.status === 'resetting') return { ok: false, error: 'A demo job is already running.' };
  await jobsQueue.push({ body: { job: 'load-demo', leadAccountId: req.context?.accountId ?? null } });
  return { ok: true, queued: true };
}));

resolver.define('resetDemo', admin(async () => {
  const progress = await getProgress();
  if (progress.status === 'running' || progress.status === 'resetting') return { ok: false, error: 'A demo job is already running.' };
  await jobsQueue.push({ body: { job: 'reset-demo' } });
  return { ok: true, queued: true };
}));

/** Webtrigger URL + token for scripted runs (admin only; shown in Settings). */
resolver.define('getWebtrigger', admin(async () => {
  const token = await ensureWebtriggerToken();
  let url = null;
  try { url = await webTrigger.getUrl('antemortem-run-analysis'); } catch (err) { return { ok: false, error: String(err?.message ?? err) }; }
  return { ok: true, url, token, example: `curl -X POST -H "X-Antemortem-Token: ${token}" "${url}"` };
}));

resolver.define('getDemoProgress', safe(async () => ({ ok: true, progress: await getProgress() })));

// ---------------------------------------------------------------------------
// Model: contracts & obligations
// ---------------------------------------------------------------------------

resolver.define('listContracts', safe(async () => ({ ok: true, contracts: await contracts.list({ orderBy: 'name ASC' }) })));

resolver.define('listObligations', safe(async () => ({ ok: true, obligations: await listObligationsWithContract({ orderBy: 'code ASC' }) })));

resolver.define('saveContract', admin(async (req) => {
  const p = req.payload ?? {};
  const row = { name: str(p.name, 255), counterparty: str(p.counterparty, 255), start_date: dateOrNull(p.start_date), end_date: dateOrNull(p.end_date), currency: /^[A-Z]{3}$/.test(p.currency ?? '') ? p.currency : 'EUR', notes: str(p.notes, 4000) };
  if (!row.name) return { ok: false, error: 'Name is required.' };
  const saved = p.id ? await contracts.update(p.id, row) : await contracts.create(row);
  return { ok: true, contract: saved };
}));

resolver.define('saveObligation', admin(async (req) => {
  const p = req.payload ?? {};
  const row = {
    contract_id: str(p.contract_id, 36),
    code: str(p.code, 32),
    title: str(p.title, 255),
    description: str(p.description, 4000),
    metric_type: ['ratio_within_sla', 'count_max', 'count_min', 'deadline', 'custom'].includes(p.metric_type) ? p.metric_type : 'custom',
    jql_scope: str(p.jql_scope, 2000),
    sla_hours: num(p.sla_hours),
    threshold: num(p.threshold),
    period: ['monthly', 'weekly', 'one_shot', 'custom'].includes(p.period) ? p.period : 'monthly',
    period_starts_on: dateOrNull(p.period_starts_on),
    period_ends_on: dateOrNull(p.period_ends_on),
    penalty_type: ['fixed', 'percent_of_invoice'].includes(p.penalty_type) ? p.penalty_type : null,
    penalty_value: num(p.penalty_value),
    invoice_basis: num(p.invoice_basis),
    status: ['active', 'suspended'].includes(p.status) ? p.status : 'active',
  };
  if (!row.contract_id || !row.code || !row.title) return { ok: false, error: 'Contract, code and title are required.' };
  const saved = p.id ? await obligations.update(p.id, row) : await obligations.create(row);
  return { ok: true, obligation: saved };
}));

resolver.define('archiveObligation', admin(async (req) => ({ ok: true, archived: await obligations.archive(str(req.payload?.id, 36)) })));

/** Live JQL check for the obligation editor: how many issues, how many resolved. */
resolver.define('testJql', admin(async (req) => {
  const jql = str(req.payload?.jql, 2000);
  if (!jql) return { ok: false, error: 'Empty JQL.' };
  const issues = await searchIssues(jql, { fields: ['status'], maxTotal: 500 });
  const done = issues.filter((i) => i.fields?.status?.statusCategory?.key === 'done').length;
  return { ok: true, total: issues.length, done, open: issues.length - done, capped: issues.length >= 500 };
}));

// ---------------------------------------------------------------------------
// Model: decisions & assumptions
// ---------------------------------------------------------------------------

resolver.define('listDecisions', safe(async () => {
  const list = await listDecisionsWithAssumptions({ orderBy: 'decided_at DESC' });
  // Attach the obligations each decision supports.
  const links = await query("SELECT from_id AS obligation_id, to_id AS decision_id FROM link WHERE archived_at IS NULL AND from_type = 'obligation' AND relation = 'depends_on' AND to_type = 'decision'");
  const obls = await obligations.list({ limit: 500 });
  const codeById = new Map(obls.map((o) => [o.id, o.code]));
  for (const d of list) d.supports = links.filter((l) => l.decision_id === d.id).map((l) => ({ id: l.obligation_id, code: codeById.get(l.obligation_id) ?? '?' }));
  return { ok: true, decisions: list };
}));

const ASSUMPTION_KINDS = ['person_available', 'capacity', 'dependency_done_by', 'obligation_holds', 'routing', 'freeform'];

resolver.define('saveDecision', admin(async (req) => {
  const p = req.payload ?? {};
  const row = {
    title: str(p.title, 255),
    statement: str(p.statement, 4000),
    rationale: str(p.rationale, 4000),
    decided_at: dateTimeOrNull(p.decided_at),
    decided_by: Array.isArray(p.decided_by) ? p.decided_by.slice(0, 20).map((x) => str(x, 128)) : [],
    source_type: ['jira_issue', 'confluence_page', 'manual'].includes(p.source_type) ? p.source_type : 'manual',
    source_id: str(p.source_id, 128),
    source_url: str(p.source_url, 1024),
    alternatives_rejected: Array.isArray(p.alternatives_rejected) ? p.alternatives_rejected.slice(0, 20).map((a) => ({ label: str(a.label, 255), reason: str(a.reason, 1000) })) : [],
    status: ['active', 'superseded', 'contradicted', 'retired'].includes(p.status) ? p.status : 'active',
  };
  if (!row.title || !row.statement) return { ok: false, error: 'Title and statement are required.' };
  const saved = p.id ? await decisions.update(p.id, row) : await decisions.create(row);

  // Assumptions: full replace of the provided list (small, user-edited).
  if (Array.isArray(p.assumptions)) {
    const existing = await assumptions.list({ where: 'decision_id = ?', params: [saved.id] });
    const keep = new Set();
    for (const a of p.assumptions.slice(0, 20)) {
      const arow = {
        decision_id: saved.id,
        statement: str(a.statement, 1000),
        kind: ASSUMPTION_KINDS.includes(a.kind) ? a.kind : 'freeform',
        params: typeof a.params === 'object' && a.params ? a.params : {},
      };
      if (!arow.statement) continue;
      const savedA = a.id && existing.find((e) => e.id === a.id) ? await assumptions.update(a.id, arow) : await assumptions.create({ ...arow, status: 'holding' });
      keep.add(savedA.id);
      await linkObjects('decision', saved.id, 'rests_on', 'assumption', savedA.id);
    }
    for (const e of existing) if (!keep.has(e.id)) await assumptions.archive(e.id);
  }

  // Obligations this decision supports.
  if (Array.isArray(p.supports)) {
    for (const oid of p.supports.slice(0, 20)) await linkObjects('obligation', str(oid, 36), 'depends_on', 'decision', saved.id);
  }
  return { ok: true, decision: saved };
}));

resolver.define('archiveDecision', admin(async (req) => ({ ok: true, archived: await decisions.archive(str(req.payload?.id, 36)) })));

/** Latest forecast per active obligation, with open signals — the Overview's main list. */
resolver.define('listForecasts', safe(async () => {
  const obls = await listObligationsWithContract({ where: "status = 'active'", orderBy: 'code ASC' });
  const rows = await query('SELECT * FROM forecast WHERE superseded_by IS NULL AND archived_at IS NULL ORDER BY computed_at DESC LIMIT 500');
  const latest = new Map();
  for (const r of rows) {
    if (latest.has(r.obligation_id)) continue;
    const f = hydrate('forecast', r);
    // `healthy` is derived, not stored: no scoring step means nothing was found.
    f.healthy = !(f.explanation?.steps?.length) && Number(f.probability) <= 0.05;
    latest.set(r.obligation_id, f);
  }
  const openSignals = await query('SELECT type, severity, subject_type, subject_id, fingerprint, detected_at, evidence FROM risk_signal WHERE resolved_at IS NULL AND archived_at IS NULL ORDER BY severity DESC LIMIT 500');
  const out = obls.map((o) => {
    const f = latest.get(o.id) ?? null;
    const chainFingerprints = new Set((f?.chain ?? []).map((e) => e.signalFingerprint).filter(Boolean));
    const signals = openSignals
      .filter((s) => (s.subject_type === 'obligation' && s.subject_id === o.id) || chainFingerprints.has(s.fingerprint))
      .map((s) => ({ ...s, evidence: parseJson(s.evidence) }));
    return { obligation: o, forecast: f, signals };
  });
  return { ok: true, forecasts: out };
}));

// ---------------------------------------------------------------------------
// Simulation (read-only): what-if and backtest
// ---------------------------------------------------------------------------
async function modelFor(obligationId) {
  const obligation = await obligations.get(obligationId);
  if (!obligation) throw new Error('obligation not found');
  const links = await query("SELECT to_id FROM link WHERE archived_at IS NULL AND from_type = 'obligation' AND from_id = ? AND relation = 'depends_on' AND to_type = 'decision'", [obligationId]);
  const ids = links.map((l) => l.to_id);
  const all = ids.length ? await listDecisionsWithAssumptions({ where: "status IN ('active','contradicted')", limit: 500 }) : [];
  return { obligation, decisions: all.filter((d) => ids.includes(d.id)) };
}

resolver.define('whatIf', safe(async (req) => {
  const { obligation, decisions: ds } = await modelFor(str(req.payload?.obligationId, 36));
  const ignore = Array.isArray(req.payload?.ignore) ? req.payload.ignore.map((x) => str(x, 200)).slice(0, 50) : [];
  const onTime = Boolean(req.payload?.onTime);
  const graph = graphSourceFor(await getSettings());
  const actions = await actionsSummary(obligation.id);
  const r = await simulateObligation({ obligation, decisions: ds, graph, whatIf: { ignore, onTime }, actions });
  return { ok: true, forecast: { ...r.forecast, chain: r.chain }, metric: { kind: r.metric.kind, current: r.metric.current, projected: r.metric.projected, threshold: r.metric.threshold } };
}));

resolver.define('backtest', safe(async (req) => {
  const { obligation, decisions: ds } = await modelFor(str(req.payload?.obligationId, 36));
  const settings = await getSettings();
  const graph = graphSourceFor(settings);
  const now = new Date();
  const win = periodWindow(obligation, now);
  const days = Math.min(60, Math.max(7, Math.ceil((now - win.start) / 86400_000)));
  const stepDays = days > 30 ? 5 : days > 14 ? 3 : 2;
  const b = await backtest({ obligation, decisions: ds, graph, now, days, stepDays, threshold: Number(settings.publishThreshold ?? 0.6) });
  return { ok: true, ...b, periodStart: win.start.toISOString().slice(0, 10) };
}));

// ---------------------------------------------------------------------------
// Future incidents
// ---------------------------------------------------------------------------

resolver.define('listIncidents', safe(async () => {
  const open = await futureIncidents.list({ where: "status IN ('draft','published')", orderBy: 'incident_date ASC', limit: 50 });
  const averted = await futureIncidents.list({ where: "status IN ('averted','materialized','dismissed')", orderBy: 'updated_at DESC', limit: 100 });
  const obls = await obligations.list({ limit: 500, includeArchived: true });
  const codeById = new Map(obls.map((o) => [o.id, { code: o.code, title: o.title }]));
  const decorate = (fi) => ({ ...fi, obligation: codeById.get(fi.obligation_id) ?? null });
  return { ok: true, open: open.map(decorate), averted: averted.map(decorate), costAvoided: averted.filter((f) => f.status === 'averted').reduce((n, f) => n + Number(f.cost_avoided ?? 0), 0) };
}));

/** One block for the Confluence macro: open incidents and at-risk obligations. */
resolver.define('getMacroSummary', safe(async () => {
  const open = await futureIncidents.list({ where: "status IN ('draft','published')", orderBy: 'incident_date ASC', limit: 20 });
  const rows = await query('SELECT * FROM forecast WHERE superseded_by IS NULL AND archived_at IS NULL ORDER BY computed_at DESC LIMIT 500');
  const obls = await obligations.list({ where: "status = 'active'", limit: 500 });
  const latest = new Map();
  for (const r of rows) if (!latest.has(r.obligation_id)) latest.set(r.obligation_id, hydrate('forecast', r));
  const atRisk = obls.map((o) => ({ o, f: latest.get(o.id) })).filter(({ f }) => f && Number(f.probability) > 0.05 && f.explanation?.steps?.length)
    .map(({ o, f }) => ({ id: o.id, code: o.code, title: o.title, probability: Number(f.probability), cost: Number(f.projected_cost ?? 0), currency: f.currency }))
    .sort((a, b) => b.probability - a.probability);
  const incidents = open.map((fi) => {
    const a = fi.actions ?? {};
    const f = latest.get(fi.obligation_id);
    return { id: fi.id, obligationId: fi.obligation_id, title: fi.title, incidentDate: String(fi.incident_date).slice(0, 10), probability: Number(f?.probability ?? a.probability ?? 0), cost: Number(f?.projected_cost ?? a.cost ?? 0), currency: a.currency ?? f?.currency ?? 'EUR', url: fi.confluence_page_url ?? null };
  });
  const totalCost = incidents.reduce((n, fi) => n + fi.cost, 0);
  return { ok: true, incidents, atRisk, totalCost, currency: incidents[0]?.currency ?? atRisk[0]?.currency ?? 'EUR', commandCenterUrl: null };
}));

resolver.define('dismissIncident', admin(async (req) => {
  const id = str(req.payload?.id, 36);
  const reason = str(req.payload?.reason, 1000);
  if (!id) return { ok: false, error: 'Missing id.' };
  const fi = await dismissIncident(id, reason);
  return fi ? { ok: true, incident: fi } : { ok: false, error: 'Not found.' };
}));

// ---------------------------------------------------------------------------
// Issue context panel
// ---------------------------------------------------------------------------

resolver.define('getIssueContext', safe(async (req) => {
  const issueKey = str(req.payload?.issueKey ?? req.context?.extension?.issue?.key, 32);
  if (!issueKey || !/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) return { ok: false, error: 'No issue key.' };
  const siteUrl = req.context?.siteUrl ?? '';

  // Obligations whose scope contains this issue (one cheap JQL per obligation).
  const obls = await obligations.list({ where: "status = 'active' AND jql_scope IS NOT NULL", limit: 50 });
  const feeds = [];
  for (const o of obls) {
    try {
      const hits = await searchIssues(`key = ${issueKey} AND (${o.jql_scope})`, { fields: ['status'], maxTotal: 1 });
      if (hits.length) feeds.push(o);
    } catch { /* invalid JQL on this obligation: skip */ }
  }
  const latestForecast = async (oid) => (await query('SELECT probability, projected_breach_date FROM forecast WHERE obligation_id = ? AND superseded_by IS NULL ORDER BY computed_at DESC LIMIT 1', [oid]))[0] ?? null;
  const obligationsOut = [];
  for (const o of feeds) {
    const f = await latestForecast(o.id);
    obligationsOut.push({ id: o.id, code: o.code, title: o.title, probability: f ? Number(f.probability) : null, breachDate: f?.projected_breach_date ? String(f.projected_breach_date).slice(0, 10) : null });
  }

  // Assumptions whose params mention the issue, with their decision.
  const asmRows = await query("SELECT a.id, a.statement, a.status, d.title AS decision_title, d.id AS decision_id FROM assumption a JOIN decision d ON d.id = a.decision_id WHERE a.archived_at IS NULL AND JSON_SEARCH(a.params, 'one', ?) IS NOT NULL", [issueKey]);
  const assumptionsOut = asmRows.map((r) => ({ id: r.id, statement: r.statement, status: r.status, decisionTitle: r.decision_title }));

  // Decisions contradicted by this issue (routing signals name it in evidence).
  const sigRows = await query("SELECT subject_id FROM risk_signal WHERE type = 'decision_contradicted' AND resolved_at IS NULL AND JSON_SEARCH(evidence, 'one', ?) IS NOT NULL", [issueKey]);
  const decisionsOut = [];
  for (const r of sigRows) {
    const d = await decisions.get(r.subject_id);
    if (d) decisionsOut.push({ id: d.id, title: d.title, status: d.status });
  }

  // Projected incidents that mention the issue (timeline evidence or corrective action).
  const open = await futureIncidents.list({ where: "status IN ('draft','published')", limit: 20 });
  const incidentsOut = [];
  for (const fi of open) {
    const asAction = (fi.actions?.items ?? []).find((a) => a.issue_key === issueKey);
    const inTimeline = JSON.stringify(fi.timeline ?? []).includes(issueKey);
    if (asAction || inTimeline) incidentsOut.push({ id: fi.id, title: fi.title, url: fi.confluence_page_url, incidentDate: String(fi.incident_date).slice(0, 10), probability: fi.actions?.probability ?? null, cost: fi.actions?.cost != null ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: fi.actions.currency ?? 'EUR', maximumFractionDigits: 0 }).format(fi.actions.cost) : '', role: asAction ? 'action' : 'evidence' });
  }
  return { ok: true, issueKey, obligations: obligationsOut, assumptions: assumptionsOut, decisions: decisionsOut, incidents: incidentsOut, siteUrl };
}));

resolver.define('listAvailability', safe(async () => ({ ok: true, availability: await availability.list({ orderBy: 'starts_on DESC' }) })));

// ---------------------------------------------------------------------------

function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function dateOrNull(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function dateTimeOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const handler = resolver.getDefinitions();
