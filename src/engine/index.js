/**
 * Analysis engine entry point — orchestration + persistence.
 *
 * Pipeline per obligation lives in analyse.js (pure, testable). This file:
 *   1. loads active obligations, the decisions they depend on, and settings
 *   2. runs the pipeline against the configured GraphSource
 *   3. upserts signals (by fingerprint), resolves the ones no longer detected
 *   4. updates assumption statuses
 *   5. stores a forecast per obligation (superseding the previous one)
 *   6. (week 4) publishes / averts future incidents
 */
import { insert, updateById, query, execute, toSqlDateTime } from '../db/client.js';
import { obligations, decisions as decisionsRepo, assumptions as assumptionsRepo, signals as signalsRepo, forecasts as forecastsRepo, actionItems, futureIncidents } from '../db/repo/index.js';
import { getSettings } from '../settings.js';
import { graphSourceFor } from '../graph/index.js';
import { analyseObligation } from './analyse.js';
import { reconcileIncident } from './publish.js';

export async function runAnalysis({ source = 'manual', now = new Date() } = {}) {
  const startedAt = new Date();
  const runId = await insert('analysis_run', { trigger_source: source, started_at: startedAt, status: 'running' });

  try {
    const settings = await getSettings();
    const graph = graphSourceFor(settings);
    const active = await obligations.list({ where: "status = 'active'", limit: 200 });
    const allDecisions = await decisionsRepo.list({ where: "status IN ('active','contradicted')", limit: 500 });
    const allAssumptions = await assumptionsRepo.list({ limit: 2000 });
    const dependsOn = await query("SELECT from_id AS obligation_id, to_id AS decision_id FROM link WHERE archived_at IS NULL AND from_type = 'obligation' AND relation = 'depends_on' AND to_type = 'decision'");

    const decisionsWithAssumptions = new Map(allDecisions.map((d) => [d.id, { ...d, assumptions: allAssumptions.filter((a) => a.decision_id === d.id) }]));

    const summary = { source, graphSource: graph.name, obligationsScanned: 0, signalsDetected: 0, signalsResolved: 0, forecastsComputed: 0, incidentsPublished: 0, incidentsAverted: 0, results: [] };
    const results = [];

    for (const obligation of active) {
      const decisionIds = dependsOn.filter((l) => l.obligation_id === obligation.id).map((l) => l.decision_id);
      const decisions = decisionIds.map((id) => decisionsWithAssumptions.get(id)).filter(Boolean);
      const actions = await actionsSummary(obligation.id);

      let result;
      try {
        result = await analyseObligation({ obligation, decisions, graph, now, actions });
      } catch (err) {
        console.error(`[antemortem] analysis failed for ${obligation.code}`, err);
        summary.results.push({ code: obligation.code, error: String(err?.message ?? err) });
        continue;
      }
      summary.obligationsScanned += 1;

      // Persist signals (upsert by fingerprint) and resolve the stale ones.
      const detected = [...result.directSignals, ...result.assumptionSignals];
      const fingerprints = new Set();
      for (const s of detected) {
        fingerprints.add(s.fingerprint);
        await upsertSignal(s, now);
      }
      summary.signalsDetected += detected.length;
      summary.signalsResolved += await resolveMissingSignals(obligation, decisions, fingerprints, now);

      // Assumption statuses.
      for (const r of result.assumptionResults) {
        await assumptionsRepo.update(r.assumptionId, { status: r.status, last_checked_at: now, evidence: r.evidence });
      }
      // A contradicted decision is flagged as such (until the contradiction clears).
      for (const d of decisions) {
        const contradicted = result.contradictions.some((c) => c.subject_id === d.id);
        const next = contradicted ? 'contradicted' : d.status === 'contradicted' ? 'active' : d.status;
        if (next !== d.status) await decisionsRepo.update(d.id, { status: next });
      }

      // Forecast: supersede the previous one.
      const previous = await forecastsRepo.list({ where: 'obligation_id = ? AND superseded_by IS NULL', params: [obligation.id], limit: 5 });
      const fc = await forecastsRepo.create({ ...result.forecast, chain: result.chain, computed_at: now });
      for (const p of previous) await forecastsRepo.update(p.id, { superseded_by: fc.id });
      summary.forecastsComputed += 1;

      results.push({ ...result, decisions, forecastId: fc.id });
      summary.results.push({ code: obligation.code, probability: result.forecast.probability, breach: result.forecast.projected_breach_date, cost: result.forecast.projected_cost, signals: detected.map((s) => s.type), metric: { current: result.metric.current, projected: result.metric.projected, threshold: result.metric.threshold } });
    }

    // Publication / aversion of future incidents.
    for (const r of results) {
      try {
        const outcome = await reconcileIncident({ result: r, settings, now });
        if (outcome.action === 'published') summary.incidentsPublished += 1;
        if (outcome.action === 'averted') summary.incidentsAverted += 1;
        const entry = summary.results.find((x) => x.code === r.obligation.code);
        if (entry) entry.incident = outcome.action;
      } catch (err) {
        console.error(`[antemortem] publish failed for ${r.obligation.code}`, err);
        const entry = summary.results.find((x) => x.code === r.obligation.code);
        if (entry) entry.incident = `error: ${String(err?.message ?? err)}`;
      }
    }

    await updateById('analysis_run', runId, { status: 'done', finished_at: new Date(), summary });
    return { runId, ok: true, durationMs: Date.now() - startedAt.getTime(), summary };
  } catch (err) {
    const error = String(err?.stack ?? err?.message ?? err);
    console.error('[antemortem] analysis failed', error);
    await updateById('analysis_run', runId, { status: 'failed', finished_at: new Date(), error }).catch(() => {});
    return { runId, ok: false, error, finishedAt: toSqlDateTime() };
  }
}

