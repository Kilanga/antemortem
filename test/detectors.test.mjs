import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStaleCriticalIssues, detectSinglePointOfFailure, detectObligationTrend, checkAssumption } from '../src/engine/signals/index.js';
import { computeMetric } from '../src/engine/metrics.js';
import { computeForecast } from '../src/engine/forecast.js';
import { GraphSource } from '../src/graph/GraphSource.js';

const now = new Date('2026-11-28T15:00:00Z');
const H = 3600_000; const D = 24 * H;
const obl = { id: 'obl-1', code: 'O-1', metric_type: 'ratio_within_sla', sla_hours: 4, threshold: 0.95, period: 'custom', period_starts_on: '2026-11-01', period_ends_on: '2026-11-30' };
const issue = (over) => ({ key: 'X-1', summary: 'x', status: { name: 'To Do', category: 'new' }, labels: [], people: [], vendor: null, startedAt: new Date(now - 2 * H), dueAt: null, resolvedAt: null, lastActivityAt: now, blockedBy: [], blocks: [], ...over });

test('stale_critical_issue: idle ≥ 7 days and due within 3 days (or overdue → severity 4)', () => {
  const stale = issue({ key: 'A-1', lastActivityAt: new Date(now - 9 * D), dueAt: new Date(now.getTime() + 2 * D) });
  const overdue = issue({ key: 'A-2', lastActivityAt: new Date(now - 9 * D), dueAt: new Date(now - 1 * D) });
  const fresh = issue({ key: 'A-3', lastActivityAt: new Date(now - 1 * D), dueAt: new Date(now.getTime() + 1 * D) });
  const farAway = issue({ key: 'A-4', lastActivityAt: new Date(now - 20 * D), dueAt: new Date(now.getTime() + 30 * D) });
  const out = detectStaleCriticalIssues({ obligation: obl, issues: [stale, overdue, fresh, farAway], now });
  assert.deepEqual(out.map((s) => [s.evidence.issueKey, s.severity]).sort(), [['A-1', 3], ['A-2', 4]]);
  assert.ok(out.every((s) => s.fingerprint.startsWith('stale_critical_issue:obl-1:')));
});

test('single_point_of_failure: one person holds ≥ 50 % of ≥ 3 open issues', () => {
  const held = (key, person) => issue({ key, people: [person] });
  const out = detectSinglePointOfFailure({ obligation: obl, issues: [held('B-1', 'p1'), held('B-2', 'p1'), held('B-3', 'p1'), held('B-4', 'p2')], now });
  assert.equal(out.length, 1);
  assert.equal(out[0].evidence.personRef, 'p1');
  assert.equal(out[0].evidence.share, 0.75);
  assert.equal(detectSinglePointOfFailure({ obligation: obl, issues: [held('B-1', 'p1'), held('B-2', 'p2')], now }).length, 0, 'too few open issues');
});

test('obligation_trend: severity follows holds/projectedHolds; nothing when both hold', () => {
  const resolvedOnTime = Array.from({ length: 12 }, (_, i) => issue({ key: `C${i}`, startedAt: new Date(now - 10 * H), resolvedAt: new Date(now - 8 * H) }));
  const ok = computeMetric(obl, resolvedOnTime, now);
  assert.equal(detectObligationTrend({ obligation: obl, metric: ok, now }).length, 0);
  const late = [...resolvedOnTime, ...Array.from({ length: 3 }, (_, i) => issue({ key: `L${i}`, startedAt: new Date(now - 10 * H), resolvedAt: new Date(now - 1 * H) }))];
  const bad = computeMetric(obl, late, now);
  const [sig] = detectObligationTrend({ obligation: obl, metric: bad, now });
  assert.equal(sig.type, 'obligation_trend');
  assert.ok(sig.severity >= 4, `severity ${sig.severity}`);
  assert.equal(sig.evidence.periodEnd, '2026-11-30');
});

const graphWith = ({ load = [], absences = [], byKey = {} }) => new (class extends GraphSource {
  async teamLoad() { return load; }
  async personAvailability() { return absences; }
  async issuesByKeys(keys) { return keys.map((k) => byKey[k]).filter(Boolean); }
  async issuesInScope() { return []; }
})();

test('capacity assumption: holding under 90 %, shaken at 90–100 %, broken above the ceiling', async () => {
  const a = { id: 'asm-cap', kind: 'capacity', statement: 'x', params: { teamRef: 'vendor-v', maxOpenIssues: 10 } };
  const run = async (n) => checkAssumption({ assumption: a, decision: { id: 'd' }, obligation: obl, graph: graphWith({ load: Array.from({ length: n }, (_, i) => issue({ key: `V-${i}` })) }), now, window: { issues: [] } });
  assert.equal((await run(5)).status, 'holding');
  assert.equal((await run(9)).status, 'shaken');
  const broken = await run(13);
  assert.equal(broken.status, 'broken');
  assert.equal(broken.signals[0].severity, 4, '> 120 % of the ceiling');
});

