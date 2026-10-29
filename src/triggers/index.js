/**
 * Lifecycle and scheduled entry points. All three are deliberately small:
 * they log, call the shared functions, and never throw (a throwing trigger
 * just gets retried, and the migration runner is already idempotent).
 */
import { runMigrations, getSchemaStatus } from '../db/migrate.js';
import { runAnalysis } from '../engine/index.js';

/** avi:forge:installed:app / avi:forge:upgraded:app */
export async function onInstall(event, context) {
  console.log(`[antemortem] ${event?.eventType ?? 'install'} — applying schema`);
  const result = await runMigrations({ deadlineMs: 45_000 });
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
 * Protected by a shared token stored in settings? Not yet: in week 7 we add a
 * token check. For now the URL itself is the secret (Forge webtrigger URLs
 * are unguessable), and the endpoint only triggers an analysis — no data out.
 */
export async function runAnalysisWebtrigger(request) {
  if (request?.method && request.method !== 'POST') {
    return response(405, { error: 'POST only' });
  }
  const result = await runAnalysis({ source: 'webtrigger' });
  return response(result.ok ? 200 : 500, result);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(body),
  };
}
