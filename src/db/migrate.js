/**
 * Schema migration runner.
 *
 * Forge SQL applies DDL asynchronously and rate-limits it (25 DDL/min per
 * install), so `run()` can fail transiently. We retry inside a deadline that
 * fits the 55 s function timeout, and we call this from three places:
 *   1. the install / upgrade trigger   (first attempt, right after install)
 *   2. the hourly scheduled trigger    (catches installs where 1. failed)
 *   3. the "Repair database" button    (manual, from the command center)
 *
 * Because migrationRunner keeps one global queue, we enqueue only once per
 * process invocation.
 */
import { migrationRunner, sql } from '@forge/sql';
import { migrations, tableNames } from './migrations/index.js';

let enqueued = false;

function enqueueAll() {
  if (enqueued) return;
  for (const m of migrations) migrationRunner.enqueue(m.name, m.statement);
  enqueued = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run pending migrations, retrying on transient errors until `deadlineMs`.
 * Returns { ok, applied: string[], attempts, error? }.
 */
export async function runMigrations({ deadlineMs = 40_000 } = {}) {
  enqueueAll();
  const started = Date.now();
  let attempts = 0;
  let lastError;

  while (Date.now() - started < deadlineMs) {
    attempts += 1;
    try {
      const applied = await migrationRunner.run();
      return { ok: true, applied, attempts };
    } catch (err) {
      lastError = err;
      console.warn(`[antemortem] migration attempt ${attempts} failed: ${err?.message ?? err}`);
      await sleep(Math.min(5_000, 1_000 * attempts));
    }
  }
  return { ok: false, applied: [], attempts, error: String(lastError?.message ?? lastError) };
}

/**
 * Health check used by the command center and by judges' smoke test.
 * Lists applied migrations and verifies each expected table answers a query.
 */
export async function getSchemaStatus() {
  enqueueAll();
  const expected = migrations.map((m) => m.name);
  let applied = [];
  let listError = null;
  try {
    applied = (await migrationRunner.list()).map((v) => v.name);
  } catch (err) {
    listError = String(err?.message ?? err);
  }

  const tables = [];
  for (const t of tableNames) {
    try {
      const res = await sql.executeRaw(`SELECT COUNT(*) AS n FROM ${t}`);
      tables.push({ table: t, ok: true, rows: Number(res.rows?.[0]?.n ?? 0) });
    } catch (err) {
      tables.push({ table: t, ok: false, error: String(err?.message ?? err) });
    }
  }

  const missing = expected.filter((n) => !applied.includes(n));
  return {
    ok: missing.length === 0 && tables.every((t) => t.ok),
    expected,
    applied,
    missing,
    tables,
    listError,
  };
}
