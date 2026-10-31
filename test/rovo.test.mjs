import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDecision, recordObligation, deps, parsePeriod, parsePenalty, httpsOnly } from '../src/rovo/actions.js';

test('agent writes fail closed when the caller is not an administrator', async () => {
  deps.hasPermission = async () => false;
  const d = await recordDecision({ title: 'x', statement: 'y' });
  assert.match(d.error, /administrator/);
  const o = await recordObligation({ code: 'O-9', title: 'x', metricType: 'count_max', contractName: 'c' });
  assert.match(o.error, /administrator/);
});

test('agent writes fail closed when the permission check itself throws', async () => {
  deps.hasPermission = async () => { throw new Error('network'); };
  assert.match((await recordDecision({ title: 'x', statement: 'y' })).error, /administrator/);
});

test('period and penalty packing', () => {
  assert.deepEqual(parsePeriod('custom 2026-11-01 2026-11-30').period, 'custom');
  assert.equal(parsePeriod('weekly').period, 'weekly');
  assert.equal(parsePeriod('nonsense').period, 'monthly');
  assert.deepEqual(parsePenalty('fixed 5000'), { penaltyType: 'fixed', penaltyValue: 5000, invoiceBasis: null });
  assert.deepEqual(parsePenalty('percent 2 of 2000000'), { penaltyType: 'percent_of_invoice', penaltyValue: 2, invoiceBasis: 2000000 });
  assert.deepEqual(parsePenalty('', { penaltyType: 'fixed', penaltyValue: 10 }), { penaltyType: 'fixed', penaltyValue: 10, invoiceBasis: null });
  assert.equal(parsePenalty('whatever').penaltyType, null);
});

test('only https URLs are kept as sources', () => {
  assert.equal(httpsOnly('https://x.atlassian.net/wiki/spaces/A/pages/1'), 'https://x.atlassian.net/wiki/spaces/A/pages/1');
  assert.equal(httpsOnly('javascript:alert(1)'), null);
  assert.equal(httpsOnly('http://x'), null);
  assert.equal(httpsOnly(null), null);
});
