/**
 * Analysis engine entry point.
 *
 * Week 1: the pipeline is wired (run record, timing, error capture) but the
 * detectors, chain builder and forecast are not implemented yet. Weeks 3–4
 * fill in `detectSignals`, `buildChains`, `forecast` and `publish` — see
 * BUILD.md §6. Keeping the entry point stable now means the triggers, the
 * webtrigger and the UI button never need to change.
 */
import { insert, updateById, toSqlDateTime } from '../db/client.js';
import { getSettings } from '../settings.js';

export async function runAnalysis({ source = 'manual' } = {}) {
  const startedAt = new Date();
  const runId = await insert('analysis_run', {
    trigger_source: source,
    started_at: startedAt,
    status: 'running',
  });

  try {
    const settings = await getSettings();
    const summary = {
      source,
      graphSource: settings.graphSource,
      obligationsScanned: 0,
      signalsDetected: 0,
      forecastsComputed: 0,
      incidentsPublished: 0,
      incidentsAverted: 0,
      note: 'Engine not implemented yet (BUILD.md §6, weeks 3–4).',
    };

    await updateById('analysis_run', runId, {
      status: 'done',
      finished_at: new Date(),
      summary,
    });
    return { runId, ok: true, durationMs: Date.now() - startedAt.getTime(), summary };
  } catch (err) {
    const error = String(err?.stack ?? err?.message ?? err);
    console.error('[antemortem] analysis failed', error);
    await updateById('analysis_run', runId, {
      status: 'failed',
      finished_at: new Date(),
      error,
    }).catch(() => {});
    return { runId, ok: false, error, finishedAt: toSqlDateTime() };
  }
}
