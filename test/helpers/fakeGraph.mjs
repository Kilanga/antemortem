/**
 * In-memory GraphSource built from the demo scenario, with a tiny JQL
 * evaluator covering the subset the scenario uses:
 *   project = "X", labels = y, statusCategory != Done, key in (A, B), AND
 */
import { GraphSource } from '../../src/graph/GraphSource.js';
import { DEMO } from '../../src/demo/scenario.js';

export function fakeGraphFromScenario(scenario, now) {
  const issues = scenario.issues.map((spec, idx) => {
    const key = `${DEMO.projectKey}-${idx + 1}`;
    return { id: spec.id, key, spec };
  });
  const byId = new Map(issues.map((i) => [i.id, i.key]));
  const links = scenario.links.map((l) => ({ outward: byId.get(l.outward), inward: byId.get(l.inward) }));

  const normalised = issues.map(({ key, spec }) => ({
    key,
    summary: spec.summary,
    status: { name: spec.resolved ? 'Done' : 'To Do', category: spec.resolved ? 'done' : 'new' },
    labels: spec.labels,
    people: spec.labels.filter((l) => l.startsWith('tech-')).map((l) => `label:${l}`),
    vendor: spec.labels.find((l) => l.startsWith('vendor-')) ?? null,
    sla: spec.sla ?? null,
    startedAt: spec.startedAt,
    dueAt: spec.dueAt,
    resolvedAt: spec.resolvedAt,
    lastActivityAt: spec.lastActivityAt,
    blockedBy: links.filter((l) => l.inward === key).map((l) => l.outward),
    blocks: links.filter((l) => l.outward === key).map((l) => l.inward),
    timingSource: 'property',
  }));

  const evalJql = (jql) => {
    const clauses = jql.split(/\s+AND\s+/i).map((c) => c.trim());
    return normalised.filter((i) => clauses.every((c) => {
      let m;
      if ((m = c.match(/^project\s*=\s*"?([A-Z0-9_]+)"?$/i))) return i.key.startsWith(m[1] + '-');
      if ((m = c.match(/^labels\s*=\s*"?([\w-]+)"?$/i))) return i.labels.includes(m[1]);
      if ((m = c.match(/^statusCategory\s*!=\s*Done$/i))) return i.status.category !== 'done';
      if ((m = c.match(/^key\s+in\s*\((.*)\)$/i))) return m[1].split(',').map((k) => k.trim()).includes(i.key);
      if ((m = c.match(/^\(([^()]*(?:\([^()]*\)[^()]*)*)\)$/))) return evalJql(m[1]).includes(i);
      if ((m = c.match(/^"([^"]+)"\s*=\s*(completed|everBreached|running|breached|paused)\(\)$/))) return Boolean(i.sla?.[m[2]]);
      if ((m = c.match(/^"([^"]+)"\s*<\s*remaining\s*\("(\d+)h"\)$/))) return i.sla?.running && i.sla.remainingMs != null && i.sla.remainingMs < Number(m[2]) * 3600_000;
      throw new Error(`fake JQL cannot evaluate: ${c}`);
    }));
  };

  return new (class extends GraphSource {
    get name() { return 'fake'; }
    async issuesInScope(jql) { return evalJql(jql); }
    async issuesByKeys(keys) { return normalised.filter((i) => keys.includes(i.key)); }
    async teamLoad(teamRef) { return normalised.filter((i) => i.labels.includes(teamRef) && i.status.category !== 'done'); }
    async personAvailability(personRef, from, to) {
      const f = from.toISOString().slice(0, 10);
      const t = to.toISOString().slice(0, 10);
      return scenario.availability.filter((a) => a.account_id === personRef && a.ends_on >= f && a.starts_on <= t)
        .map((a) => ({ kind: a.kind, startsOn: new Date(a.starts_on), endsOn: new Date(a.ends_on), note: a.note, displayName: a.display_name }));
    }
    keyOf(scenarioId) { return byId.get(scenarioId); }
  })();
}

/** Model objects (obligations with ids, decisions with assumptions) as the engine expects them. */
export function modelFromScenario(scenario, graph) {
  const obligations = scenario.obligations.map((o, i) => ({ ...o, id: `obl-${o.code}`, contract_id: 'contract-1', period_starts_on: scenario.window.startsOn, period_ends_on: scenario.window.endsOn }));
  const decisions = scenario.decisions.map((d, i) => ({
    id: `dec-${d.ref}`,
    title: d.title,
    statement: d.statement,
    rationale: d.rationale,
    decided_at: d.decided_at,
    source_url: `/wiki/spaces/ANTE/pages/${i + 1}`,
    status: 'active',
    obligationRefs: d.obligationRefs,
    assumptions: d.assumptions.map((a, j) => {
      const params = { ...a.params };
      if (params.issueRef) { params.issueKey = graph.keyOf(params.issueRef); delete params.issueRef; }
      return { id: `asm-${d.ref}-${j}`, decision_id: `dec-${d.ref}`, statement: a.statement, kind: a.kind, params, status: 'holding' };
    }),
  }));
  return { obligations, decisions };
}
