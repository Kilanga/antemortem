import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrations, tableNames } from '../src/db/migrations/index.js';

test('migration names are unique and ordered', () => {
  const names = migrations.map((m) => m.name);
  assert.equal(new Set(names).size, names.length);
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted, 'names must sort in execution order (vNNN_ prefix)');
});

test('every migration is idempotent and single-statement', () => {
  for (const m of migrations) {
    assert.match(m.statement, /CREATE TABLE IF NOT EXISTS/i, m.name);
    assert.ok(!m.statement.trim().slice(0, -1).includes(';'), `${m.name} must contain one statement`);
    assert.ok(!/AUTO_INCREMENT/i.test(m.statement), `${m.name} must not use AUTO_INCREMENT`);
    assert.ok(!/FOREIGN KEY/i.test(m.statement), `${m.name} must not declare foreign keys`);
  }
});

test('tableNames matches the tables created by migrations', () => {
  const created = migrations.map((m) => m.statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1]);
  assert.deepEqual(created, tableNames);
});

test('no MySQL reserved words are used as table names', () => {
  const reserved = new Set(['signal', 'condition', 'trigger', 'order', 'group', 'key', 'index', 'table', 'select']);
  for (const t of tableNames) assert.ok(!reserved.has(t), `${t} is reserved`);
});
