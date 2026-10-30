/**
 * Narrative — turns one obligation's analysis into a post-mortem written
 * in the future tense of the past: the format every reader already knows,
 * with a date that hasn't happened yet.
 *
 * Deterministic templates, no model. Every sentence is derived from a piece
 * of evidence that exists today, and the Evidence section lists all of them
 * so the reader can click through.
 *
 * Output is structured (`sections`) so the same content can be rendered to
 * Confluence storage format (render/confluence.js) and to the command
 * center (React) without duplicating the wording.
 */

const H = 3600_000;
const D = 24 * H;

export function composeIncident({ obligation, contract, decisions, metric, signals, assumptionResults, forecast, chain, now = new Date(), siteUrl = '' }) {
  const breach = forecast.projected_breach_date;
  const pct = Math.round(forecast.probability * 100);
  const money = fmtMoney(forecast.projected_cost, forecast.currency);
  const bySignal = Object.fromEntries(signals.map((s) => [s.type, s]));
  const trend = bySignal.obligation_trend?.evidence ?? {};
  const scopeLabel = scopeName(obligation);
  const title = `Incident ${breach} — ${contract?.counterparty ?? contract?.name ?? 'Contract'}, ${obligation.code} breach`;

  // --- Impact -------------------------------------------------------------
  const impact = [];
  if (metric.kind === 'ratio_within_sla') {
    impact.push(`On ${longDate(breach)}, the contractual period for ${obligation.code} (${obligation.title}) closes with ${pctOf(metric.projected)} of ${scopeLabel} restored within ${metric.detail.slaHours} h, against the ${pctOf(metric.threshold)} required.`);
  } else if (metric.kind === 'deadline') {
    impact.push(`On ${longDate(breach)}, the deliverable required by ${obligation.code} (${obligation.title}) is not delivered.`);
  } else {
    impact.push(`On ${longDate(breach)}, ${obligation.code} (${obligation.title}) is breached: ${metric.current} against a limit of ${metric.threshold}.`);
  }
  impact.push(penaltySentence(obligation, forecast));

  // --- Root cause ---------------------------------------------------------
  const rootDecision = decisions[0] ?? null;
  const broken = assumptionResults.filter((a) => a.status === 'broken');
  const rootCause = [];
  if (rootDecision && broken.length) {
    rootCause.push(`The root cause is not a late ticket. It is a decision — "${rootDecision.title}" (${longDate(rootDecision.decided_at)}) — that rested on ${rootDecision.assumptions?.length ?? broken.length} assumptions, ${broken.length} of which no longer hold${broken.length === (rootDecision.assumptions?.length ?? broken.length) ? '' : ' today'}:`);
    for (const a of broken) rootCause.push(`• ${assumptionSentence(a)}`);
  } else if (trend.code) {
    rootCause.push(`The restoration rate on ${scopeLabel} fell below the contractual bar and the open workload did not allow a recovery before the period closed.`);
  } else {
    rootCause.push('Under investigation — the engine found a breach trajectory without an identified decision behind it.');
  }

  // --- Timeline (past = evidence, future = projection) --------------------
  const timeline = chain.map((e) => ({
    date: e.at,
    projected: e.role === 'projection' || (e.at && e.at > ymd(now)),
    text: timelineSentence(e, obligation, metric),
    link: linkFor(e, siteUrl),
  }));

  // --- Contributing factors: only what the root cause does not already say --
  const factors = [];
  if (trend.openNearSla?.length) {
    factors.push(`${trend.openNearSla.length} interventions are within an hour of the ${trend.slaHours} h limit (${trend.openNearSla.join(', ')}). ${trend.neededOnTimeToRecover} consecutive on-time restorations would be needed to get back above ${pctOf(metric.threshold)}.`);
  }
  if (bySignal.stale_critical_issue) {
    const ev = bySignal.stale_critical_issue.evidence;
    factors.push(`${ev.issueKey} "${ev.summary}" has had no activity for ${ev.idleDays} days and is due ${longDate(ev.dueOn)}.`);
  }
  if (bySignal.person_silent) {
    const ev = bySignal.person_silent.evidence;
    factors.push(`${personName(ev.personRef)} holds ${ev.heldIssues.length} open issues with no activity for ${ev.idleDays} days.`);
  }
  if (bySignal.single_point_of_failure) {
    const ev = bySignal.single_point_of_failure.evidence;
    factors.push(`${personName(ev.personRef)} holds ${ev.openIssues} of the open issues (${Math.round(ev.share * 100)} %).`);
  }
  if (!broken.length) {
    if (bySignal.assumption_capacity_exceeded) { const ev = bySignal.assumption_capacity_exceeded.evidence; factors.push(`${vendorName(ev.teamRef)} carries ${ev.openIssues} open issues against an assumed ceiling of ${ev.maxOpenIssues}.`); }
    if (bySignal.assumption_person_unavailable) { const ev = bySignal.assumption_person_unavailable.evidence; factors.push(`${ev.displayName} is ${ev.kind} from ${longDate(ev.startsOn)} to ${longDate(ev.endsOn)} while holding ${ev.heldIssues?.length ?? 0} open ${scopeLabel}.`); }
    if (bySignal.assumption_dependency_slipping) { const ev = bySignal.assumption_dependency_slipping.evidence; const b = ev.blockedBy?.[0]; factors.push(`${ev.issueKey} "${ev.summary}" is due ${longDate(ev.deadline)}${b ? ` and blocked by ${b.key}, idle for ${b.idleDays} days` : ''}.`); }
    if (bySignal.decision_contradicted) { const ev = bySignal.decision_contradicted.evidence; const d = ev.divergent?.[0]; factors.push(`${d?.key} "${d?.summary}" routes ${scopeLabel} to ${vendorName(d?.label)}, contrary to "${ev.decision}".`); }
  }

  // --- Corrective actions ("what would have prevented it") ----------------
  const actions = correctiveActions({ obligation, signals, assumptionResults, scopeLabel });

  // --- Evidence -----------------------------------------------------------
  const uniqueEvidence = rootDecision ? [{ label: rootDecision.title, url: rootDecision.source_url ? absolute(rootDecision.source_url, siteUrl) : null, type: 'decision' }] : [];

  // --- How this was computed ---------------------------------------------
  const method = [
    `Period ${ymd(metric.window.start)} to ${ymd(metric.window.end)}: ${metric.detail.within ?? metric.current} of ${metric.detail.resolved ?? '—'} resolved within SLA (${pctOf(metric.current)}); ${metric.detail.open ?? 0} open, ${metric.detail.openLikelyOk ?? 0} likely on time; projected ${pctOf(metric.projected)}.`,
    ...(forecast.explanation?.steps ?? []).map((s) => `${s.delta > 0 ? '+' : ''}${s.delta} ${s.label.toLowerCase()}`),
    `Sum, bounded to 0.05–0.98 = ${forecast.probability}. Cost: ${forecast.explanation?.cost ?? ''}.`,
  ];

  return {
    title,
    incidentDate: breach,
    probability: forecast.probability,
    cost: forecast.projected_cost,
    currency: forecast.currency,
    summary: impact[0],
    sections: { impact, rootCause, timeline, factors, actions, evidence: uniqueEvidence, method },
  };
}

