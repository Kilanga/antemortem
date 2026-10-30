import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from '../src/demo/scenario.js';
import { analyseObligation } from '../src/engine/analyse.js';
import { composeIncident } from '../src/engine/narrative/index.js';
import { renderStorage } from '../src/engine/narrative/confluence.js';
import { fakeGraphFromScenario, modelFromScenario } from './helpers/fakeGraph.mjs';

const now = new Date('2026-11-28T15:00:00Z');
const scenario = buildScenario(now);
const graph = fakeGraphFromScenario(scenario, now);
const { obligations, decisions } = modelFromScenario(scenario, graph);
const o = obligations.find((x) => x.code === 'O-3');
const ds = decisions.filter((d) => d.obligationRefs.includes('O-3'));
const r = await analyseObligation({ obligation: o, decisions: ds, graph, now });
const doc = composeIncident({ obligation: o, contract: scenario.contract, decisions: ds, metric: r.metric, signals: [...r.directSignals, ...r.assumptionSignals], assumptionResults: r.assumptionResults, forecast: r.forecast, chain: r.chain, now, siteUrl: 'https://x.atlassian.net' });

test('title is dated in the future and names the obligation', () => {
  assert.equal(doc.title, 'Incident 2026-12-14 — Meridian Telecom, O-3 breach');
  assert.equal(doc.incidentDate, '2026-12-14');
});

test('impact states the projected ratio, the bar and the penalty', () => {
  const text = doc.sections.impact.join(' ');
  assert.match(text, /83 %/);
  assert.match(text, /95 % required/);
  assert.match(text, /€40,000/);
});

test('root cause names the decision and its four broken assumptions', () => {
  assert.match(doc.sections.rootCause[0], /D-7/);
  assert.match(doc.sections.rootCause[0], /19 September 2026/);
  assert.equal(doc.sections.rootCause.filter((t) => t.startsWith('• ')).length, 4);
});

test('timeline is chronological, past rows are facts, last row is the projection', () => {
  const dates = doc.sections.timeline.map((t) => t.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(doc.sections.timeline.at(-1).projected, true);
  assert.ok(doc.sections.timeline.slice(0, -1).every((t) => !t.projected));
  assert.ok(doc.sections.timeline.some((t) => t.link?.includes('/browse/')));
});

test('corrective actions cover every causal signal', () => {
  const keys = doc.sections.actions.map((a) => a.key.split(':')[0]).sort();
  assert.deepEqual(keys, ['cap', 'cover', 'decide', 'triage', 'unblock']);
  for (const a of doc.sections.actions) assert.ok(a.title.length <= 250 && a.description.length > 20);
});

test('method section prints the arithmetic', () => {
  const text = doc.sections.method.join('\n');
  assert.match(text, /\+0\.4/);
  assert.match(text, /= 0\.8/);
  assert.match(text, /40,000/);
});

test('storage rendering is well-formed and carries the banner', () => {
  const html = renderStorage(doc, { status: 'published', actionItems: [{ title: 'x', issue_key: 'NFS-100', url: 'https://x/browse/NFS-100', status: 'open' }] });
  assert.match(html, /This incident has not happened yet/);
  assert.match(html, /<h2>Timeline<\/h2>/);
  assert.match(html, /NFS-100/);
  assert.ok(!/<script/i.test(html));
  const averted = renderStorage(doc, { status: 'averted', averted: { at: now, costAvoided: 40000, daysBefore: 16 } });
  assert.match(averted, /Averted on 28 November 2026/);
  assert.match(averted, /€40,000/);
});