async function upsertSignal(s, now) {
  const existing = await query('SELECT id FROM risk_signal WHERE fingerprint = ?', [s.fingerprint]);
  if (existing.length) {
    await updateById('risk_signal', existing[0].id, { severity: s.severity, evidence: s.evidence, resolved_at: null, subject_type: s.subject_type, subject_id: s.subject_id });
    return existing[0].id;
  }
  return insert('risk_signal', { type: s.type, severity: s.severity, subject_type: s.subject_type, subject_id: s.subject_id, fingerprint: s.fingerprint, detected_at: s.detected_at ?? now, evidence: s.evidence });
}

/** Open signals about this obligation / its decisions / their assumptions that were not re-detected → resolved. */
async function resolveMissingSignals(obligation, decisions, fingerprints, now) {
  const subjects = [['obligation', obligation.id], ...decisions.map((d) => ['decision', d.id]), ...decisions.flatMap((d) => (d.assumptions ?? []).map((a) => ['assumption', a.id]))];
  let n = 0;
  for (const [type, id] of subjects) {
    const open = await query('SELECT id, fingerprint FROM risk_signal WHERE subject_type = ? AND subject_id = ? AND resolved_at IS NULL', [type, id]);
    for (const row of open) {
      if (!fingerprints.has(row.fingerprint)) {
        await execute('UPDATE risk_signal SET resolved_at = ? WHERE id = ?', [toSqlDateTime(now), row.id]);
        n += 1;
      }
    }
  }
  return n;
}

/** Corrective actions attached to the latest incident for this obligation. */
async function actionsSummary(obligationId) {
  const [fi] = await futureIncidents.list({ where: "obligation_id = ? AND status IN ('published','draft','averted')", params: [obligationId], orderBy: 'created_at DESC', limit: 1 });
  if (!fi) return { open: 0, doneSinceLast: 0 };
  const items = await actionItems.list({ where: 'future_incident_id = ?', params: [fi.id], limit: 50 });
  return { open: items.filter((a) => a.status === 'open' || a.status === 'in_progress').length, doneSinceLast: items.filter((a) => a.status === 'done').length };
}
