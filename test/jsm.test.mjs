import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphSource } from '../src/graph/GraphSource.js';
import { analyseObligation } from '../src/engine/analyse.js';

const now = new Date('2026-11-28T15:00:00Z');
const H = 3600_000;
const mk = (key, sla, startedHoursAgo = 20) => ({ key, summary: key, status: { name: sla.completed ? 'Done' : 'Open', category: sla.completed ? 'done' : 'indeterminate' }, labels: ['request'], people: [], vendor: null, startedAt: new Date(now - startedHoursAgo * H), dueAt: null, resolvedAt: sla.completed ? new Date(now - 1 * H) : null, lastActivityAt: now, blockedBy: [], blocks: [], sla });
const issues = [
  ...Array.from({ length: 18 }, (_, i) => mk(`SD-${i + 1}`, { completed: true, everBreached: false })),
  mk('SD-19', { completed: true, everBreached: true }),
  mk('SD-20', { completed: true, everBreached: true }),
  mk('SD-21', { running: true, breached: false, remainingMs: 30 * 60_000 }),
  mk('SD-22', { running: true, breached: true, remainingMs: -2 * H }),
  mk('SD-23', { running: true, breached: false, remainingMs: 5 * H }),
];
const graph = new (class extends GraphSource {
  async issuesInScope(jql) {
    const inner = jql.replace(/^\(.*?\) AND /, '');
    if (/= completed\(\)/.test(inner)) return issues.filter((i) => i.sla.completed);
    if (/= everBreached\(\)/.test(inner)) return issues.filter((i) => i.sla.everBreached);
    if (/= running\(\)/.test(inner)) return issues.filter((i) => i.sla.running);
    if (/= breached\(\)/.test(inner)) return issues.filter((i) => i.sla.breached);
    if (/< remaining\("(\d+)h"\)/.test(inner)) { const h = Number(inner.match(/remaining\("(\d+)h"\)/)[1]); return issues.filter((i) => i.sla.running && i.sla.remainingMs < h * H); }
    return issues.map(({ sla, ...rest }) => rest); // the plain scope: no SLA annotations
  }
})();

const obligation = { id: 'obl-jsm', code: 'J-1', title: '95 % within Time to resolution', metric_type: 'jsm_sla', sla_name: 'Time to resolution', sla_hours: 8, threshold: 0.95, jql_scope: 'project = "SD"', period: 'custom', period_starts_on: '2026-11-01', period_ends_on: '2026-11-30' };

test('jsm_sla: counts from the JQL SLA functions, projects the running ones', async () => {
  const r = await analyseObligation({ obligation, decisions: [], graph, now });
  assert.equal(r.metric.kind, 'jsm_sla');
  assert.equal(r.metric.detail.resolved, 20);
  assert.equal(r.metric.detail.within, 18);
  assert.equal(r.metric.current, 0.9);
  assert.deepEqual(r.metric.detail.openPastSla, ['SD-22']);
  assert.deepEqual(r.metric.detail.openNearSla, ['SD-21']);
  assert.equal(r.metric.projected, 0.87); // (18 + 2 running not breached) / 23
  assert.ok(!r.metric.projectedHolds);
  assert.equal(r.directSignals[0]?.type, 'obligation_trend');
});
