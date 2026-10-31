/**
 * Signal detectors — each one is a pure-ish async function that looks at one
 * slice of the graph and returns zero or more signals. A signal carries
 * enough `evidence` to write a timeline sentence without another query.
 *
 * Signal shape:
 * { type, severity (1–5), subject_type, subject_id, fingerprint, detected_at, evidence }
 *
 * `fingerprint` makes detection idempotent across runs: the same situation
 * yields the same fingerprint, so the signal is updated rather than
 * duplicated, and signals that stop being detected are resolved.
 *
 * Detectors never throw: a failure becomes a `detector_error` signal of
 * severity 1 so the run completes and the problem is visible.
 */

const H = 3600_000;
/** Short stable hash so fingerprints stay under the column width whatever the key list. */
const shortHash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };

const D = 24 * H;
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const ymd = (d) => iso(d)?.slice(0, 10);

// ---------------------------------------------------------------------------
// Direct signals on an obligation
// ---------------------------------------------------------------------------

/** obligation_trend — the measured or projected value misses the bar. */
export function detectObligationTrend({ obligation, metric, now, minSample = 10 }) {
  if (metric.kind === 'custom' || metric.holds && metric.projectedHolds) return [];
  // A ratio over a handful of issues is noise, not a trend.
  if ((metric.kind === 'ratio_within_sla' || metric.kind === 'jsm_sla') && (metric.detail?.resolved ?? 0) < minSample) return [];
  let severity;
  if (!metric.holds && !metric.projectedHolds) severity = metric.margin != null && metric.margin < -0.05 ? 5 : 4;
  else if (!metric.holds) severity = 3;
  else severity = 2; // holds today, projected to slip
  return [{
    type: 'obligation_trend',
    severity,
    subject_type: 'obligation',
    subject_id: obligation.id,
    fingerprint: `obligation_trend:${obligation.id}:${ymd(metric.window.end)}`,
    detected_at: now,
    evidence: {
      code: obligation.code,
      metric: metric.kind,
      current: metric.current,
      projected: metric.projected,
      threshold: metric.threshold,
      periodEnd: ymd(metric.window.end),
      ...metric.detail,
    },
  }];
}

/** stale_critical_issue — open issue in scope, no activity for N days, due soon or overdue. */
export function detectStaleCriticalIssues({ obligation, issues, now, staleDays = 7 }) {
  const out = [];
  for (const i of issues) {
    if (i.resolvedAt || i.status.category === 'done') continue;
    const idle = (now - i.lastActivityAt) / D;
    const dueIn = i.dueAt ? (i.dueAt - now) / D : null;
    if (idle >= staleDays && dueIn != null && dueIn <= 3) {
      out.push({
        type: 'stale_critical_issue',
        severity: dueIn < 0 ? 4 : 3,
        subject_type: 'obligation',
        subject_id: obligation.id,
        fingerprint: `stale_critical_issue:${obligation.id}:${i.key}`,
        detected_at: now,
        evidence: { code: obligation.code, issueKey: i.key, summary: i.summary, idleDays: Math.floor(idle), dueOn: ymd(i.dueAt), overdue: dueIn < 0 },
      });
    }
  }
  return out;
}

