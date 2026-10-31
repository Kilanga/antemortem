import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjects } from '../src/graph/connector.js';

const now = new Date('2026-11-28T15:00:00Z');
const repos = {
  contracts: { list: async () => [{ id: 'c1', name: 'Meridian — maintenance 2026', counterparty: 'Meridian', currency: 'EUR' }] },
  obligations: { list: async () => [{ id: 'o3', code: 'O-3', title: 'Restoration ≤ 4 h on 95 %', metric_type: 'ratio_within_sla', sla_hours: 4, threshold: 0.95, period: 'monthly', penalty_type: 'percent_of_invoice', penalty_value: 2, invoice_basis: 2000000, jql_scope: 'project = "NFS"', contract_id: 'c1', created_at: '2026-10-01 10:00:00', updated_at: '2026-10-02 10:00:00' }] },
  decisions: { list: async () => [{ id: 'd7', title: 'D-7 · Lot 3 stays with Boreal', statement: 'Keep lot 3 with Boreal.', rationale: 'Cost.', decided_at: '2026-09-19 14:00:00', status: 'contradicted', source_url: '/wiki/spaces/ANTE/pages/3', created_at: '2026-09-19 14:00:00', updated_at: '2026-09-19 14:00:00' }] },
  assumptions: { list: async () => [{ id: 'a1', decision_id: 'd7', statement: 'Boreal stays under 25 open issues.', kind: 'capacity', status: 'broken' }] },
  futureIncidents: { list: async () => [{ id: 'fi1', obligation_id: 'o3', title: 'Incident 2026-12-14 — Meridian, O-3 breach', incident_date: '2026-12-14', status: 'published', summary: 'Summary.', root_cause: 'The decision.', confluence_page_url: 'https://x.atlassian.net/wiki/spaces/ANTE/pages/9', actions: { probability: 0.8, cost: 40000, currency: 'EUR', items: [{ title: 'Triage', issue_key: 'NFS-91', status: 'open' }] }, created_at: '2026-11-28 09:00:00', updated_at: '2026-11-28 09:00:00' }] },
};

test('graph objects: one document per obligation, decision and incident, with the required fields', async () => {
  const objs = await buildObjects({ siteUrl: 'https://x.atlassian.net', now, repos });
  assert.equal(objs.length, 3);
  assert.deepEqual(objs.map((o) => o.id), ['obligation:o3', 'decision:d7', 'incident:fi1']);
  for (const o of objs) {
    assert.equal(o.schemaVersion, '1.0');
    assert.ok(o.displayName && o.url.startsWith('https://') && o.createdAt.endsWith('Z') && o.lastUpdatedAt.endsWith('Z'));
    assert.ok(o['atlassian:document'].content.text.length > 20);
    assert.deepEqual(o.permissions[0].accessControls[0].principals, [{ type: 'EVERYONE' }]);
  }
  const [obl, dec, inc] = objs;
  assert.match(obl['atlassian:document'].content.text, /95 % of issues resolved within 4 h/);
  assert.match(obl['atlassian:document'].content.text, /2 % of the invoice/);
  assert.match(obl.url, /jira\/issues\/\?jql=/);
  assert.equal(dec.url, 'https://x.atlassian.net/wiki/spaces/ANTE/pages/3');
  assert.match(dec['atlassian:document'].content.text, /\[broken\] Boreal stays under 25/);
  assert.ok(dec['atlassian:document'].labels.includes('contradicted'));
  assert.equal(inc.url, 'https://x.atlassian.net/wiki/spaces/ANTE/pages/9');
  assert.match(inc['atlassian:document'].content.text, /has not happened yet/);
  assert.equal(inc['atlassian:document'].type.category, 'PAGE');
});
