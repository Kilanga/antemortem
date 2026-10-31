/**
 * Obligation metrics — pure functions over normalised issues.
 *
 * Every metric returns the same shape so the forecast and the narrative can
 * treat them uniformly:
 * {
 *   kind,                 // metric_type
 *   current,              // measured value today (ratio 0–1, or a count)
 *   projected,            // value expected at period end if nothing changes
 *   threshold,            // the contractual bar
 *   holds: boolean,       // current value satisfies the bar
 *   projectedHolds,       // projected value satisfies the bar
 *   margin,               // how much room is left before breach (same unit as current)
 *   detail: {...}         // metric-specific numbers for the narrative
 * }
 */

const H = 3600_000;

export function periodWindow(obligation, now = new Date()) {
  if (obligation.period_starts_on && obligation.period_ends_on) {
    return { start: startOfDay(obligation.period_starts_on), end: endOfDay(obligation.period_ends_on) };
  }
  const d = new Date(now);
  if (obligation.period === 'weekly') {
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    return { start, end: new Date(start.getTime() + 7 * 24 * H - 1) };
  }
  // monthly (default) and one_shot without explicit window: calendar month.
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
  return { start, end };
}

const startOfDay = (v) => new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
const endOfDay = (v) => new Date(`${String(v).slice(0, 10)}T23:59:59Z`);

/** Issues whose clock started inside the window. */
export function inWindow(issues, win) {
  return issues.filter((i) => i.startedAt && i.startedAt >= win.start && i.startedAt <= win.end);
}

export function computeMetric(obligation, issues, now = new Date()) {
  const win = periodWindow(obligation, now);
  switch (obligation.metric_type) {
    case 'ratio_within_sla': return ratioWithinSla(obligation, inWindow(issues, win), win, now);
    case 'jsm_sla': return jsmSla(obligation, inWindow(issues, win), win);
    case 'count_max': return countMetric(obligation, inWindow(issues, win), win, 'max');
    case 'count_min': return countMetric(obligation, inWindow(issues, win), win, 'min');
    case 'deadline': return deadlineMetric(obligation, issues, win, now);
    default: return { kind: obligation.metric_type, current: null, projected: null, threshold: null, holds: true, projectedHolds: true, margin: null, detail: { note: 'custom metric — not computed' }, window: win };
  }
}

/**
 * ratio_within_sla — share of resolved issues restored within sla_hours.
 * Projection: open issues are assumed to resolve at their current age plus
 * the median remaining time observed on resolved ones; those already past
 * the SLA are counted as breaches. The projected ratio is then
 * (within + openStillOk) / (resolved + open) — a deliberately simple,
 * explainable model rather than a statistical one.
 */
function ratioWithinSla(o, issues, win, now) {
  const sla = Number(o.sla_hours) * H;
  const threshold = Number(o.threshold);
  const resolved = issues.filter((i) => i.resolvedAt);
  const open = issues.filter((i) => !i.resolvedAt && i.status.category !== 'done');
  const within = resolved.filter((i) => i.resolvedAt - i.startedAt <= sla);
  const breached = resolved.length - within.length;

  const durations = resolved.map((i) => i.resolvedAt - i.startedAt).sort((a, b) => a - b);
  const medianMs = durations.length ? durations[Math.floor(durations.length / 2)] : sla * 0.5;

  const openPastSla = open.filter((i) => now - i.startedAt > sla);
  const openNearSla = open.filter((i) => now - i.startedAt <= sla && now - i.startedAt > sla * 0.75);
  const openLikelyOk = open.filter((i) => now - i.startedAt + medianMs * 0.5 <= sla);

  const current = resolved.length ? within.length / resolved.length : 1;
  const total = resolved.length + open.length;
  const projectedWithin = within.length + openLikelyOk.length;
  const projected = total ? projectedWithin / total : 1;

  // How many consecutive on-time resolutions would be needed to reach the
  // threshold from the projected position: n such that (pw + n)/(total + n) >= t
  const needed = projected >= threshold ? 0 : Math.ceil((threshold * total - projectedWithin) / (1 - threshold));

  return {
    kind: 'ratio_within_sla',
    current: round(current),
    projected: round(projected),
    threshold,
    holds: current >= threshold,
    projectedHolds: projected >= threshold,
    margin: round(current - threshold),
    window: win,
    detail: {
      resolved: resolved.length,
      within: within.length,
      breached,
      open: open.length,
      openPastSla: openPastSla.map((i) => i.key),
      openNearSla: openNearSla.map((i) => i.key),
      openLikelyOk: openLikelyOk.length,
      medianHours: round(medianMs / H, 1),
      slaHours: Number(o.sla_hours),
      neededOnTimeToRecover: needed,
    },
  };
}

