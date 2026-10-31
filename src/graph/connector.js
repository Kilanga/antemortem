/**
 * Outbound Teamwork Graph connector — Antemortem's own objects, published
 * into the graph so that Rovo Search, Rovo Chat and other apps can find
 * them: obligations (what the contract requires), decisions (what was
 * decided and what it rests on) and projected / averted incidents (the
 * post-mortems). The inbound side (reading the graph) is `GraphSource`.
 *
 * Objects are plain `atlassian:document`s with searchable text. Each one
 * links back to where it lives: the Confluence page for an incident, the
 * decision's source page, the JQL scope for an obligation.
 */
import { kvs } from '@forge/kvs';
import { graph } from '@forge/teamwork-graph';
import { contracts, obligations, decisions as decisionsRepo, assumptions as assumptionsRepo, futureIncidents } from '../db/repo/index.js';
import { getSiteUrl } from '../engine/publish.js';

const CONNECTION_KEY = 'twg.connectionId';
const SCHEMA = '1.0';
const BATCH = 100;

/** graph:connector datasource.onConnectionChange — the request object comes as the first argument. */
export async function onConnectionChange(request) {
  const { action, connectionId } = request ?? {};
  if (!connectionId) return { success: false, message: 'no connectionId' };
  if (action === 'DELETED') {
    // Atlassian drops the ingested objects itself; we forget the connection.
    await kvs.delete(CONNECTION_KEY);
    return { success: true };
  }
  await kvs.set(CONNECTION_KEY, connectionId);
  const summary = await syncGraph({ connectionId });
  console.log('[antemortem] graph connection', action, JSON.stringify(summary));
  return { success: true };
}

/** Publish the current model into the graph. No-op when no connection exists. */
export async function syncGraph({ connectionId = null, now = new Date() } = {}) {
  const id = connectionId ?? (await kvs.get(CONNECTION_KEY));
  if (!id) return { skipped: true };
  const siteUrl = await getSiteUrl();
  const objects = await buildObjects({ siteUrl, now });
  let accepted = 0; const rejected = [];
  for (let i = 0; i < objects.length; i += BATCH) {
    const res = await graph.setObjects({ connectionId: id, objects: objects.slice(i, i + BATCH) });
    accepted += res.results?.accepted?.length ?? 0;
    rejected.push(...(res.results?.rejected ?? []));
    if (!res.success) console.error('[antemortem] graph setObjects failed', res.error);
  }
  if (rejected.length) console.error('[antemortem] graph rejected objects', JSON.stringify(rejected).slice(0, 2000));
  return { objects: objects.length, accepted, rejected: rejected.length };
}

/** The model as documents: obligations, decisions (with assumptions), incidents. */
const defaultRepos = { contracts, obligations, decisions: decisionsRepo, assumptions: assumptionsRepo, futureIncidents };

