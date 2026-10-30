import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetric, periodWindow } from '../src/engine/metrics.js';
import { computeForecast } from '../src/engine/forecast.js';
import { detectObligationTrend, detectStaleCriticalIssues, detectSinglePointOfFailure } from '../src/engine/signals/index.js';

const now = new Date('2026-11-28T15:00:00Z');
const H = 3600_000;
const issue = (over) => ({ key: 'X-1', summary: 'x', status: { name: 'To Do', category: 'new' }, labels: [], people: [], vendor: null, startedAt: new Date(now - 2 * H), dueAt: null, resolvedAt: null, lastActivityAt: now, blockedBy: [], blocks: [], ...over });
const ratioObl = { id: 'o', code: 'O', metric_type: 'ratio_within_sla', sla_hours: 4, threshold: 0.95, period: 'custom', period_starts_on: '2026-11-14', period_ends_on: '2026-12-14', penalty_type: 'fixed', penalty_value: 1000 };

test('calendar month and week windows', () => {
  const m = periodWindow({ period: 'monthly' }, now);
  assert.equal(m.start.toISOString().slice(0, 10), '2026-11-01');
  assert.equal(m.end.toISOString().slice(0, 10), '2026-11-30');
  const w = periodWindow({ period: 'weekly' }, now);
  assert.equal(w.start.toISOString().slice(0, 10), '2026-11-23');
});

test('empty scope holds with ratio 1 and no signals', () => {
  const m = computeMetric(ratioObl, [], now);
  assert.equal(m.current, 1);
  assert.equal(m.holds, true);
  assert.deepEqual(detectObligationTrend({ obligation: ratioObl, metric: m, now }), []);
  const f = computeForecast({ obligation: ratioObl, metric: m, directSignals: [], assumptionResults: [], contradictions: [], now });
  assert.equal(f.healthy, true);
  assert.equal(f.probability, 0.05);
});

test('issues outside the window are ignored', () => {
  const old = issue({ key: 'X-0', startedAt: new Date('2026-10-01T00:00:00Z'), resolvedAt: new Date('2026-10-02T00:00:00Z') });
  const m = computeMetric(ratioObl, [old], now);
  assert.equal(m.detail.resolved, 0);
});

test('a resolved issue past the SLA counts as a breach; an open one past the SLA is not "likely ok"', () => {
  const late = issue({ key: 'X-2', startedAt: new Date(now - 10 * H), resolvedAt: new Date(now - 4 * H) });
  const openLate = issue({ key: 'X-3', startedAt: new Date(now - 6 * H) });
  const m = computeMetric(ratioObl, [late, openLate], now);
  assert.equal(m.detail.breached, 1);
  assert.deepEqual(m.detail.openPastSla, ['X-3']);
  assert.equal(m.detail.openLikelyOk, 0);
  assert.equal(m.holds, false);
  const [sig] = detectObligationTrend({ obligation: ratioObl, metric: m, now, minSample: 1 });
  assert.equal(sig.type, 'obligation_trend');
  assert.ok(sig.severity >= 4);
});

test('count_max and deadline metrics', () => {
  const cm = computeMetric({ ...ratioObl, metric_type: 'count_max', threshold: 1 }, [issue(), issue({ key: 'X-9' })], now);
  assert.equal(cm.holds, false);
  assert.equal(cm.margin, -1);
  const dl = computeMetric({ ...ratioObl, metric_type: 'deadline' }, [issue({ dueAt: new Date(now - H) })], now);
  assert.equal(dl.holds, false);
  assert.deepEqual(dl.detail.overdue, ['X-1']);
});

test('stale critical issue and single point of failure detectors', () => {
  const stale = issue({ lastActivityAt: new Date(now - 10 * 24 * H), dueAt: new Date(now + 24 * H) });
  assert.equal(detectStaleCriticalIssues({ obligation: ratioObl, issues: [stale], now })[0].type, 'stale_critical_issue');
  const held = ['a', 'b', 'c'].map((k) => issue({ key: `X-${k}`, people: ['label:tech-karim'] }));
  const [spof] = detectSinglePointOfFailure({ obligation: ratioObl, issues: [...held, issue({ key: 'X-d' })], now });
  assert.equal(spof.evidence.personRef, 'label:tech-karim');
  assert.equal(spof.evidence.openIssues, 3);
});

test('forecast is bounded and credits corrective actions', () => {
  const m = computeMetric(ratioObl, [], now);
  const sig = [{ type: 'obligation_trend', severity: 5 }];
  const broken = Array.from({ length: 6 }, () => ({ status: 'broken' }));
  const high = computeForecast({ obligation: ratioObl, metric: m, directSignals: sig, assumptionResults: broken, contradictions: [{}], now });
  assert.equal(high.probability, 0.9); // 0.5 + 0.3 (capped) + 0.1
  const withActions = computeForecast({ obligation: ratioObl, metric: m, directSignals: sig, assumptionResults: broken, contradictions: [{}], actions: { open: 1, doneSinceLast: 2 }, now });
  assert.equal(withActions.probability, 0.4);
  const floor = computeForecast({ obligation: ratioObl, metric: m, directSignals: sig, assumptionResults: [], contradictions: [], actions: { open: 0, doneSinceLast: 5 }, now });
  assert.equal(floor.probability, 0.05);
  assert.equal(floor.healthy, false, 'a signal is still present, so not healthy even at the floor');
});

test('percent-of-invoice cost formula', () => {
  const m = computeMetric({ ...ratioObl, penalty_type: 'percent_of_invoice', penalty_value: 2, invoice_basis: 2_000_000 }, [], now);
  const f = computeForecast({ obligation: { ...ratioObl, penalty_type: 'percent_of_invoice', penalty_value: 2, invoice_basis: 2_000_000 }, metric: m, directSignals: [], assumptionResults: [], contradictions: [], now });
  assert.equal(f.projected_cost, 40000);
  assert.match(f.explanation.cost, /2 % × 2,000,000/);
});

test('person_silent fires when someone holds idle issues, not when they are active', async () => {
  const { detectSilentAssignees } = await import('../src/engine/signals/index.js');
  const held = (key, idleDays) => issue({ key, people: ['label:tech-x'], lastActivityAt: new Date(now - idleDays * 24 * H) });
  assert.equal(detectSilentAssignees({ obligation: ratioObl, issues: [held('A-1', 6), held('A-2', 9)], now }).length, 1);
  assert.equal(detectSilentAssignees({ obligation: ratioObl, issues: [held('A-1', 6), held('A-2', 1)], now }).length, 0);
  assert.equal(detectSilentAssignees({ obligation: ratioObl, issues: [held('A-1', 9)], now }).length, 0);
});
