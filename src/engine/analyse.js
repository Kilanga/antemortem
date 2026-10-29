/**
 * The analysis pipeline, free of storage side effects so it can run in a
 * test against a fake graph source:
 *
 *   for each active obligation:
 *     issues   = graph.issuesInScope(obligation.jql_scope)
 *     metric   = computeMetric(obligation, issues)
 *     direct   = detectors on (obligation, metric, issues)
 *     for each decision the obligation depends on:
 *        for each assumption: checkAssumption → status + signals
 *     forecast = computeForecast(...)
 *     chain    = ordered evidence (the future post-mortem's timeline)
 *
 * Returns per-obligation results; `runAnalysis` (index.js) persists them.
 */
import { computeMetric } from './metrics.js';
import { detectObligationTrend, detectStaleCriticalIssues, detectSinglePointOfFailure, checkAssumption } from './signals/index.js';
import { computeForecast } from './forecast.js';

export async function analyseObligation({ obligation, decisions, graph, now = new Date(), actions }) {
  const issues = obligation.jql_scope ? await graph.issuesInScope(obligation.jql_scope) : [];
  const metric = computeMetric(obligation, issues, now);
  const window = { ...metric.window, issues };

  const directSignals = [
    ...detectObligationTrend({ obligation, metric, now }),
    ...detectStaleCriticalIssues({ obligation, issues, now }),
    ...detectSinglePointOfFailure({ obligation, issues, now }),
  ];

  const assumptionResults = [];
  const assumptionSignals = [];
  for (const decision of decisions) {
    for (const assumption of decision.assumptions ?? []) {
      const r = await checkAssumption({ assumption, decision, obligation, graph, now, window });
      assumptionResults.push({ assumptionId: assumption.id, decisionId: decision.id, kind: assumption.kind, status: r.status, evidence: r.evidence });
      assumptionSignals.push(...r.signals);
    }
  }
  const contradictions = assumptionSignals.filter((s) => s.type === 'decision_contradicted');

  const forecast = computeForecast({ obligation, metric, directSignals, assumptionResults, contradictions, actions, now });
  const chain = buildChain({ obligation, decisions, metric, directSignals, assumptionSignals, assumptionResults, forecast, now });

  return { obligation, issues, metric, directSignals, assumptionSignals, assumptionResults, contradictions, forecast, chain };
}

/**
 * The causal chain, ordered by date, past then projected. Each entry is
 * structured (the narrative renders it); `role` says what the entry is in
 * the story: root (the decision), condition (an assumption), event (a
 * signal), measurement (the metric), projection (the breach).
 */
export function buildChain({ obligation, decisions, metric, directSignals, assumptionSignals, assumptionResults, forecast, now }) {
  const entries = [];
  for (const d of decisions) {
    entries.push({ at: ymd(d.decided_at) ?? ymd(now), role: 'root', kind: 'decision', decisionId: d.id, title: d.title, statement: d.statement, sourceUrl: d.source_url ?? null });
  }
  for (const s of assumptionSignals) {
    entries.push({ at: signalDate(s, now) ?? ymd(now), role: 'event', kind: s.type, signalFingerprint: s.fingerprint, severity: s.severity, evidence: s.evidence });
  }
  for (const s of directSignals) {
    entries.push({ at: ymd(now), role: s.type === 'obligation_trend' ? 'measurement' : 'event', kind: s.type, signalFingerprint: s.fingerprint, severity: s.severity, evidence: s.evidence });
  }
  if (!forecast.healthy) {
    entries.push({ at: forecast.projected_breach_date, role: 'projection', kind: 'breach', obligationCode: obligation.code, probability: forecast.probability, cost: forecast.projected_cost, currency: forecast.currency, metric: { kind: metric.kind, projected: metric.projected, threshold: metric.threshold } });
  }
  return entries.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || rank(a.role) - rank(b.role));
}

const rank = (role) => ({ root: 0, condition: 1, event: 2, measurement: 3, projection: 4 }[role] ?? 5);

/** The date a signal's evidence points to (when the thing happened), else null. */
function signalDate(s, now) {
  const e = s.evidence ?? {};
  switch (s.type) {
    case 'assumption_person_unavailable': return e.startsOn ?? null;
    case 'decision_contradicted': return e.divergent?.[0]?.since ?? null;
    case 'assumption_dependency_slipping': {
      const stalest = e.blockedBy?.[0];
      if (stalest?.idleDays != null) return ymd(new Date(now.getTime() - stalest.idleDays * 86400_000));
      return e.deadline ?? null;
    }
    default: return null;
  }
}

const ymd = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d).replace(' ', 'T')).slice(0, 10) : null);