// ---------------------------------------------------------------------------
// Corrective actions — one per signal type, phrased for the Jira summary
// ---------------------------------------------------------------------------

export function correctiveActions({ obligation, signals, scopeLabel }) {
  const out = [];
  const seen = new Set();
  const add = (key, title, description, prevents) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, title, description, prevents_signal_types: prevents });
  };
  for (const s of signals) {
    const ev = s.evidence ?? {};
    switch (s.type) {
      case 'assumption_dependency_slipping': {
        const b = ev.blockedBy?.[0];
        add(`unblock:${ev.issueKey}`, b ? `Unblock ${b.key} so that ${ev.issueKey} lands by ${ev.deadline}` : `Deliver ${ev.issueKey} by ${ev.deadline}`, `${ev.issueKey} "${ev.summary}" conditions ${obligation.code}.${b ? ` It is blocked by ${b.key} "${b.summary}" (idle ${b.idleDays} days). Escalate the blocker or find an interim workaround.` : ''}`, ['assumption_dependency_slipping']);
        break;
      }
      case 'assumption_person_unavailable':
        add(`cover:${ev.personRef}`, `Restore ${ev.displayName} to ${scopeLabel}, or qualify a second engineer`, `${ev.displayName} is ${ev.kind} (${ev.startsOn} → ${ev.endsOn}) while holding ${(ev.heldIssues ?? []).join(', ') || 'open work'} that ${obligation.code} depends on. Reverse the reassignment for the period, or reassign the held issues to a qualified engineer.`, ['assumption_person_unavailable']);
        break;
      case 'assumption_capacity_exceeded':
        add(`cap:${ev.teamRef}`, `Bring ${vendorName(ev.teamRef)} back under ${ev.maxOpenIssues} open issues`, `${vendorName(ev.teamRef)} has ${ev.openIssues} open issues; the decision assumed at most ${ev.maxOpenIssues}. Defer preventive work or add a crew until the backlog is under the ceiling.`, ['assumption_capacity_exceeded']);
        break;
      case 'decision_contradicted':
        add(`decide:${ev.decisionId}`, `Decide: confirm or revise "${ev.decision?.split(' · ')[0] ?? 'the sourcing decision'}"`, `${(ev.divergent ?? []).map((d) => d.key).join(', ')} route work away from ${ev.expected}. Either record a revised decision (and its new assumptions) or revert the routing.`, ['decision_contradicted']);
        break;
      case 'obligation_trend':
        if (ev.openNearSla?.length) add(`triage:${obligation.id}`, `Triage the ${ev.openNearSla.length} interventions closest to the ${ev.slaHours} h limit`, `${ev.openNearSla.join(', ')} are near the SLA. Dispatch now; each one restored on time improves the ratio.`, ['obligation_trend']);
        break;
      case 'person_silent':
        add(`reach:${ev.personRef}`, `Reach ${personName(ev.personRef)} or reassign ${ev.heldIssues.join(', ')}`, `${personName(ev.personRef)} holds ${ev.heldIssues.length} open issues, none touched for ${ev.idleDays} days.`, ['person_silent']);
        break;
      case 'stale_critical_issue':
        add(`revive:${ev.issueKey}`, `Revive ${ev.issueKey} (idle ${ev.idleDays} days, due ${ev.dueOn})`, `${ev.issueKey} "${ev.summary}" has not moved and is due soon.`, ['stale_critical_issue']);
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

function timelineSentence(e, obligation, metric) {
  const ev = e.evidence ?? {};
  switch (e.role) {
    case 'root': return `Steering committee records "${e.title}".`;
    case 'measurement': return `${obligation.code} stands at ${pctOf(ev.current)} within SLA (${ev.within}/${ev.resolved}); ${ev.open} interventions open, ${ev.openNearSla?.length ?? 0} near the limit.`;
    case 'projection': return `Period closes at ${pctOf(e.metric?.projected)} against ${pctOf(e.metric?.threshold)}. ${obligation.code} is breached; penalty ${fmtMoney(e.cost, e.currency)}.`;
    default:
      switch (e.kind) {
        case 'assumption_dependency_slipping': {
          const b = ev.blockedBy?.[0];
          return b ? `Last activity on ${b.key} "${b.summary}" — the blocker of ${ev.issueKey} "${ev.summary}" (due ${ev.deadline}).` : `${ev.issueKey} "${ev.summary}" slips past ${ev.deadline}.`;
        }
        case 'assumption_person_unavailable': return `${ev.displayName} ${ev.kind} until ${ev.endsOn}${ev.note ? ` — ${String(ev.note).replace(/\.$/, '')}` : ''}${ev.heldIssues?.length ? `; still assigned ${ev.heldIssues.join(', ')}` : ''}.`;
        case 'decision_contradicted': return `${ev.divergent?.[0]?.key} "${ev.divergent?.[0]?.summary}" created, routing work to ${vendorName(ev.divergent?.[0]?.label)} — contrary to "${ev.decision}".`;
        case 'assumption_capacity_exceeded': return `${vendorName(ev.teamRef)} reaches ${ev.openIssues} open issues (assumed ceiling ${ev.maxOpenIssues}).`;
        case 'stale_critical_issue': return `${ev.issueKey} idle for ${ev.idleDays} days, due ${ev.dueOn}.`;
        case 'single_point_of_failure': return `${personName(ev.personRef)} holds ${Math.round(ev.share * 100)} % of the open work.`;
        case 'person_silent': return `No activity from ${personName(ev.personRef)} on ${ev.heldIssues.join(', ')}.`;
        default: return e.kind;
      }
  }
}

function assumptionSentence(a) {
  const ev = a.evidence ?? {};
  switch (a.kind) {
    case 'capacity': return `"${ev.assumption}" — ${vendorName(ev.teamRef)} is at ${ev.openIssues}.`;
    case 'person_available': return `"${ev.assumption}" — ${ev.displayName} is ${ev.absence?.kind ?? 'unavailable'} since ${ev.absence?.startsOn}.`;
    case 'dependency_done_by': return `"${ev.assumption}" — ${ev.issueKey} is ${ev.status}${ev.blockedBy?.length ? `, blocked by ${ev.blockedBy[0].key} (idle ${ev.blockedBy[0].idleDays} days)` : ''}, ${ev.daysLeft != null ? `${ev.daysLeft} day(s) to the deadline` : 'deadline unknown'}.`;
    case 'routing': return `"${ev.assumption}" — ${(ev.divergent ?? []).map((d) => `${d.key} → ${d.label}`).join(', ')}.`;
    default: return `"${ev.assumption}".`;
  }
}

function penaltySentence(o, f) {
  if (o.penalty_type === 'percent_of_invoice') return `The contract applies a ${o.penalty_value} % penalty on the monthly invoice (${fmtMoney(o.invoice_basis, f.currency)}): ${fmtMoney(f.projected_cost, f.currency)}.`;
  return `The contract applies a fixed penalty of ${fmtMoney(f.projected_cost, f.currency)}.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const ymd = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d).replace(' ', 'T')).slice(0, 10) : null);
export function longDate(d) {
  const s = ymd(d);
  if (!s) return '—';
  return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
export const pctOf = (v) => (v == null ? '—' : `${Math.round(v * 100)} %`);
export function fmtMoney(v, currency = 'EUR') {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}
const vendorName = (ref) => (ref ? String(ref).replace(/^vendor-/, '').replace(/^label:/, '').replace(/\b\w/g, (c) => c.toUpperCase()) : 'the vendor');
const personName = (ref) => (ref ? String(ref).replace(/^label:tech-/, '').replace(/\b\w/g, (c) => c.toUpperCase()) : 'one person');
function scopeName(o) {
  const m = /labels = (lot-\d+)/.exec(o.jql_scope ?? '');
  return m ? `${m[1].replace('-', ' ')} interventions` : 'interventions in scope';
}
function issueKeysIn(ev) {
  const keys = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (/^[A-Z][A-Z0-9_]+-\d+$/.test(v)) keys.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(ev);
  return [...keys];
}
const issueUrl = (key, siteUrl) => (siteUrl ? `${siteUrl.replace(/\/$/, '')}/browse/${key}` : null);
const absolute = (path, siteUrl) => (/^https?:/.test(path) ? path : siteUrl ? `${siteUrl.replace(/\/$/, '')}${path}` : path);
function linkFor(e, siteUrl) {
  if (e.role === 'root') return e.sourceUrl ? absolute(e.sourceUrl, siteUrl) : null;
  const ev = e.evidence ?? {};
  const key = ev.blockedBy?.[0]?.key ?? ev.issueKey ?? ev.divergent?.[0]?.key ?? ev.heldIssues?.[0] ?? null;
  return key ? issueUrl(key, siteUrl) : null;
}
