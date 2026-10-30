/**
 * Mock backend for design work and screenshots outside Jira (`?mock=1`).
 * Shapes mirror the resolvers; figures mirror the demo scenario.
 */
const today = new Date();
const d = (days) => new Date(today.getTime() + days * 86400_000).toISOString().slice(0, 10);
const dt = (days, h = 9) => `${d(days)} ${String(h).padStart(2, '0')}:00:00`;

const obligations = [
  { id: 'o1', code: 'O-1', title: 'Restoration ≤ 8 h on 98 % of lot 1 interventions', metric_type: 'ratio_within_sla', sla_hours: 8, threshold: 0.98, period: 'custom', period_ends_on: d(16), jql_scope: 'project = "NFS" AND labels = lot-1 AND labels = intervention', penalty_type: 'fixed', penalty_value: 5000, contract: { id: 'c1', name: 'Meridian Telecom — Curative maintenance, fixed network 2026', counterparty: 'Meridian Telecom', currency: 'EUR' } },
  { id: 'o2', code: 'O-2', title: 'Repeat-fault rate ≤ 5 % (lot 2)', metric_type: 'count_max', threshold: 3, period: 'custom', period_ends_on: d(16), jql_scope: 'project = "NFS" AND labels = lot-2 AND labels = reopened', penalty_type: 'fixed', penalty_value: 8000, contract: { id: 'c1', name: 'Meridian Telecom — Curative maintenance, fixed network 2026', counterparty: 'Meridian Telecom', currency: 'EUR' } },
  { id: 'o3', code: 'O-3', title: 'Restoration ≤ 4 h on 95 % of lot 3 interventions', metric_type: 'ratio_within_sla', sla_hours: 4, threshold: 0.95, period: 'custom', period_ends_on: d(16), jql_scope: 'project = "NFS" AND labels = lot-3 AND labels = intervention', penalty_type: 'percent_of_invoice', penalty_value: 2, invoice_basis: 2000000, contract: { id: 'c1', name: 'Meridian Telecom — Curative maintenance, fixed network 2026', counterparty: 'Meridian Telecom', currency: 'EUR' } },
  { id: 'o4', code: 'O-4', title: 'Monthly service report delivered by J+5', metric_type: 'deadline', period: 'custom', period_ends_on: d(16), jql_scope: 'project = "NFS" AND labels = reporting', penalty_type: 'fixed', penalty_value: 2500, contract: { id: 'c1', name: 'Meridian Telecom — Curative maintenance, fixed network 2026', counterparty: 'Meridian Telecom', currency: 'EUR' } },
];

const chain = [
  { at: d(-70), role: 'root', kind: 'decision', title: 'D-7 · Lot 3 stays with Boreal Interventions (Sept. steering committee)' },
  { at: d(-9), role: 'event', kind: 'assumption_dependency_slipping', signalFingerprint: 'assumption_dependency_slipping:mock', evidence: { issueKey: 'NFS-87', summary: 'Site access badges — Northern zone, batch 3', deadline: d(2), blockedBy: [{ key: 'NFS-88', summary: 'Badge supplier contract amendment (Varlock Access)', idleDays: 9 }] } },
  { at: d(-3), role: 'event', kind: 'assumption_person_unavailable', signalFingerprint: 'assumption_person_unavailable:mock', evidence: { displayName: 'Karim Benali', kind: 'reassigned', startsOn: d(-3), endsOn: d(30), note: 'Reassigned to the lot 1 ramp-up (Western zone) by ops planning', heldIssues: ['NFS-44', 'NFS-45', 'NFS-46', 'NFS-47'] } },
  { at: d(-1), role: 'event', kind: 'decision_contradicted', signalFingerprint: 'decision_contradicted:mock', evidence: { divergent: [{ key: 'NFS-89', summary: 'Reassign 4 Northern-zone interventions to Helios Services', label: 'vendor-helios' }], decision: 'D-7 · Lot 3 stays with Boreal Interventions (Sept. steering committee)' } },
  { at: d(0), role: 'event', kind: 'assumption_capacity_exceeded', signalFingerprint: 'assumption_capacity_exceeded:mock', evidence: { teamRef: 'vendor-boreal', openIssues: 31, maxOpenIssues: 25 } },
  { at: d(0), role: 'measurement', kind: 'obligation_trend', evidence: { code: 'O-3', current: 0.93, projected: 0.833, within: 40, resolved: 43, open: 11, openNearSla: ['NFS-44', 'NFS-45', 'NFS-46', 'NFS-47', 'NFS-48', 'NFS-49'] } },
  { at: d(16), role: 'projection', kind: 'breach', obligationCode: 'O-3', probability: 0.8, cost: 40000, currency: 'EUR', metric: { projected: 0.833, threshold: 0.95 } },
];

