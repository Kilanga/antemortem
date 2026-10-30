/**
 * The demo universe — entirely fictional (BUILD.md §8).
 *
 *   Client      : Meridian Telecom
 *   Contractor  : Nordlink Field Services   ← the organisation using Antemortem
 *   Subcontract : Boreal Interventions (lot 3), Helios Services (ad-hoc)
 *
 * Everything is generated relative to `today` so the story always converges
 * on an incident 16 days out, whenever the judge loads it. A seeded PRNG
 * keeps the data stable between runs.
 *
 * Issue timing lives in the `antemortem` issue property (Jira cannot backdate
 * `created` through the API); RestGraphSource reads it transparently.
 */

export const DEMO = {
  projectKey: 'NFS', // NB: 'FIELD' is a reserved JQL word — never use it as a project key
  projectName: 'Nordlink Field Services — Meridian',
  spaceKey: 'ANTE',
  spaceName: 'Nordlink Operations',
  client: 'Meridian Telecom',
  contractor: 'Nordlink Field Services',
  subcontractor: 'Boreal Interventions',
  otherVendor: 'Helios Services',
  people: {
    karim: { ref: 'label:tech-karim', label: 'tech-karim', name: 'Karim Benali', role: 'HV-qualified field engineer' },
    lena: { ref: 'label:tech-lena', label: 'tech-lena', name: 'Lena Voss', role: 'Field engineer' },
    tomas: { ref: 'label:tech-tomas', label: 'tech-tomas', name: 'Tomas Reyes', role: 'Field engineer' },
    boreal: { ref: 'label:vendor-boreal', label: 'vendor-boreal', name: 'Boreal Interventions', role: 'Subcontractor' },
  },
};

// Deterministic PRNG (mulberry32) so the scenario is identical on every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const H = 3600_000;
const D = 24 * H;
const iso = (d) => d.toISOString();
const ymd = (d) => d.toISOString().slice(0, 10);

const SITES = ['Nordhaven exchange', 'Kestrel Hill mast', 'Varda Street cabinet', 'Port Ellery DSLAM', 'Birch Lane junction', 'Marrow Quay repeater', 'Old Mill substation', 'Aster Park cabinet', 'Fenwick Road exchange', 'Greyhill tower'];
const FAULTS = ['fibre break', 'power supply failure', 'card replacement', 'battery swap', 'HV cabinet inspection', 'cooling unit fault', 'line card reset', 'antenna realignment', 'earthing fault', 'ODF re-splice'];

/**
 * Build the scenario for a given `today` (midnight UTC recommended).
 * Returns { window, issues, links, contract, obligations, decisions, availability, pages }.
 */
