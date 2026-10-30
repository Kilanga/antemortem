/**
 * Forecast — turn an obligation's signals and assumption states into a
 * breach date, an explainable probability and a cost (BUILD.md §6.3).
 *
 * Deliberately a transparent score, not a model: every contribution is
 * returned in `explanation` so the post-mortem can print the arithmetic and
 * a judge can check it.
 */
const SEVERITY_WEIGHT = 0.5; // severity/5 × this = base contribution of the strongest direct signal

export function computeForecast({ obligation, metric, directSignals, assumptionResults, contradictions, actions = { inProgress: 0, done: 0 }, now = new Date() }) {
  const explanation = [];
  let p = 0;

  // 1. Direct signals on the obligation (trend, stale issues, SPOF)
  const strongest = directSignals.reduce((m, s) => Math.max(m, s.severity), 0);
  if (strongest) {
    const base = (strongest / 5) * SEVERITY_WEIGHT;
    p += base;
    explanation.push({ step: 'direct', label: `Strongest direct signal: severity ${strongest}/5 (${directSignals.map((s) => s.type).join(', ')})`, delta: round(base) });
  }

  // 2. Assumptions behind the decisions this obligation depends on
  const broken = assumptionResults.filter((r) => r.status === 'broken');
  const shaken = assumptionResults.filter((r) => r.status === 'shaken');
  const assumptionDelta = Math.min(0.3, broken.length * 0.1 + shaken.length * 0.05);
  if (assumptionDelta) {
    p += assumptionDelta;
    explanation.push({ step: 'assumptions', label: `${broken.length} broken, ${shaken.length} shaken assumption(s) (capped at +0.30)`, delta: round(assumptionDelta) });
  }

  // 3. A decision this obligation relies on is being contradicted
  if (contradictions.length) {
    p += 0.1;
    explanation.push({ step: 'contradiction', label: `${contradictions.length} decision(s) contradicted by recent work`, delta: 0.1 });
  }

  // 4. Corrective actions — only work that actually moved counts. An action
  // that merely exists changes nothing (otherwise publishing an incident
  // would avert it by itself on the next run).
  if (actions.inProgress) {
    const d = Math.max(-0.1, -0.05 * actions.inProgress);
    p += d;
    explanation.push({ step: 'actions_in_progress', label: `${actions.inProgress} corrective action(s) in progress`, delta: round(d) });
  }
  if (actions.done) {
    const d = Math.max(-0.45, -0.15 * actions.done);
    p += d;
    explanation.push({ step: 'actions_done', label: `${actions.done} corrective action(s) completed`, delta: round(d) });
  }

  const probability = Math.min(0.98, Math.max(0.05, round(p)));

  // Breach date: when the current period closes, or the earliest overdue
  // deliverable for deadline-type obligations.
  let breachDate = metric.window?.end ? ymd(metric.window.end) : null;
  if (metric.kind === 'deadline') {
    const soon = [...(metric.detail.overdue ?? []), ...(metric.detail.dueSoon ?? [])];
    if (soon.length && metric.detail.dueOn) breachDate = metric.detail.dueOn;
  }

  const cost = projectedCost(obligation);
  const nothingWrong = !directSignals.length && !broken.length && !shaken.length && !contradictions.length;

  return {
    obligation_id: obligation.id,
    projected_breach_date: breachDate,
    probability: nothingWrong ? 0.05 : probability,
    projected_cost: cost.amount,
    currency: cost.currency,
    explanation: { steps: explanation, cost: cost.formula, metric: { kind: metric.kind, current: metric.current, projected: metric.projected, threshold: metric.threshold } },
    computed_at: now,
    healthy: nothingWrong,
  };
}

export function projectedCost(obligation, currency = 'EUR') {
  const v = Number(obligation.penalty_value ?? 0);
  if (obligation.penalty_type === 'percent_of_invoice') {
    const basis = Number(obligation.invoice_basis ?? 0);
    return { amount: round(basis * v / 100, 2), currency, formula: `${v} % × ${basis.toLocaleString('en-GB')} (invoice basis) = ${round(basis * v / 100, 2).toLocaleString('en-GB')}` };
  }
  return { amount: v, currency, formula: `fixed penalty ${v.toLocaleString('en-GB')}` };
}

const round = (v, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
