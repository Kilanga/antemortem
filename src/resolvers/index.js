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
import { getSettings, saveSettings } from '../settings.js';
import { runAnalysis } from '../engine/index.js';
import { query } from '../db/client.js';
import { currentUserHasPermission, searchIssues } from '../jira/client.js';
import {
  contracts, obligations, decisions, assumptions, availability,
  listObligationsWithContract, listDecisionsWithAssumptions, linkObjects,
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
    const [schema, settings, demo] = await Promise.all([getSchemaStatus(), getSettings(), getProgress()]);
    let lastRun = null;
    if (schema.ok) {
      const rows = await query(
        'SELECT id, trigger_source, started_at, finished_at, status, summary, error FROM analysis_run ORDER BY started_at DESC LIMIT 1',
      );
      lastRun = rows[0] ?? null;
    }
    return {
      ok: true,
      app: { name: 'Antemortem', version: '0.2.0', week: 2 },
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

resolver.define('runAnalysisNow', admin(async () => ({ ok: true, ...(await runAnalysis({ source: 'manual' })) })));

resolver.define('getSettings', safe(async () => ({ ok: true, settings: await getSettings() })));
resolver.define('saveSettings', admin(async (req) => ({ ok: true, settings: await saveSettings(req.payload ?? {}) })));

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
