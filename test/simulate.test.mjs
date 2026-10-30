import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from '../src/demo/scenario.js';
import { simulateObligation, backtest } from '../src/engine/simulate.js';
import { fakeGraphFromScenario, modelFromScenario } from './helpers/fakeGraph.mjs';

const now = new Date('2026-11-28T15:00:00Z');
const scenario = buildScenario(now);
const graph = fakeGraphFromScenario(scenario, now);
const { obligations, decisions } = modelFromScenario(scenario, graph);
const o3 = obligations.find((x) => x.code === 'O-3');
const d3 = decisions.filter((d) => d.obligationRefs.includes('O-3'));

test('what-if: setting aside every assumption signal lowers the probability', async () => {
  const base = await simulateObligation({ obligation: o3, decisions: d3, graph, now });
  const ignore = base.assumptionSignals.map((s) => s.fingerprint);
  const r = await simulateObligation({ obligation: o3, decisions: d3, graph, now, whatIf: { ignore } });
  assert.ok(r.forecast.probability < base.forecast.probability, `${r.forecast.probability} < ${base.forecast.probability}`);
  assert.ok(r.assumptionResults.every((a) => a.status === 'holding'));
  assert.equal(r.assumptionSignals.length, 0);
});

test('what-if: open issues restored on time raises the projection but the 3 past breaches still weigh', async () => {
  const base = await simulateObligation({ obligation: o3, decisions: d3, graph, now });
  const r = await simulateObligation({ obligation: o3, decisions: d3, graph, now, whatIf: { onTime: true } });
  assert.ok(r.metric.projected > base.metric.projected, `${r.metric.projected} > ${base.metric.projected}`);
  assert.equal(r.metric.detail.openLikelyOk, r.metric.detail.open);
});

test('backtest: probability rises over the history and crosses the threshold before the breach', async () => {
  const b = await backtest({ obligation: o3, decisions: d3, graph, now, days: 14, stepDays: 2, threshold: 0.6 });
  assert.equal(b.points.length, 8);
  const probs = b.points.map((p) => p.probability);
  assert.ok(probs[0] <= probs[probs.length - 1], `curve ${probs.join(' → ')}`);
  assert.ok(probs[probs.length - 1] >= 0.75);
  assert.ok(b.firstAbove, 'threshold crossed');
  assert.ok(b.leadDays > 0, `lead ${b.leadDays}`);
});

test('backtest: as-of view hides issues started later and shows resolved ones as open', async () => {
  const early = await simulateObligation({ obligation: o3, decisions: d3, graph, now, asOf: new Date(now.getTime() - 20 * 86400_000) });
  const late = await simulateObligation({ obligation: o3, decisions: d3, graph, now });
  assert.ok(early.issues.length < late.issues.length);
  assert.ok(early.issues.every((i) => !i.resolvedAt || i.resolvedAt <= new Date(now.getTime() - 20 * 86400_000)));
});
