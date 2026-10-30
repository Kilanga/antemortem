/**
 * Simulation — run the pipeline without writing anything, either
 *   - as of a past date (backtest: "when would Antemortem have spoken?"), or
 *   - with some evidence removed (what-if: "if this were fixed?").
 *
 * Both reuse analyseObligation unchanged; the only additions are a graph
 * wrapper that shows the work as it stood at a date, and the `whatIf`
 * option of the pipeline.
 */
import { GraphSource } from '../graph/GraphSource.js';
import { analyseObligation } from './analyse.js';

const DAY = 86400_000;

/**
 * The work graph as it stood at `asOf`. Reconstructed from today's data:
 * an issue exists once started; it is resolved only if resolved by then;
 * activity after the date is unknown, so an open issue's last activity
 * falls back to its start. Absences are known from their start.
 */
export class AsOfGraphSource extends GraphSource {
  constructor(base, asOf) { super(); this.base = base; this.asOf = asOf; }
  get name() { return `${this.base.name} as of ${this.asOf.toISOString().slice(0, 10)}`; }
  project(issues) { return issues.map((i) => asOfIssue(i, this.asOf)).filter(Boolean); }
  async issuesInScope(jql) { return this.project(await this.base.issuesInScope(jql)); }
  async issuesByKeys(keys) { return this.project(await this.base.issuesByKeys(keys)); }
  async teamLoad(teamRef) { return this.project(await this.base.issuesInScope(`labels = "${teamRef}"`)).filter((i) => i.status.category !== 'done'); }
  async personAvailability(personRef, from, to) {
    const rows = await this.base.personAvailability(personRef, from, to);
    return rows.filter((a) => a.startsOn <= this.asOf);
  }
}

export function asOfIssue(i, asOf) {
  if (!i.startedAt || i.startedAt > asOf) return null;
  const resolved = Boolean(i.resolvedAt && i.resolvedAt <= asOf);
  if (resolved) return i;
  return {
    ...i,
    resolvedAt: null,
    status: i.status.category === 'done' ? { name: 'In Progress', category: 'indeterminate' } : i.status,
    lastActivityAt: i.lastActivityAt && i.lastActivityAt <= asOf ? i.lastActivityAt : i.startedAt,
  };
}

/** Caches base reads so a backtest of N points costs one set of REST calls. */
export class MemoGraphSource extends GraphSource {
  constructor(base) { super(); this.base = base; this.cache = new Map(); }
  get name() { return this.base.name; }
  memo(key, fn) { if (!this.cache.has(key)) this.cache.set(key, fn()); return this.cache.get(key); }
  issuesInScope(jql) { return this.memo(`scope:${jql}`, () => this.base.issuesInScope(jql)); }
  issuesByKeys(keys) { return this.memo(`keys:${[...keys].sort().join(',')}`, () => this.base.issuesByKeys(keys)); }
  teamLoad(ref) { return this.memo(`team:${ref}`, () => this.base.teamLoad(ref)); }
  personAvailability(ref, from, to) { return this.memo(`avail:${ref}:${+from}:${+to}`, () => this.base.personAvailability(ref, from, to)); }
}

/**
 * One simulated run of an obligation.
 * whatIf: { ignore: [signal fingerprints to remove], onTime: bool (open issues restored within SLA) }
 */
export async function simulateObligation({ obligation, decisions, graph, asOf, whatIf = null, now = new Date() }) {
  const past = asOf && asOf.getTime() < now.getTime() - DAY / 24;
  const g = past ? new AsOfGraphSource(graph, asOf) : graph;
  const ds = past ? decisions.filter((d) => !d.decided_at || toDate(d.decided_at) <= asOf) : decisions;
  return analyseObligation({ obligation, decisions: ds, graph: g, now: asOf ?? now, actions: { open: 0, doneSinceLast: 0 }, whatIf });
}

/**
 * Probability of breach as it would have been computed every `stepDays`
 * from `from` to `now`. Returns the curve and the first date the forecast
 * crossed the publish threshold.
 */
export async function backtest({ obligation, decisions, graph, now = new Date(), days = 35, stepDays = 5, threshold = 0.6 }) {
  const memo = new MemoGraphSource(graph);
  const points = [];
  for (let back = days; back >= 0; back -= stepDays) {
    const asOf = new Date(now.getTime() - back * DAY);
    const r = await simulateObligation({ obligation, decisions, graph: memo, asOf, now });
    const signals = [...r.directSignals, ...r.assumptionSignals].map((s) => s.type);
    points.push({ at: asOf.toISOString().slice(0, 10), daysBefore: back, probability: r.forecast.healthy ? 0 : r.forecast.probability, cost: r.forecast.projected_cost ?? 0, healthy: Boolean(r.forecast.healthy), signals, current: r.metric.current, projected: r.metric.projected });
  }
  const first = points.find((p) => p.probability >= threshold) ?? null;
  const breach = points[points.length - 1];
  return { points, threshold, firstAbove: first ? first.at : null, leadDays: first && breach ? daysBetween(first.at, (await lastBreachDate(obligation, decisions, memo, now))) : null };
}

async function lastBreachDate(obligation, decisions, graph, now) {
  const r = await simulateObligation({ obligation, decisions, graph, now });
  return r.forecast.projected_breach_date ?? null;
}

const toDate = (v) => (v instanceof Date ? v : new Date(String(v).replace(' ', 'T')));
const daysBetween = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / DAY) : null);
