import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure test of the id rule used by insert(): the row's own undefined id must
// not clobber the generated one. Mirrors the expression in src/db/client.js.
import { randomUUID } from 'node:crypto';
const build = (row) => ({ ...row, id: row.id ?? randomUUID() });

test('a row with id: undefined gets a generated id', () => {
  assert.match(build({ id: undefined, name: 'x' }).id, /^[0-9a-f-]{36}$/);
});
test('an explicit id is kept', () => {
  assert.equal(build({ id: 'abc', name: 'x' }).id, 'abc');
});