/**
 * jsm_sla — share of requests whose Jira Service Management SLA completed
 * without ever breaching. The SLA clock (pauses, calendars) is JSM's own:
 * issues arrive annotated by the graph source (`issue.sla`), from the JQL
 * functions completed(), everBreached(), running(), remaining().
 */
function jsmSla(o, issues, win) {
  const threshold = Number(o.threshold);
  const withSla = issues.filter((i) => i.sla);
  const completed = withSla.filter((i) => i.sla.completed);
  const within = completed.filter((i) => !i.sla.everBreached);
  const running = withSla.filter((i) => i.sla.running);
  const runningBreached = running.filter((i) => i.sla.breached);
  const runningNear = running.filter((i) => !i.sla.breached && i.sla.nearLimit);
  const runningOk = running.length - runningBreached.length;
  const current = completed.length ? within.length / completed.length : 1;
  const total = completed.length + running.length;
  const projectedWithin = within.length + runningOk;
  const projected = total ? projectedWithin / total : 1;
  const needed = projected >= threshold ? 0 : Math.ceil((threshold * total - projectedWithin) / (1 - threshold));
  return {
    kind: 'jsm_sla',
    current: round(current),
    projected: round(projected),
    threshold,
    holds: current >= threshold,
    projectedHolds: projected >= threshold,
    margin: round(current - threshold),
    window: win,
    detail: {
      slaName: o.sla_name,
      resolved: completed.length,
      within: within.length,
      breached: completed.length - within.length,
      open: running.length,
      openPastSla: runningBreached.map((i) => i.key),
      openNearSla: runningNear.map((i) => i.key),
      openLikelyOk: runningOk,
      slaHours: o.sla_hours != null ? Number(o.sla_hours) : null,
      neededOnTimeToRecover: needed,
    },
  };
}

function countMetric(o, issues, win, mode) {
  const threshold = Number(o.threshold);
  const count = issues.length;
  const holds = mode === 'max' ? count <= threshold : count >= threshold;
  return {
    kind: o.metric_type,
    current: count,
    projected: count,
    threshold,
    holds,
    projectedHolds: holds,
    margin: mode === 'max' ? threshold - count : count - threshold,
    window: win,
    detail: { count, keys: issues.slice(0, 20).map((i) => i.key) },
  };
}

/** deadline — the scoped deliverable(s) must be done by their due date. */
function deadlineMetric(o, issues, win, now) {
  const pending = issues.filter((i) => !i.resolvedAt && i.status.category !== 'done');
  const overdue = pending.filter((i) => i.dueAt && i.dueAt < now);
  const dueSoon = pending.filter((i) => i.dueAt && i.dueAt >= now && i.dueAt - now < 3 * 24 * H);
  return {
    kind: 'deadline',
    current: overdue.length,
    projected: overdue.length + dueSoon.filter((i) => now - i.lastActivityAt > 5 * 24 * H).length,
    threshold: 0,
    holds: overdue.length === 0,
    projectedHolds: overdue.length === 0 && dueSoon.every((i) => now - i.lastActivityAt <= 5 * 24 * H),
    margin: -overdue.length,
    window: win,
    detail: { pending: pending.map((i) => i.key), overdue: overdue.map((i) => i.key), dueSoon: dueSoon.map((i) => i.key), dueOn: earliest([...overdue, ...dueSoon].map((i) => i.dueAt)) },
  };
}

const earliest = (dates) => { const d = dates.filter(Boolean).sort((a, b) => a - b)[0]; return d ? d.toISOString().slice(0, 10) : null; };

export const round = (v, dp = 3) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