const forecastO3 = { id: 'f3', obligation_id: 'o3', probability: 0.8, projected_breach_date: d(16), projected_cost: 40000, currency: 'EUR', computed_at: dt(0, 9), healthy: false, chain, explanation: { metric: { kind: 'ratio_within_sla', current: 0.93, projected: 0.833, threshold: 0.95 }, steps: [{ delta: 0.4, label: 'Strongest direct signal: severity 4/5 (obligation_trend)' }, { delta: 0.3, label: '4 broken, 0 shaken assumption(s) (capped at +0.30)' }, { delta: 0.1, label: '1 decision(s) contradicted by recent work' }], cost: '2 % × 2,000,000 (invoice basis) = 40,000' } };
const healthy = (id, metric) => ({ id: `f-${id}`, obligation_id: id, probability: 0.05, projected_breach_date: d(16), projected_cost: 0, currency: 'EUR', computed_at: dt(0, 9), healthy: true, chain: [], explanation: { metric, steps: [], cost: '' } });

const signals = [
  { type: 'assumption_dependency_slipping', severity: 4, fingerprint: 's1' },
  { type: 'assumption_capacity_exceeded', severity: 4, fingerprint: 's2' },
  { type: 'obligation_trend', severity: 4, fingerprint: 's3' },
  { type: 'assumption_person_unavailable', severity: 4, fingerprint: 's4' },
  { type: 'decision_contradicted', severity: 4, fingerprint: 's5' },
];

const incident = {
  id: 'fi1', obligation_id: 'o3', title: `Incident ${d(16)} — Meridian Telecom, O-3 breach`, incident_date: d(16), status: 'published',
  summary: `On ${new Date(d(16)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, the contractual period for O-3 (Restoration ≤ 4 h on 95 % of lot 3 interventions) closes with 83 % of lot 3 interventions restored within 4 h, against the 95 % required.`,
  confluence_page_url: 'https://example.atlassian.net/wiki/spaces/ANTE/pages/1',
  actions: { probability: 0.8, cost: 40000, currency: 'EUR', errors: [], items: [
    { id: 'a1', title: 'Triage the 6 interventions closest to the 4 h limit', issue_key: 'NFS-91', status: 'in_progress', url: '#' },
    { id: 'a2', title: 'Bring Boreal back under 25 open issues', issue_key: 'NFS-92', status: 'open', url: '#' },
    { id: 'a3', title: 'Restore Karim Benali to lot 3 interventions, or qualify a second engineer', issue_key: 'NFS-93', status: 'open', url: '#' },
    { id: 'a4', title: `Unblock NFS-88 so that NFS-87 lands by ${d(2)}`, issue_key: 'NFS-94', status: 'done', url: '#' },
    { id: 'a5', title: 'Decide: confirm or revise "D-7"', issue_key: 'NFS-95', status: 'open', url: '#' },
  ] },
};

const overview = {
  ok: true,
  app: { name: 'Antemortem', version: '0.8.0', week: 7 },
  user: { accountId: 'mock' }, site: { siteUrl: 'https://example.atlassian.net' },
  schema: { ok: true, missing: [], tables: ['contract', 'obligation', 'decision', 'assumption', 'link', 'risk_signal', 'forecast', 'future_incident', 'action_item', 'availability', 'analysis_run'].map((t) => ({ table: t, ok: true, rows: 4 })) },
  settings: { confluenceSpaceKey: 'ANTE', actionsProjectKey: 'NFS', publishThreshold: 0.6, graphSource: 'rest', demoLoaded: true, demoLoadedAt: dt(0, 8) },
  demo: { status: 'done', steps: [] },
  lastRun: { id: 'r1', trigger_source: 'manual', started_at: dt(0, 9), finished_at: dt(0, 9), status: 'done', summary: { obligationsScanned: 4, signalsDetected: 5 } },
  counts: { contract: 1, obligation: 4, decision: 3, assumption: 6, link: 12, risk_signal: 5, forecast: 4, future_incident: 1, action_item: 5, availability: 2, analysis_run: 3 },
};

