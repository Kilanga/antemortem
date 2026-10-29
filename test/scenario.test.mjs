import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, issueFields, issueProperty } from '../src/demo/scenario.js';

const today = new Date('2026-11-28T15:00:00Z');
const s = buildScenario(today);

test('scenario is deterministic', () => {
  const s2 = buildScenario(today);
  assert.deepEqual(s.issues.map((i) => i.summary), s2.issues.map((i) => i.summary));
});

test('window and incident date are relative to today', () => {
  assert.equal(s.window.startsOn, '2026-11-14');
  assert.equal(s.window.endsOn, '2026-12-14');
  assert.equal(s.window.incidentDate, '2026-12-14');
});

test('lot 3 numbers converge on an O-3 breach trajectory', () => {
  const lot3 = s.issues.filter((i) => i.labels.includes('lot-3') && i.labels.includes('intervention'));
  const resolved = lot3.filter((i) => i.resolved);
  const within = resolved.filter((i) => i.resolvedAt - i.startedAt <= 4 * 3600_000);
  assert.equal(resolved.length, 43);
  assert.equal(within.length, 40);
  assert.ok(within.length / resolved.length < 0.95, 'current ratio must already be under the 95 % threshold');
  const open = lot3.filter((i) => !i.resolved && !i.labels.includes('vendor-helios'));
  assert.equal(open.length, 11);
  const nearSla = open.filter((i) => today - i.startedAt > 3 * 3600_000);
  assert.equal(nearSla.length, 6);
});

test('Boreal is over its assumed capacity of 25 open issues', () => {
  const borealOpen = s.issues.filter((i) => !i.resolved && i.labels.includes('vendor-boreal'));
  assert.equal(borealOpen.length, 31);
});

test('Karim holds open HV jobs while reassigned', () => {
  const karimOpen = s.issues.filter((i) => !i.resolved && i.labels.includes('tech-karim'));
  assert.equal(karimOpen.length, 4);
  const absence = s.availability.find((a) => a.account_id === 'label:tech-karim');
  assert.ok(absence && absence.starts_on <= '2026-11-28' && absence.ends_on >= '2026-12-14');
});

test('dependency chain and contradiction exist', () => {
  const badges = s.issues.find((i) => i.id === s.special.badges);
  const amendment = s.issues.find((i) => i.id === s.special.amendment);
  assert.ok(badges && amendment);
  assert.deepEqual(s.links, [{ type: 'Blocks', outward: amendment.id, inward: badges.id }]);
  assert.ok((today - amendment.lastActivityAt) / 86400_000 >= 8, 'amendment must be stale for 8+ days');
  const contradiction = s.issues.find((i) => i.id === s.special.contradiction);
  assert.ok(contradiction.labels.includes('lot-3') && contradiction.labels.includes('vendor-helios'));
});

test('D-7 rests on four monitored assumptions and supports O-3', () => {
  const d7 = s.decisions.find((d) => d.ref === 'D-7');
  assert.equal(d7.assumptions.length, 4);
  assert.deepEqual(d7.assumptions.map((a) => a.kind), ['capacity', 'person_available', 'dependency_done_by', 'routing']);
  assert.deepEqual(d7.obligationRefs, ['O-3']);
});

test('Jira payloads are well-formed', () => {
  const spec = s.issues[0];
  const f = issueFields(spec, 'FIELD', '10001');
  assert.equal(f.project.key, 'FIELD');
  assert.match(f.duedate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(f.description.type, 'doc');
  const p = issueProperty(spec);
  assert.equal(p.demo, true);
  assert.match(p.startedAt, /T/);
});

test('total issue count fits two bulk-create calls', () => {
  assert.ok(s.issues.length <= 100, `${s.issues.length} issues`);
  assert.ok(s.issues.length >= 80);
});