test('person_available assumption: an absence breaks it; held issues raise the severity', async () => {
  const a = { id: 'asm-p', kind: 'person_available', statement: 'x', params: { personRef: 'p1', displayName: 'Pat' } };
  const absence = { kind: 'leave', startsOn: new Date(now - D), endsOn: new Date(now.getTime() + 5 * D), note: 'off' };
  const none = await checkAssumption({ assumption: a, decision: { id: 'd' }, obligation: obl, graph: graphWith({}), now, window: { issues: [] } });
  assert.equal(none.status, 'holding');
  const idle = await checkAssumption({ assumption: a, decision: { id: 'd' }, obligation: obl, graph: graphWith({ absences: [absence] }), now, window: { issues: [] } });
  assert.equal(idle.status, 'broken'); assert.equal(idle.signals[0].severity, 3);
  const busy = await checkAssumption({ assumption: a, decision: { id: 'd' }, obligation: obl, graph: graphWith({ absences: [absence] }), now, window: { issues: [issue({ key: 'H-1', people: ['p1'] })] } });
  assert.equal(busy.signals[0].severity, 4); assert.deepEqual(busy.evidence.heldIssues, ['H-1']);
});

test('dependency_done_by assumption: done → holding; open blocker → broken; overdue → severity 5', async () => {
  const a = { id: 'asm-dep', kind: 'dependency_done_by', statement: 'x', params: { issueKey: 'D-1', date: '2026-12-05' } };
  const done = { 'D-1': issue({ key: 'D-1', resolvedAt: new Date(now - D), status: { name: 'Done', category: 'done' } }) };
  assert.equal((await checkAssumption({ assumption: a, decision: { id: 'd' }, obligation: obl, graph: graphWith({ byKey: done }), now, window: { issues: [] } })).status, 'holding');
  const blocked = { 'D-1': issue({ key: 'D-1', blockedBy: ['D-2'] }), 'D-2': issue({ key: 'D-2', lastActivityAt: new Date(now - 6 * D) }) };
  const r = await checkAssumption({ assumption: a, decision: { id: 'd' }, obligation: obl, graph: graphWith({ byKey: blocked }), now, window: { issues: [] } });
  assert.equal(r.status, 'broken'); assert.equal(r.signals[0].severity, 4); assert.equal(r.evidence.blockedBy[0].idleDays, 6);
  const late = { ...a, params: { issueKey: 'D-1', date: '2026-11-20' } };
  const o = await checkAssumption({ assumption: late, decision: { id: 'd' }, obligation: obl, graph: graphWith({ byKey: { 'D-1': issue({ key: 'D-1' }) } }), now, window: { issues: [] } });
  assert.equal(o.signals[0].severity, 5);
});

test('routing assumption: an issue in scope carrying another vendor label contradicts the decision', async () => {
  const a = { id: 'asm-r', kind: 'routing', statement: 'x', params: { scopeJql: 'project = "X"', labelPrefix: 'vendor-', expected: 'vendor-a' } };
  const g = new (class extends GraphSource { async issuesInScope() { return [issue({ key: 'R-1', labels: ['vendor-a'] }), issue({ key: 'R-2', labels: ['vendor-b'] })]; } })();
  const r = await checkAssumption({ assumption: a, decision: { id: 'dec-1', title: 'D' }, obligation: obl, graph: g, now, window: { issues: [] } });
  assert.equal(r.status, 'broken');
  assert.equal(r.signals[0].type, 'decision_contradicted');
  assert.equal(r.signals[0].subject_id, 'dec-1');
  assert.deepEqual(r.signals[0].evidence.divergent.map((d) => d.key), ['R-2']);
  assert.ok(r.signals[0].fingerprint.length < 100, 'fingerprint is hashed, not a key list');
});

test('deadline metric exposes the earliest due date for the breach date', () => {
  const o = { ...obl, metric_type: 'deadline' };
  const m = computeMetric(o, [issue({ key: 'E-1', dueAt: new Date(now.getTime() + 2 * D) }), issue({ key: 'E-2', dueAt: new Date(now - D) })], now);
  assert.equal(m.detail.dueOn, new Date(now - D).toISOString().slice(0, 10));
  assert.equal(m.holds, false);
});

test('forecast: every term is explained and sums to the probability', () => {
  const m = computeMetric(obl, [], now);
  const f = computeForecast({ obligation: obl, metric: m, directSignals: [{ type: 'obligation_trend', severity: 4 }], assumptionResults: [{ status: 'broken' }, { status: 'shaken' }], contradictions: [], actions: { inProgress: 1, done: 0 }, now });
  const sum = f.explanation.steps.reduce((n, s) => n + s.delta, 0);
  assert.equal(Math.round(sum * 1000) / 1000, f.probability);
  assert.deepEqual(f.explanation.steps.map((s) => s.step), ['direct', 'assumptions', 'actions_in_progress']);
});