export function buildScenario(today = new Date()) {
  // `now` anchors the ages of open issues (hours old); `day(d, h)` anchors
  // everything else to calendar days so the story reads the same whatever
  // time of day the judge loads it.
  const now = new Date(today.getTime());
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const day = (d, h = 9) => new Date(midnight + d * D + h * H);
  const T = now;
  const rand = rng(20261214);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const window = { startsOn: ymd(day(-14)), endsOn: ymd(day(16)), incidentDate: ymd(day(16)) };

  const issues = [];
  let n = 0;
  const add = (spec) => { issues.push({ id: `i${++n}`, ...spec }); return issues[issues.length - 1]; };

  // --- Lot 3 (Northern zone), resolved interventions: 43, of which 40 within 4 h
  const lot3Resolved = 43;
  const lot3Breaches = new Set([5, 17, 31]); // indices resolved late
  for (let i = 0; i < lot3Resolved; i++) {
    const startDay = -14 + (i * 14) / lot3Resolved; // spread over the elapsed window
    const started = day(startDay, 7 + Math.floor(rand() * 9));
    const hours = lot3Breaches.has(i) ? 4.6 + rand() * 3 : 1.2 + rand() * 2.5;
    const tech = pick(['karim', 'lena', 'tomas']);
    add({
      summary: `${pick(SITES)} — ${pick(FAULTS)}`,
      labels: ['lot-3', 'vendor-boreal', DEMO.people[tech].label, 'intervention'],
      resolved: true,
      startedAt: started,
      dueAt: new Date(started.getTime() + 4 * H),
      resolvedAt: new Date(started.getTime() + hours * H),
      lastActivityAt: new Date(started.getTime() + hours * H),
      description: `Curative intervention, lot 3. SLA: 4 h to restore. ${lot3Breaches.has(i) ? 'Restored late — access delay on site.' : 'Restored within SLA.'}`,
    });
  }

  // --- Lot 3 open interventions: 11, six of them close to the 4 h mark
  for (let i = 0; i < 11; i++) {
    const close = i < 6;
    const ageH = close ? 3.1 + rand() * 0.7 : 0.4 + rand() * 1.5;
    const started = new Date(now.getTime() - ageH * H);
    const tech = i < 4 ? 'karim' : pick(['lena', 'tomas']); // Karim holds four HV jobs
    add({
      summary: `${pick(SITES)} — ${i < 4 ? 'HV cabinet inspection' : pick(FAULTS)}`,
      labels: ['lot-3', 'vendor-boreal', DEMO.people[tech].label, 'intervention', ...(i < 4 ? ['hv'] : [])],
      resolved: false,
      startedAt: started,
      dueAt: new Date(started.getTime() + 4 * H),
      resolvedAt: null,
      lastActivityAt: new Date(now.getTime() - rand() * 2 * H),
      description: i < 4
        ? 'Curative intervention, lot 3. Requires HV qualification (only Karim Benali is qualified on the Nordlink side).'
        : 'Curative intervention, lot 3. SLA: 4 h to restore.',
    });
  }

  // --- Boreal preventive-maintenance load on other lots so that open Boreal issues total 31
  for (let i = 0; i < 20; i++) {
    const started = day(-(1 + Math.floor(rand() * 10)), 8 + Math.floor(rand() * 8));
    add({
      summary: `${pick(SITES)} — ${pick(FAULTS)}`,
      labels: [i % 3 === 0 ? 'lot-2' : 'lot-1', 'vendor-boreal', 'preventive'],
      resolved: false,
      startedAt: started,
      dueAt: new Date(started.getTime() + 10 * D),
      resolvedAt: null,
      lastActivityAt: new Date(now.getTime() - rand() * 3 * D),
      description: 'Preventive maintenance visit (no restoration SLA). Counts toward the subcontractor\'s open workload.',
    });
  }

  // --- Lot 1 / lot 2 resolved, healthy
  for (let i = 0; i < 12; i++) {
    const started = day(-13 + i, 9);
    add({
      summary: `${pick(SITES)} — ${pick(FAULTS)}`,
      labels: [i % 2 ? 'lot-1' : 'lot-2', 'vendor-boreal', 'intervention'],
      resolved: true,
      startedAt: started,
      dueAt: new Date(started.getTime() + 8 * H),
      resolvedAt: new Date(started.getTime() + (2 + rand() * 4) * H),
      lastActivityAt: new Date(started.getTime() + 6 * H),
      description: 'Curative intervention. SLA: 8 h to restore.',
    });
  }

  // --- The dependency chain: site access badges, blocked by a supplier amendment
  const badges = add({
    summary: 'Site access badges — Northern zone, batch 3',
    labels: ['lot-3', 'enabler'],
    resolved: false,
    startedAt: day(-21, 10),
    dueAt: day(2, 17),
    resolvedAt: null,
    lastActivityAt: day(-9, 15),
    description: 'Physical access badges for the 14 Northern-zone sites added in September. Without them, Boreal crews need a Nordlink escort on site, which adds 1–2 h per intervention.',
  });
  const amendment = add({
    summary: 'Badge supplier contract amendment (SecurePass)',
    labels: ['procurement'],
    resolved: false,
    startedAt: day(-24, 10),
    dueAt: day(-6, 17),
    resolvedAt: null,
    lastActivityAt: day(-9, 15),
    description: 'Amendment to add 14 sites to the SecurePass badge contract. Waiting for legal review since the 20th.',
  });

  // --- The contradiction: part of lot 3 quietly moved to another vendor
  const contradiction = add({
    summary: 'Reassign 4 Northern-zone interventions to Helios Services',
    labels: ['lot-3', 'vendor-helios', 'dispatch'],
    resolved: false,
    startedAt: day(-1, 11),
    dueAt: day(3, 17),
    resolvedAt: null,
    lastActivityAt: day(-1, 11),
    description: 'Boreal is over capacity; routing four open Northern-zone jobs to Helios as a stop-gap. (Not reviewed against the September steering committee decision.)',
  });

  // --- Monthly report task (O-4), healthy
  add({
    summary: 'Monthly service report — Meridian, current period',
    labels: ['reporting', 'lot-3', 'lot-2', 'lot-1'],
    resolved: false,
    startedAt: day(-2, 9),
    dueAt: day(21, 17),
    resolvedAt: null,
    lastActivityAt: day(-1, 9),
    description: 'J+5 service report covering all lots.',
  });

  const links = [{ type: 'Blocks', outward: amendment.id, inward: badges.id }];

  const contract = {
    name: 'Meridian Telecom — Curative maintenance, fixed network 2026',
    counterparty: DEMO.client,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    currency: 'EUR',
    notes: 'Four geographic lots. Lot 3 (Northern zone) subcontracted to Boreal Interventions. Monthly invoice basis ≈ €2.0M.',
    is_demo: 1,
  };

  const obligations = [
    {
      ref: 'O-1', code: 'O-1', title: 'Restoration ≤ 8 h on 98 % of lot 1 interventions',
      description: 'Curative interventions on lot 1 (Western zone) restored within 8 hours for at least 98 % of cases over the contractual period.',
      metric_type: 'ratio_within_sla', jql_scope: `project = "${DEMO.projectKey}" AND labels = lot-1 AND labels = intervention`,
      sla_hours: 8, threshold: 0.98, period: 'custom', penalty_type: 'fixed', penalty_value: 5000, invoice_basis: null,
      status: 'active', healthy: true,
    },
    {
      ref: 'O-2', code: 'O-2', title: 'Repeat-fault rate ≤ 5 % (lot 2)',
      description: 'No more than 5 % of interventions re-opened within 7 days.',
      metric_type: 'count_max', jql_scope: `project = "${DEMO.projectKey}" AND labels = lot-2 AND labels = reopened`,
      sla_hours: null, threshold: 3, period: 'custom', penalty_type: 'fixed', penalty_value: 8000, invoice_basis: null,
      status: 'active', healthy: true,
    },
    {
      ref: 'O-3', code: 'O-3', title: 'Restoration ≤ 4 h on 95 % of lot 3 interventions',
      description: 'Curative interventions on lot 3 (Northern zone) restored within 4 hours for at least 95 % of cases over the contractual period. Below threshold: 2 % penalty on the monthly invoice.',
      metric_type: 'ratio_within_sla', jql_scope: `project = "${DEMO.projectKey}" AND labels = lot-3 AND labels = intervention`,
      sla_hours: 4, threshold: 0.95, period: 'custom', penalty_type: 'percent_of_invoice', penalty_value: 2, invoice_basis: 2_000_000,
      status: 'active', healthy: false,
    },
    {
      ref: 'O-4', code: 'O-4', title: 'Monthly service report delivered by J+5',
      description: 'Consolidated service report delivered within five working days of period end.',
      metric_type: 'deadline', jql_scope: `project = "${DEMO.projectKey}" AND labels = reporting`,
      sla_hours: null, threshold: null, period: 'custom', penalty_type: 'fixed', penalty_value: 2500, invoice_basis: null,
      status: 'active', healthy: true,
    },
  ];

  const decisions = [
    {
      ref: 'D-5', title: 'D-5 · Service reports produced from Confluence exports',
      statement: 'Monthly service reports for Meridian are produced from the Confluence reporting space rather than the legacy spreadsheet.',
      rationale: 'One source of truth; the spreadsheet had diverged twice in Q2.',
      decided_at: day(-92, 14), source_type: 'confluence_page', pageRef: 'd5',
      alternatives_rejected: [{ label: 'Keep the spreadsheet', reason: 'Two reconciliation incidents in Q2.' }],
      assumptions: [
        { statement: 'The reporting task is created at period start and owned by the service manager.', kind: 'freeform', params: {} },
      ],
      obligationRefs: ['O-4'],
    },
    {
      ref: 'D-6', title: 'D-6 · Lot 2 repeat-fault programme',
      statement: 'Repeat faults on lot 2 are root-caused weekly with the equipment vendor until the rate stays under 3 % for two consecutive months.',
      rationale: 'Lot 2 breached O-2 in May.',
      decided_at: day(-78, 10), source_type: 'confluence_page', pageRef: 'd6',
      alternatives_rejected: [{ label: 'Swap line cards fleet-wide', reason: 'Capex not approved.' }],
      assumptions: [
        { statement: 'Equipment vendor attends the weekly review.', kind: 'freeform', params: {} },
      ],
      obligationRefs: ['O-2'],
    },
    {
      ref: 'D-7', title: 'D-7 · Lot 3 stays with Boreal Interventions (Sept. steering committee)',
      statement: 'Lot 3 (Northern zone) remains subcontracted to Boreal Interventions rather than being brought in-house for Q4.',
      rationale: 'In-housing would need two HV-qualified hires before December; Boreal has the crews and the local knowledge. Decision holds provided Boreal keeps capacity and Nordlink keeps HV cover.',
      decided_at: day(-70, 15), source_type: 'confluence_page', pageRef: 'd7',
      alternatives_rejected: [
        { label: 'Bring lot 3 in-house in Q4', reason: 'Two HV hires needed by December; recruitment lead time 4–5 months.' },
        { label: 'Split lot 3 between Boreal and Helios', reason: 'Helios has no HV-qualified crew in the Northern zone; contract would need a novation.' },
      ],
      assumptions: [
        { statement: 'Boreal keeps no more than 25 open interventions across all lots.', kind: 'capacity', params: { teamRef: 'vendor-boreal', maxOpenIssues: 25 } },
        { statement: 'Karim Benali (only HV-qualified engineer on the Nordlink side) is available to the Northern zone until the end of the period.', kind: 'person_available', params: { personRef: DEMO.people.karim.ref, displayName: DEMO.people.karim.name, until: window.endsOn } },
        { statement: 'Site access badges for the September sites are delivered before the badge deadline.', kind: 'dependency_done_by', params: { issueRef: badges.id, date: ymd(day(2)) } },
        { statement: 'Northern-zone interventions are routed to Boreal, not to another vendor.', kind: 'routing', params: { scopeJql: `project = "${DEMO.projectKey}" AND labels = lot-3 AND statusCategory != Done`, labelPrefix: 'vendor-', expected: 'vendor-boreal' } },
      ],
      obligationRefs: ['O-3'],
    },
  ];

  const availability = [
    {
      account_id: DEMO.people.karim.ref, display_name: DEMO.people.karim.name, kind: 'reassigned',
      starts_on: ymd(day(-3)), ends_on: ymd(day(30)), note: 'Reassigned to the lot 1 ramp-up (Western zone) by ops planning.',
    },
    {
      account_id: DEMO.people.lena.ref, display_name: DEMO.people.lena.name, kind: 'leave',
      starts_on: ymd(day(20)), ends_on: ymd(day(27)), note: 'Annual leave.',
    },
  ];

  const pages = {
    d5: { title: 'Steering committee — service reporting (D-5)', body: decisionPage(decisions[0], T) },
    d6: { title: 'Steering committee — lot 2 repeat faults (D-6)', body: decisionPage(decisions[1], T) },
    d7: { title: 'Steering committee minutes — September (D-7, lot 3 sourcing)', body: decisionPage(decisions[2], T) },
  };

  return { today: now, window, issues, links, contract, obligations, decisions, availability, pages, special: { badges: badges.id, amendment: amendment.id, contradiction: contradiction.id } };
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decisionPage(d, T) {
  const date = d.decided_at.toISOString().slice(0, 10);
  return `
<p><strong>Date:</strong> ${date} · <strong>Attendees:</strong> Nordlink ops director, service manager, Boreal account lead, Meridian contract manager</p>
<h2>Decision</h2>
<p>${esc(d.statement)}</p>
<h2>Rationale</h2>
<p>${esc(d.rationale)}</p>
<h2>Alternatives considered</h2>
<ul>${d.alternatives_rejected.map((a) => `<li><strong>${esc(a.label)}</strong> — ${esc(a.reason)}</li>`).join('')}</ul>
<h2>Assumptions this decision rests on</h2>
<ul>${d.assumptions.map((a) => `<li>${esc(a.statement)}</li>`).join('')}</ul>
<p><em>Recorded in Antemortem as a decision with monitored assumptions.</em></p>`;
}

/** Jira field payload for one scenario issue. */
export function issueFields(spec, projectKey, issueTypeId) {
  return {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary: spec.summary,
    labels: spec.labels,
    duedate: spec.dueAt ? ymd(spec.dueAt) : undefined,
    description: {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: spec.description }] }],
    },
  };
}

/** The `antemortem` issue property for one scenario issue. */
export function issueProperty(spec) {
  return {
    demo: true,
    startedAt: iso(spec.startedAt),
    dueAt: spec.dueAt ? iso(spec.dueAt) : null,
    resolvedAt: spec.resolvedAt ? iso(spec.resolvedAt) : null,
    lastActivityAt: iso(spec.lastActivityAt),
  };
}
