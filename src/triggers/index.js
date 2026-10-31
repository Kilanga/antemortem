/**
 * Lifecycle and scheduled entry points. All three are deliberately small:
 * they log, call the shared functions, and never throw (a throwing trigger
 * just gets retried, and the migration runner is already idempotent).
 */
import { runMigrations, getSchemaStatus } from '../db/migrate.js';
import { runAnalysis } from '../engine/index.js';
import { getSettings } from '../settings.js';
import { jobsQueue } from '../demo/consumer.js';
import { query, toSqlDateTime } from '../db/client.js';
import { timingSafeEqual } from 'node:crypto';

/** avi:forge:installed:app / avi:forge:upgraded:app */
export async function onInstall(event, context) {
  console.log(`[antemortem] ${event?.eventType ?? 'install'} — applying schema`);
  // Default function timeout is 25 s here (custom timeouts are only allowed on
  // scheduled triggers and consumers), so keep the retry window inside it.
  const result = await runMigrations({ deadlineMs: 18_000 });
  console.log('[antemortem] schema result', JSON.stringify(result));
  return result;
}

/** scheduledTrigger, every hour */
export async function hourly() {
  // 1. Make sure the schema is complete (covers installs where the install
  //    trigger hit the DDL rate limit, and minor upgrades that add tables).
  const status = await getSchemaStatus();
  if (!status.ok) {
    console.log('[antemortem] hourly: schema incomplete, running migrations', status.missing);
    await runMigrations({ deadlineMs: 20_000 });
  }
  // 2. Run the analysis.
  const result = await runAnalysis({ source: 'scheduled' });
  console.log('[antemortem] hourly analysis', JSON.stringify(result));
  return result;
}

/**
 * webtrigger — "Run analysis now" from outside the UI (demo scripts, tests).
 * Requires the shared token from Settings (header X-Antemortem-Token or
 * ?token=). Queues the analysis (same path as the UI button) and returns 202.
 */
export async function runAnalysisWebtrigger(request) {
  if (request?.method && request.method !== 'POST') return response(405, { error: 'POST only' });
  const settings = await getSettings();
  const given = request?.headers?.['x-antemortem-token']?.[0] ?? null; // header only: query strings land in logs
  if (!settings.webtriggerToken || !given || !sameToken(given, settings.webtriggerToken)) return response(401, { error: 'Invalid or missing token. Generate one in Antemortem → Settings.' });
  const running = await query("SELECT id FROM analysis_run WHERE status = 'running' AND started_at > ? LIMIT 1", [toSqlDateTime(new Date(Date.now() - 10 * 60_000))]);
  if (running.length) return response(202, { ok: true, queued: false, note: 'an analysis is already running' });
  await jobsQueue.push({ body: { job: 'run-analysis', source: 'webtrigger' } });
  return response(202, { ok: true, queued: true });
}

function sameToken(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(body),
  };
}