export async function buildObjects({ siteUrl = '', now = new Date(), repos = defaultRepos } = {}) {
  const seq = Math.floor(now.getTime() / 1000);
  const everyone = [{ accessControls: [{ principals: [{ type: 'EVERYONE' }] }] }];
  const doc = ({ id, title, text, url, createdAt, updatedAt, labels, category = 'DOCUMENT' }) => ({
    schemaVersion: SCHEMA,
    id,
    updateSequenceNumber: seq,
    displayName: title.slice(0, 255),
    url,
    createdAt: iso(createdAt ?? now),
    lastUpdatedAt: iso(updatedAt ?? now),
    permissions: everyone,
    'atlassian:document': {
      type: { category, mimeType: 'text/markdown' },
      content: { mimeType: 'text/markdown', text: text.slice(0, 20_000) },
      labels,
    },
  });
  const base = siteUrl || 'https://atlassian.net';
  const out = [];

  const cs = await repos.contracts.list({ limit: 200 });
  const contractById = new Map(cs.map((c) => [c.id, c]));
  for (const o of await repos.obligations.list({ where: "status = 'active'", limit: 500 })) {
    const c = contractById.get(o.contract_id);
    out.push(doc({
      id: `obligation:${o.id}`,
      title: `${o.code} — ${o.title}`,
      text: [
        `Contractual obligation ${o.code}: ${o.title}.`,
        c ? `Contract: ${c.name}${c.counterparty ? ` (${c.counterparty})` : ''}.` : '',
        describeMetric(o),
        describePenalty(o, c),
        o.jql_scope ? `Scope (JQL): ${o.jql_scope}` : '',
        o.description ?? '',
      ].filter(Boolean).join('\n'),
      url: o.jql_scope ? `${base}/jira/issues/?jql=${encodeURIComponent(o.jql_scope)}` : base,
      createdAt: o.created_at, updatedAt: o.updated_at,
      labels: ['antemortem', 'obligation', o.code],
    }));
  }

  const allAssumptions = await repos.assumptions.list({ limit: 2000 });
  for (const d of await repos.decisions.list({ where: "status IN ('active','contradicted')", limit: 500 })) {
    const as = allAssumptions.filter((a) => a.decision_id === d.id);
    out.push(doc({
      id: `decision:${d.id}`,
      title: d.title,
      text: [
        `Decision: ${d.statement}`,
        d.rationale ? `Why: ${d.rationale}` : '',
        d.decided_at ? `Decided on ${String(d.decided_at).slice(0, 10)}.` : '',
        d.status === 'contradicted' ? 'Status: contradicted by recent work.' : '',
        as.length ? `Rests on ${as.length} assumption(s):` : 'No assumptions recorded.',
        ...as.map((a) => `- [${a.status}] ${a.statement} (${a.kind})`),
      ].filter(Boolean).join('\n'),
      url: d.source_url && /^https:\/\//.test(d.source_url) ? d.source_url : d.source_url ? `${base}${d.source_url}` : base,
      createdAt: d.created_at, updatedAt: d.updated_at,
      labels: ['antemortem', 'decision', ...(d.status === 'contradicted' ? ['contradicted'] : [])],
    }));
  }

  const oblById = new Map((await repos.obligations.list({ limit: 500, includeArchived: true })).map((o) => [o.id, o]));
  for (const fi of await repos.futureIncidents.list({ where: "status IN ('published','averted','materialized')", limit: 200 })) {
    const o = oblById.get(fi.obligation_id);
    const a = fi.actions ?? {};
    const status = fi.status === 'averted' ? `Averted on ${String(fi.averted_at).slice(0, 10)}; ${fmtMoney(fi.cost_avoided, a.currency)} avoided.` : fi.status === 'materialized' ? 'The projected breach occurred.' : `Projected: probability ${Math.round((a.probability ?? 0) * 100)} %, penalty ${fmtMoney(a.cost, a.currency)}. This incident has not happened yet.`;
    out.push(doc({
      id: `incident:${fi.id}`,
      title: fi.title,
      text: [
        `${fi.status === 'averted' ? 'Averted incident' : 'Projected incident'} for ${o ? `${o.code} (${o.title})` : 'an obligation'}, dated ${String(fi.incident_date).slice(0, 10)}.`,
        status,
        fi.summary ?? '',
        fi.root_cause ?? '',
        (a.items ?? []).length ? 'Corrective actions:' : '',
        ...(a.items ?? []).map((i) => `- [${i.status}] ${i.title}${i.issue_key ? ` (${i.issue_key})` : ''}`),
      ].filter(Boolean).join('\n'),
      url: fi.confluence_page_url ?? base,
      createdAt: fi.created_at, updatedAt: fi.updated_at,
      labels: ['antemortem', 'post-mortem', fi.status, ...(o ? [o.code] : [])],
      category: 'PAGE',
    }));
  }
  return out;
}

function describeMetric(o) {
  switch (o.metric_type) {
    case 'ratio_within_sla': return `Measure: ${Math.round(Number(o.threshold) * 100)} % of issues resolved within ${o.sla_hours} h over the ${o.period} period.`;
    case 'jsm_sla': return `Measure: ${Math.round(Number(o.threshold) * 100)} % of requests meeting the "${o.sla_name}" SLA over the ${o.period} period.`;
    case 'count_max': return `Measure: at most ${o.threshold} matching issues per ${o.period} period.`;
    case 'count_min': return `Measure: at least ${o.threshold} matching issues per ${o.period} period.`;
    case 'deadline': return 'Measure: the scoped deliverable is done by its due date.';
    default: return '';
  }
}
function describePenalty(o, c) {
  if (o.penalty_type === 'fixed') return `Penalty: ${fmtMoney(o.penalty_value, c?.currency)} per period in breach.`;
  if (o.penalty_type === 'percent_of_invoice') return `Penalty: ${o.penalty_value} % of the invoice${o.invoice_basis ? ` (${fmtMoney(o.invoice_basis, c?.currency)})` : ''}.`;
  return '';
}
const fmtMoney = (n, c = 'EUR') => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c || 'EUR', maximumFractionDigits: 0 }).format(Number(n ?? 0)); } catch { return `${n} ${c}`; } };
const iso = (v) => (v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (String(v).length === 19 ? 'Z' : ''))).toISOString();