const responses = {
  getOverview: overview,
  listForecasts: { ok: true, forecasts: [
    { obligation: obligations[2], forecast: forecastO3, signals },
    { obligation: obligations[0], forecast: healthy('o1', { kind: 'ratio_within_sla', current: 1, projected: 1, threshold: 0.98 }), signals: [] },
    { obligation: obligations[1], forecast: healthy('o2', { kind: 'count_max', current: 0, projected: 0, threshold: 3 }), signals: [] },
    { obligation: obligations[3], forecast: healthy('o4', { kind: 'deadline', current: 0, projected: 0, threshold: 0 }), signals: [] },
  ] },
  listIncidents: { ok: true, open: [incident], averted: [{ ...incident, id: 'fi0', status: 'averted', title: `Incident ${d(-20)} — Meridian Telecom, O-2 breach`, incident_date: d(-20), averted_at: dt(-35, 14), cost_avoided: 8000, obligation: { code: 'O-2' } }], costAvoided: 8000 },
  listObligations: { ok: true, obligations },
  listContracts: { ok: true, contracts: [{ id: 'c1', name: 'Meridian Telecom — Curative maintenance, fixed network 2026', currency: 'EUR' }] },
  listDecisions: { ok: true, decisions: [
    { id: 'd7', title: 'D-7 · Lot 3 stays with Boreal Interventions (Sept. steering committee)', statement: 'Lot 3 (Northern zone) remains subcontracted to Boreal Interventions rather than being brought in-house for Q4.', decided_at: dt(-70), status: 'contradicted', source_url: '#', supports: [{ id: 'o3', code: 'O-3' }], assumptions: [
      { id: 'a', statement: 'Boreal keeps no more than 25 open interventions across all lots.', kind: 'capacity', status: 'broken' },
      { id: 'b', statement: 'Karim Benali (only HV-qualified engineer on the Nordlink side) is available to the Northern zone until the end of the period.', kind: 'person_available', status: 'broken' },
      { id: 'c', statement: 'Site access badges for the September sites are delivered before the badge deadline.', kind: 'dependency_done_by', status: 'broken' },
      { id: 'e', statement: 'Northern-zone interventions are routed to Boreal, not to another vendor.', kind: 'routing', status: 'broken' },
    ] },
    { id: 'd6', title: 'D-6 · Lot 2 repeat-fault programme', statement: 'Repeat faults on lot 2 are root-caused weekly with the equipment vendor until the rate stays under 3 % for two consecutive months.', decided_at: dt(-78), status: 'active', supports: [{ id: 'o2', code: 'O-2' }], assumptions: [{ id: 'f', statement: 'Equipment vendor attends the weekly review.', kind: 'freeform', status: 'holding' }] },
  ] },
  getLastRun: { ok: true, lastRun: overview.lastRun },
  getDemoProgress: { ok: true, progress: overview.demo },
  getSettings: { ok: true, settings: overview.settings },
  saveSettings: { ok: true, settings: overview.settings },
  runAnalysisNow: { ok: true, queued: true },
  repairDatabase: { ok: true },
  dismissIncident: { ok: true },
  getWebtrigger: { ok: true, example: 'curl -X POST -H "X-Antemortem-Token: …" https://…/x/antemortem-run-analysis' },
};

const backtestPoints = [0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.6, 0.8].map((p, i) => ({ at: d(-14 + i * 2), daysBefore: 14 - i * 2, probability: p, cost: p ? 40000 : 0, healthy: p === 0, signals: [] }));
responses.backtest = { ok: true, points: backtestPoints, threshold: 0.6, firstAbove: d(-2), leadDays: 18, periodStart: d(-14) };

export const isMock = () => { try { return new URLSearchParams(window.location.search).get('mock') === '1'; } catch { return false; } };
export const mockInvoke = async (name, payload) => {
  await new Promise((r) => setTimeout(r, 120));
  if (name === 'whatIf') {
    const n = (payload?.ignore ?? []).length;
    const p = Math.max(0.05, Math.round((0.8 - n * 0.1 - (payload?.onTime ? 0.2 : 0)) * 100) / 100);
    const projected = payload?.onTime ? 0.944 : 0.833;
    return { ok: true, forecast: { probability: p, projected_cost: projected >= 0.95 ? 0 : 40000, currency: 'EUR', projected_breach_date: d(16), healthy: p <= 0.05 }, metric: { kind: 'ratio_within_sla', current: 0.93, projected, threshold: 0.95 } };
  }
  return responses[name] ?? { ok: false, error: `mock: no fixture for ${name}` };
};
