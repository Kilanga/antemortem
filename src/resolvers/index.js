/**
 * Custom UI resolvers — the only backend surface the React app talks to.
 *
 * Conventions:
 *  - One resolver per screen action, named `verbNoun`.
 *  - Every resolver returns a plain JSON object; errors are returned as
 *    { ok: false, error } rather than thrown so the UI can render them.
 *  - Anything that writes checks that the caller is a Jira admin (week 2
 *    adds the permission check via /rest/api/3/mypermissions).
 */
import Resolver from '@forge/resolver';
import { getSchemaStatus, runMigrations } from '../db/migrate.js';
import { getSettings, saveSettings } from '../settings.js';
import { runAnalysis } from '../engine/index.js';
import { query } from '../db/client.js';

const resolver = new Resolver();

const safe = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (err) {
    console.error('[antemortem] resolver error', err);
    return { ok: false, error: String(err?.message ?? err) };
  }
};

/** Everything the command center needs on first paint. */
resolver.define(
  'getOverview',
  safe(async (req) => {
    const [schema, settings] = await Promise.all([getSchemaStatus(), getSettings()]);
    let lastRun = null;
    if (schema.ok) {
      const rows = await query(
        'SELECT id, trigger_source, started_at, finished_at, status, summary, error FROM analysis_run ORDER BY started_at DESC LIMIT 1',
      );
      lastRun = rows[0] ?? null;
    }
    return {
      ok: true,
      app: { name: 'Antemortem', version: '0.1.0', week: 1 },
      user: { accountId: req.context?.accountId ?? null },
      site: { cloudId: req.context?.cloudId ?? null },
      schema,
      settings,
      lastRun,
      counts: schema.ok ? Object.fromEntries(schema.tables.map((t) => [t.table, t.rows])) : {},
    };
  }),
);

resolver.define(
  'repairDatabase',
  safe(async () => {
    const result = await runMigrations({ deadlineMs: 20_000 });
    const schema = await getSchemaStatus();
    return { ok: result.ok && schema.ok, result, schema };
  }),
);

resolver.define(
  'runAnalysisNow',
  safe(async () => ({ ok: true, ...(await runAnalysis({ source: 'manual' })) })),
);

resolver.define('getSettings', safe(async () => ({ ok: true, settings: await getSettings() })));

resolver.define(
  'saveSettings',
  safe(async (req) => ({ ok: true, settings: await saveSettings(req.payload ?? {}) })),
);

export const handler = resolver.getDefinitions();