/** single_point_of_failure — too much of the open scope sits on one person. */
export function detectSinglePointOfFailure({ obligation, issues, now, minShare = 0.5, minCount = 3 }) {
  const open = issues.filter((i) => !i.resolvedAt && i.status.category !== 'done');
  if (open.length < minCount) return [];
  const byPerson = new Map();
  for (const i of open) for (const p of i.people) byPerson.set(p, (byPerson.get(p) ?? 0) + 1);
  const out = [];
  for (const [person, n] of byPerson) {
    const share = n / open.length;
    if (n >= minCount && share >= minShare) {
      out.push({
        type: 'single_point_of_failure',
        severity: 3,
        subject_type: 'obligation',
        subject_id: obligation.id,
        fingerprint: `single_point_of_failure:${obligation.id}:${person}`,
        detected_at: now,
        evidence: { code: obligation.code, personRef: person, openIssues: n, share: Math.round(share * 100) / 100, keys: open.filter((i) => i.people.includes(person)).map((i) => i.key) },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assumption checks — each returns { status: 'holding'|'shaken'|'broken', signals, evidence }
// ---------------------------------------------------------------------------

export async function checkAssumption({ assumption, decision, obligation, graph, now, window }) {
  const p = assumption.params ?? {};
  const base = { subject_type: 'assumption', subject_id: assumption.id, detected_at: now };
  const common = { assumptionId: assumption.id, assumption: assumption.statement, decisionId: decision?.id ?? null, decision: decision?.title ?? null, obligationCode: obligation?.code ?? null };

  try {
    switch (assumption.kind) {
      case 'capacity': {
        if (!p.teamRef || p.maxOpenIssues == null) return holding(common, 'incomplete parameters');
        const open = await graph.teamLoad(p.teamRef);
        const n = open.length;
        if (n > Number(p.maxOpenIssues)) {
          return {
            status: 'broken',
            evidence: { ...common, teamRef: p.teamRef, openIssues: n, maxOpenIssues: Number(p.maxOpenIssues) },
            signals: [{ ...base, type: 'assumption_capacity_exceeded', severity: n > Number(p.maxOpenIssues) * 1.2 ? 4 : 3, fingerprint: `assumption_capacity_exceeded:${assumption.id}`, evidence: { ...common, teamRef: p.teamRef, openIssues: n, maxOpenIssues: Number(p.maxOpenIssues), sampleKeys: open.slice(0, 8).map((i) => i.key) } }],
          };
        }
        if (n >= Number(p.maxOpenIssues) * 0.9) return { status: 'shaken', evidence: { ...common, teamRef: p.teamRef, openIssues: n, maxOpenIssues: Number(p.maxOpenIssues) }, signals: [] };
        return holding({ ...common, teamRef: p.teamRef, openIssues: n, maxOpenIssues: Number(p.maxOpenIssues) });
      }

      case 'person_available': {
        if (!p.personRef) return holding(common, 'incomplete parameters');
        const until = p.until ? new Date(`${String(p.until).slice(0, 10)}T23:59:59Z`) : window?.end ?? new Date(now.getTime() + 30 * D);
        const absences = await graph.personAvailability(p.personRef, now, until);
        if (!absences.length) return holding({ ...common, personRef: p.personRef, until: ymd(until) });
        // Which in-scope open issues does this person hold?
        const held = (window?.issues ?? []).filter((i) => !i.resolvedAt && i.status.category !== 'done' && i.people.includes(p.personRef));
        const a = absences[0];
        const ongoing = a.startsOn <= now;
        return {
          status: 'broken',
          evidence: { ...common, personRef: p.personRef, displayName: p.displayName ?? a.displayName ?? p.personRef, absence: { kind: a.kind, startsOn: ymd(a.startsOn), endsOn: ymd(a.endsOn), note: a.note }, heldIssues: held.map((i) => i.key) },
          signals: [{ ...base, type: 'assumption_person_unavailable', severity: held.length ? 4 : 3, fingerprint: `assumption_person_unavailable:${assumption.id}:${ymd(a.startsOn)}`, evidence: { ...common, personRef: p.personRef, displayName: p.displayName ?? a.displayName ?? p.personRef, kind: a.kind, startsOn: ymd(a.startsOn), endsOn: ymd(a.endsOn), note: a.note, ongoing, heldIssues: held.map((i) => i.key) } }],
        };
      }

      case 'dependency_done_by': {
        if (!p.issueKey) return holding(common, 'incomplete parameters');
        const [issue] = await graph.issuesByKeys([p.issueKey]);
        if (!issue) return { status: 'shaken', evidence: { ...common, issueKey: p.issueKey, note: 'issue not found' }, signals: [] };
        if (issue.resolvedAt || issue.status.category === 'done') return holding({ ...common, issueKey: p.issueKey, resolvedOn: ymd(issue.resolvedAt) });
        const deadline = p.date ? new Date(`${String(p.date).slice(0, 10)}T23:59:59Z`) : issue.dueAt;
        const daysLeft = deadline ? (deadline - now) / D : null;
        const blockers = issue.blockedBy.length ? await graph.issuesByKeys(issue.blockedBy) : [];
        const openBlockers = blockers.filter((b) => !b.resolvedAt && b.status.category !== 'done');
        const stalest = openBlockers.map((b) => ({ key: b.key, summary: b.summary, idleDays: Math.floor((now - b.lastActivityAt) / D), dueOn: ymd(b.dueAt), overdue: b.dueAt ? b.dueAt < now : false })).sort((x, y) => y.idleDays - x.idleDays);
        const overdue = daysLeft != null && daysLeft < 0;
        const atRisk = overdue || openBlockers.length > 0 || (daysLeft != null && daysLeft <= 3 && (now - issue.lastActivityAt) / D >= 3);
        const ev = { ...common, issueKey: issue.key, summary: issue.summary, status: issue.status.name, deadline: ymd(deadline), daysLeft: daysLeft == null ? null : Math.floor(daysLeft), idleDays: Math.floor((now - issue.lastActivityAt) / D), blockedBy: stalest };
        if (!atRisk) return daysLeft != null && daysLeft <= 7 ? { status: 'shaken', evidence: ev, signals: [] } : holding(ev);
        return {
          status: 'broken',
          evidence: ev,
          signals: [{ ...base, type: 'assumption_dependency_slipping', severity: overdue ? 5 : openBlockers.length ? 4 : 3, fingerprint: `assumption_dependency_slipping:${assumption.id}:${issue.key}`, evidence: ev }],
        };
      }

      case 'routing': {
        if (!p.scopeJql || !p.labelPrefix || !p.expected) return holding(common, 'incomplete parameters');
        const issues = await graph.issuesInScope(p.scopeJql);
        const divergent = issues.filter((i) => i.labels.some((l) => l.startsWith(p.labelPrefix) && l !== p.expected));
        if (!divergent.length) return holding({ ...common, scope: p.scopeJql, expected: p.expected, checked: issues.length });
        return {
          status: 'broken',
          evidence: { ...common, expected: p.expected, divergent: divergent.map((i) => ({ key: i.key, summary: i.summary, label: i.labels.find((l) => l.startsWith(p.labelPrefix) && l !== p.expected), since: ymd(i.startedAt) })) },
          signals: [{ ...base, type: 'decision_contradicted', severity: 4, subject_type: 'decision', subject_id: decision?.id ?? assumption.decision_id, fingerprint: `decision_contradicted:${assumption.id}:${shortHash(divergent.map((i) => i.key).sort().join(','))}`, evidence: { ...common, expected: p.expected, divergent: divergent.map((i) => ({ key: i.key, summary: i.summary, label: i.labels.find((l) => l.startsWith(p.labelPrefix) && l !== p.expected), since: ymd(i.startedAt) })) } }],
        };
      }

      case 'obligation_holds':
      case 'freeform':
      default:
        return holding(common, 'not monitored automatically');
    }
  } catch (err) {
    return {
      status: 'shaken',
      evidence: { ...common, error: String(err?.message ?? err) },
      signals: [{ ...base, type: 'detector_error', severity: 1, fingerprint: `detector_error:${assumption.id}`, evidence: { ...common, error: String(err?.message ?? err) } }],
    };
  }
}

const holding = (evidence, note) => ({ status: 'holding', evidence: note ? { ...evidence, note } : evidence, signals: [] });

/**
 * person_silent — de-facto unavailability: someone holds several open
 * in-scope issues and none of them has moved for N days. No calendar
 * needed; the work itself says the person is not there.
 */
export function detectSilentAssignees({ obligation, issues, now, silentDays = 5, minHeld = 2 }) {
  const open = issues.filter((i) => !i.resolvedAt && i.status.category !== 'done');
  const byPerson = new Map();
  for (const i of open) for (const p of i.people) { if (!byPerson.has(p)) byPerson.set(p, []); byPerson.get(p).push(i); }
  const out = [];
  for (const [person, held] of byPerson) {
    if (held.length < minHeld) continue;
    const idle = Math.min(...held.map((i) => (now - i.lastActivityAt) / D));
    if (idle < silentDays) continue;
    out.push({
      type: 'person_silent',
      severity: idle >= silentDays * 2 ? 4 : 3,
      subject_type: 'obligation',
      subject_id: obligation.id,
      fingerprint: `person_silent:${obligation.id}:${person}`,
      detected_at: now,
      evidence: { code: obligation.code, personRef: person, heldIssues: held.map((i) => i.key), idleDays: Math.floor(idle), since: ymd(new Date(now.getTime() - idle * D)) },
    });
  }
  return out;
}
