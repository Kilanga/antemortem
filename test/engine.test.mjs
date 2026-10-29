import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from '../src/demo/scenario.js';
import { analyseObligation } from '../src/engine/analyse.js';
import { fakeGraphFromScenario, modelFromScenario } from './helpers/fakeGraph.mjs';

const now = new Date('2026-11-28T15:00:00Z');
const scenario = buildScenario(now);
const graph = fakeGraphFromScenario(scenario, now);
const { obligations, decisions } = modelFromScenario(scenario, graph);
const decisionsFor = (o) => decisions.filter((d) => d.obligationRefs.includes(o.code));

async function run(code) {
  const o = obligations.find((x) => x.code === code);
  return analyseObligation({ obligation: o, decisions: decisionsFor(o), graph, now });
}

test('O-3: metric is under threshold and projected to stay there', async () => {
  const r = await run('O-3');
  assert.equal(r.metric.kind, 'ratio_within_sla');
  assert.equal(r.metric.detail.resolved, 43);
  assert.equal(r.metric.detail.within, 40);
  assert.ok(r.metric.current < 0.95 && r.metric.current > 0.92, `current ${r.metric.current}`);
  assert.ok(!r.metric.projectedHolds, 'projected must not hold');
  assert.equal(r.metric.detail.openNearSla.length, 6);
});

test('O-3: the four D-7 assumptions are all broken, with evidence', async () => {
  const r = await run('O-3');
  const byKind = Object.fromEntries(r.assumptionResults.map((a) => [a.kind, a]));
  assert.equal(byKind.capacity.status, 'broken');
  assert.equal(byKind.capacity.evidence.openIssues, 31);
  assert.equal(byKind.person_available.status, 'broken');
  assert.equal(byKind.person_available.evidence.heldIssues.length, 4);
  assert.equal(byKind.dependency_done_by.status, 'broken');
  assert.equal(byKind.dependency_done_by.evidence.blockedBy.length, 1);
  assert.ok(byKind.dependency_done_by.evidence.blockedBy[0].idleDays >= 8);
  assert.equal(byKind.routing.status, 'broken');
  assert.equal(byKind.routing.evidence.divergent[0].label, 'vendor-helios');
});

test('O-3: signals, contradiction, forecast and chain', async () => {
  const r = await run('O-3');
  const types = [...r.directSignals, ...r.assumptionSignals].map((s) => s.type).sort();
  assert.deepEqual(types, ['assumption_capacity_exceeded', 'assumption_dependency_slipping', 'assumption_person_unavailable', 'decision_contradicted', 'obligation_trend']);
  assert.equal(r.contradictions.length, 1);
  assert.equal(r.forecast.projected_breach_date, '2026-12-14');
  assert.equal(r.forecast.projected_cost, 40000);
  assert.ok(r.forecast.probability >= 0.75 && r.forecast.probability <= 0.9, `probability ${r.forecast.probability}`);
  assert.ok(r.forecast.explanation.steps.length >= 3);
  const roles = r.chain.map((e) => e.role);
  assert.equal(roles[0], 'root', 'chain starts with the decision');
  assert.equal(roles[roles.length - 1], 'projection', 'chain ends with the breach');
  // Timeline is ordered
  const dates = r.chain.map((e) => e.at);
  assert.deepEqual(dates, [...dates].sort());
});

test('O-1, O-2, O-4 are healthy', async () => {
  for (const code of ['O-1', 'O-2', 'O-4']) {
    const r = await run(code);
    assert.ok(r.forecast.healthy, `${code} should be healthy: ${JSON.stringify(r.forecast.explanation.steps)}`);
    assert.equal(r.forecast.probability, 0.05);
  }
});

test('fingerprints are stable across runs', async () => {
  const a = await run('O-3');
  const b = await run('O-3');
  const fa = [...a.directSignals, ...a.assumptionSignals].map((s) => s.fingerprint).sort();
  const fb = [...b.directSignals, ...b.assumptionSignals].map((s) => s.fingerprint).sort();
  assert.deepEqual(fa, fb);
});
