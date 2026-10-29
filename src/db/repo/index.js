/**
 * Repositories — one small module per table, all built on the same helpers.
 *
 * Column lists are explicit (never derived from user input) so that `insert`
 * and `updateById` only ever see trusted identifiers. Rows come back with
 * JSON columns parsed.
 */
import { query, queryOne, execute, insert, updateById, parseJson, toSqlDateTime } from '../client.js';

const JSON_COLUMNS = {
  contract: [],
  obligation: [],
  decision: ['decided_by', 'alternatives_rejected'],
  assumption: ['params', 'evidence'],
  link: [],
  availability: [],
  risk_signal: ['evidence'],
  forecast: ['chain', 'explanation'],
  future_incident: ['timeline', 'contributing_factors', 'actions'],
  action_item: ['prevents_signal_types'],
  analysis_run: ['summary'],
};

const COLUMNS = {
  contract: ['name', 'counterparty', 'start_date', 'end_date', 'currency', 'confluence_page_id', 'notes', 'is_demo'],
  obligation: [
    'contract_id', 'code', 'title', 'description', 'metric_type', 'jql_scope', 'sla_hours', 'threshold',
    'period', 'period_starts_on', 'period_ends_on', 'penalty_type', 'penalty_value', 'invoice_basis',
    'owner_account_id', 'status',
  ],
  decision: [
    'title', 'statement', 'rationale', 'decided_at', 'decided_by', 'source_type', 'source_id', 'source_url',
    'alternatives_rejected', 'status',
  ],
  assumption: ['decision_id', 'statement', 'kind', 'params', 'status', 'last_checked_at', 'evidence'],
  link: ['from_type', 'from_id', 'to_type', 'to_id', 'relation', 'origin', 'confidence'],
  availability: ['account_id', 'display_name', 'kind', 'starts_on', 'ends_on', 'note'],
  risk_signal: ['type', 'severity', 'subject_type', 'subject_id', 'fingerprint', 'detected_at', 'resolved_at', 'evidence'],
  forecast: ['obligation_id', 'projected_breach_date', 'probability', 'projected_cost', 'currency', 'chain', 'explanation', 'computed_at', 'superseded_by'],
  future_incident: [
    'forecast_id', 'obligation_id', 'title', 'incident_date', 'status', 'confluence_page_id', 'confluence_page_url',
    'version', 'summary', 'impact_statement', 'root_cause', 'timeline', 'contributing_factors', 'actions',
    'averted_at', 'cost_avoided', 'materialized_at', 'dismissed_reason',
  ],
  action_item: ['future_incident_id', 'title', 'description', 'issue_key', 'status', 'prevents_signal_types'],
  analysis_run: ['trigger_source', 'started_at', 'finished_at', 'status', 'summary', 'error'],
};

function pick(table, data) {
  const out = {};
  for (const c of COLUMNS[table]) if (data[c] !== undefined) out[c] = data[c];
  return out;
}

export function hydrate(table, row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLUMNS[table] ?? []) out[c] = parseJson(row[c], null);
  for (const k of Object.keys(out)) {
    // DECIMAL columns come back as strings — make numbers numbers.
    if (typeof out[k] === 'string' && /^-?\d+\.\d+$/.test(out[k])) out[k] = Number(out[k]);
  }
  return out;
}

export function makeRepo(table) {
  if (!COLUMNS[table]) throw new Error(`Unknown table ${table}`);
  return {
    table,
    async list({ where = '', params = [], orderBy = 'created_at DESC', limit = 500, includeArchived = false } = {}) {
      const clauses = [];
      if (!includeArchived) clauses.push('archived_at IS NULL');
      if (where) clauses.push(`(${where})`);
      const sql = `SELECT * FROM ${table}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT ${Number(limit)}`;
      return (await query(sql, params)).map((r) => hydrate(table, r));
    },
    async get(id) {
      return hydrate(table, await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [id]));
    },
    async create(data) {
      const id = await insert(table, { id: data.id, ...pick(table, data) });
      return this.get(id);
    },
    async update(id, patch) {
      await updateById(table, id, pick(table, patch));
      return this.get(id);
    },
    async archive(id) {
      return updateById(table, id, { archived_at: toSqlDateTime() });
    },
    async hardDelete(id) {
      return execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    },
    async deleteWhere(where, params = []) {
      return execute(`DELETE FROM ${table} WHERE ${where}`, params);
    },
  };
}

export const contracts = makeRepo('contract');
export const obligations = makeRepo('obligation');
export const decisions = makeRepo('decision');
export const assumptions = makeRepo('assumption');
export const links = makeRepo('link');
export const availability = makeRepo('availability');
export const signals = makeRepo('risk_signal');
export const forecasts = makeRepo('forecast');
export const futureIncidents = makeRepo('future_incident');
export const actionItems = makeRepo('action_item');
export const analysisRuns = makeRepo('analysis_run');

/** Decisions with their assumptions attached. */
export async function listDecisionsWithAssumptions(opts = {}) {
  const ds = await decisions.list(opts);
  if (!ds.length) return [];
  const all = await assumptions.list({ limit: 2000 });
  const byDecision = new Map();
  for (const a of all) {
    if (!byDecision.has(a.decision_id)) byDecision.set(a.decision_id, []);
    byDecision.get(a.decision_id).push(a);
  }
  return ds.map((d) => ({ ...d, assumptions: byDecision.get(d.id) ?? [] }));
}

/** Obligations with their contract name attached. */
export async function listObligationsWithContract(opts = {}) {
  const [os, cs] = await Promise.all([obligations.list(opts), contracts.list({ limit: 200 })]);
  const byId = new Map(cs.map((c) => [c.id, c]));
  return os.map((o) => ({ ...o, contract: byId.get(o.contract_id) ?? null }));
}

/** Upsert a link (the unique key makes duplicates a no-op). */
export async function linkObjects(from_type, from_id, relation, to_type, to_id, { origin = 'user', confidence = 1 } = {}) {
  const existing = await queryOne(
    'SELECT id FROM link WHERE from_type = ? AND from_id = ? AND relation = ? AND to_type = ? AND to_id = ?',
    [from_type, from_id, relation, to_type, to_id],
  );
  if (existing) return existing.id;
  return insert('link', { from_type, from_id, relation, to_type, to_id, origin, confidence });
}

export async function linksFrom(from_type, from_id, relation = null) {
  const params = [from_type, from_id];
  let sql = 'SELECT * FROM link WHERE archived_at IS NULL AND from_type = ? AND from_id = ?';
  if (relation) { sql += ' AND relation = ?'; params.push(relation); }
  return query(sql, params);
}

export async function linksTo(to_type, to_id, relation = null) {
  const params = [to_type, to_id];
  let sql = 'SELECT * FROM link WHERE archived_at IS NULL AND to_type = ? AND to_id = ?';
  if (relation) { sql += ' AND relation = ?'; params.push(relation); }
  return query(sql, params);
}
