import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Callout, fmtDate, fmtDateTime, fmtMoney, pretty } from '../ui.jsx';
import { IncidentCard } from './Incidents.jsx';

/**
 * Overview — week 3: forecasts per obligation, with the causal signals the
 * engine found. Week 4 turns the top forecast into a published post-mortem
 * and adds the averted ledger.
 */
export default function Overview({ overview, busy, onRunAnalysis, onRepair, onTab, notify, refresh }) {
  const { schema, settings, lastRun, counts, demo } = overview;
  const [forecasts, setForecasts] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [health, setHealth] = useState(false);

  useEffect(() => {
    api.listForecasts().then((r) => setForecasts(r.ok ? r.forecasts : []));
    api.listIncidents().then((r) => setIncidents(r.ok ? r.open : []));
  }, [lastRun?.id, counts.forecast, counts.future_incident]);

  const configured = Boolean(settings.confluenceSpaceKey && settings.actionsProjectKey);
  const modelObjects = (counts.obligation ?? 0) + (counts.decision ?? 0);
  const atRisk = (forecasts ?? []).filter((f) => f.forecast && !f.forecast.healthy && f.forecast.probability >= 0.3).sort((a, b) => b.forecast.probability - a.forecast.probability);
  const next = atRisk[0] ?? null;
  const daysTo = next ? Math.ceil((new Date(next.forecast.projected_breach_date) - Date.now()) / 86400_000) : null;
  const totalAtRisk = atRisk.reduce((n, f) => n + (f.forecast.projected_cost ?? 0), 0);

  return (
    <>
      <section className="hero">
        <div>
          <p className={`dateline ${next ? 'risk' : ''}`}>
            {next ? `Projected for ${new Date(next.forecast.projected_breach_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}` : modelObjects ? `As of ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Nothing analysed yet'}
          </p>
          <h1>
            {next ? `The next post-mortem is ${daysTo} day${daysTo === 1 ? '' : 's'} away.` : modelObjects ? 'No incident on the horizon.' : 'Nothing to forecast yet.'}
          </h1>
          <p className="lede">
            {next ? (
              <>
                <strong>{next.obligation.code}</strong> — {next.obligation.title}. Probability{' '}
                <strong>{Math.round(next.forecast.probability * 100)} %</strong>, projected cost{' '}
                <strong>{fmtMoney(next.forecast.projected_cost, next.forecast.currency)}</strong> on {fmtDate(next.forecast.projected_breach_date)}.
                {atRisk.length > 1 && ` ${atRisk.length - 1} more obligation${atRisk.length > 2 ? 's are' : ' is'} at risk, ${fmtMoney(totalAtRisk)} at stake in total.`}
              </>
            ) : modelObjects ? (
              'Every active obligation holds, and the assumptions behind the decisions they depend on still stand.'
            ) : (
              <>Antemortem writes the post-mortem of an incident <em>before</em> it happens. Load the demo from <button className="linklike" onClick={() => onTab('settings')}>Settings</button>, then run the analysis.</>
            )}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={onRunAnalysis} disabled={busy !== null || !schema.ok}>
            {busy === 'analysis' ? 'Analysing…' : 'Run analysis now'}
          </button>
          <button className="btn subtle" onClick={() => setHealth(!health)}>{health ? 'Hide health' : 'Health'}</button>
        </div>
      </section>

      {demo?.status === 'running' && <Callout kind="info" title="Demo scenario is loading">Follow progress in Settings.</Callout>}
      {lastRun?.status === 'failed' && <Callout kind="warn" title="Last analysis failed"><pre className="warn">{lastRun.error}</pre></Callout>}

      {incidents.map((fi) => <IncidentCard key={fi.id} incident={fi} notify={notify} onChanged={refresh} />)}

      {forecasts === null ? <p className="muted">Loading forecasts…</p> : forecasts.length > 0 && (
        <section className="list">
          {[...atRisk, ...forecasts.filter((f) => !atRisk.includes(f))].map((f) => <ForecastRow key={f.obligation.id} item={f} />)}
        </section>
      )}

      {health && (
        <section className="grid" style={{ marginTop: 24 }}>
          <Card title="Storage" status={schema.ok ? 'ok' : 'warn'} statusLabel={schema.ok ? 'Schema complete' : `${schema.missing.length} migration(s) pending`} actions={<button className="linklike" onClick={onRepair} disabled={busy !== null}>{busy === 'repair' ? 'Repairing…' : 'Repair'}</button>}>
            <table className="table"><tbody>
              {schema.tables.map((t) => (
                <tr key={t.table}><td><code>{t.table}</code></td><td className="num">{t.ok ? t.rows : '—'}</td><td className={t.ok ? 'ok' : 'warn'}>{t.ok ? 'ready' : 'missing'}</td></tr>
              ))}
            </tbody></table>
          </Card>
          <Card title="Engine" status={lastRun ? (lastRun.status === 'done' ? 'ok' : 'warn') : 'idle'} statusLabel={lastRun ? `Last run ${fmtDateTime(lastRun.started_at)} · ${lastRun.status}` : 'Never run'}>
            {lastRun ? (
              <dl className="kv">
                <dt>Triggered by</dt><dd>{lastRun.trigger_source}</dd>
                <dt>Finished</dt><dd>{fmtDateTime(lastRun.finished_at)}</dd>
                <dt>Summary</dt><dd><pre>{pretty(lastRun.summary)}</pre></dd>
              </dl>
            ) : <p className="hint">The hourly schedule runs the engine automatically.</p>}
          </Card>
          <Card title="Configuration" status={configured ? 'ok' : 'warn'} statusLabel={configured ? 'Configured' : 'Not configured'}>
            <dl className="kv">
              <dt>Confluence space</dt><dd>{settings.confluenceSpaceKey ?? <span className="muted">not set</span>}</dd>
              <dt>Jira project</dt><dd>{settings.actionsProjectKey ?? <span className="muted">not set</span>}</dd>
              <dt>Publish threshold</dt><dd>{settings.publishThreshold}</dd>
              <dt>Graph source</dt><dd>{settings.graphSource}</dd>
              <dt>Demo</dt><dd>{settings.demoLoaded ? `loaded ${fmtDateTime(settings.demoLoadedAt)}` : 'not loaded'}</dd>
            </dl>
          </Card>
          <Card title="Model" status={modelObjects ? 'ok' : 'idle'} statusLabel={`${modelObjects} objects`}>
            <dl className="kv compact">
              <dt>Contracts</dt><dd>{counts.contract ?? 0}</dd>
              <dt>Obligations</dt><dd>{counts.obligation ?? 0}</dd>
              <dt>Decisions</dt><dd>{counts.decision ?? 0}</dd>
              <dt>Assumptions</dt><dd>{counts.assumption ?? 0}</dd>
              <dt>Links</dt><dd>{counts.link ?? 0}</dd>
              <dt>Open signals</dt><dd>{counts.risk_signal ?? 0}</dd>
            </dl>
          </Card>
        </section>
      )}
    </>
  );
}

const SIGNAL_LABEL = {
  obligation_trend: 'Metric trend',
  assumption_capacity_exceeded: 'Capacity exceeded',
  assumption_person_unavailable: 'Key person unavailable',
  assumption_dependency_slipping: 'Dependency slipping',
  decision_contradicted: 'Decision contradicted',
  stale_critical_issue: 'Stale critical issue',
  single_point_of_failure: 'Single point of failure',
  detector_error: 'Detector error',
};

function ForecastRow({ item }) {
  const { obligation: o, forecast: f, signals } = item;
  const [open, setOpen] = useState(false);
  const healthy = !f || f.healthy;
  const pct = f ? Math.round(f.probability * 100) : null;
  const m = f?.explanation?.metric;
  return (
    <article className={`row column forecast ${healthy ? 'healthy' : 'risk'}`}>
      <div className="row-head">
        <div className="row-main">
          <div className="row-title">
            <code className="code-pill">{o.code}</code>
            <strong>{o.title}</strong>
            {f ? <span className={`pill ${healthy ? 'ok' : pct >= 60 ? 'danger' : 'warn'}`}>{healthy ? 'holds' : `${pct} % by ${fmtDate(f.projected_breach_date)}`}</span> : <span className="pill idle">not analysed yet</span>}
          </div>
          {m && m.kind === 'ratio_within_sla' && (
            <div className="meter" title={`current ${Math.round(m.current * 100)} % · projected ${Math.round(m.projected * 100)} % · threshold ${Math.round(m.threshold * 100)} %`}>
              <div className="meter-bar"><span className="meter-cur" style={{ width: `${m.current * 100}%` }} /><span className="meter-proj" style={{ left: `${m.projected * 100}%` }} /><span className="meter-thr" style={{ left: `${m.threshold * 100}%` }} /></div>
              <div className="meter-legend muted small">{Math.round(m.current * 100)} % today, {Math.round(m.projected * 100)} % projected, {Math.round(m.threshold * 100)} % required</div>
            </div>
          )}
          {!healthy && signals.length > 0 && (
            <div className="signal-tags">{signals.map((s) => <span key={s.fingerprint} className={`tag-sig sev${s.severity}`}>{SIGNAL_LABEL[s.type] ?? s.type}</span>)}</div>
          )}
        </div>
        <div className="row-side">
          {!healthy && <div className="penalty">{fmtMoney(f.projected_cost, f.currency)}</div>}
          <div className="muted small">{f ? `analysed ${fmtDateTime(f.computed_at)}` : ''}</div>
          {f && !healthy && <button className="linklike" onClick={() => setOpen(!open)}>{open ? 'Hide chain' : 'Show chain'}</button>}
        </div>
      </div>
      {open && f && (
        <div className="chain">
          <ol className="timeline">
            {(f.chain ?? []).map((e, i) => (
              <li key={i} className={e.role}>
                <span className="tl-date">{fmtDate(e.at)}</span>
                <span className="tl-text">{chainText(e)}</span>
              </li>
            ))}
          </ol>
          <div className="explain muted small">
            {f.explanation?.steps?.map((s, i) => <div key={i}>{s.delta > 0 ? '+' : ''}{s.delta} — {s.label}</div>)}
            <div>cost: {f.explanation?.cost}</div>
          </div>
        </div>
      )}
    </article>
  );
}

function chainText(e) {
  const ev = e.evidence ?? {};
  switch (e.role) {
    case 'root': return `Decision: ${e.title}`;
    case 'projection': return `Projected breach of ${e.obligationCode}: ${Math.round((e.metric?.projected ?? 0) * 100)} % vs ${Math.round((e.metric?.threshold ?? 0) * 100)} % — ${fmtMoney(e.cost, e.currency)} (${Math.round(e.probability * 100)} %)`;
    case 'measurement': return `${ev.code}: ${Math.round(ev.current * 100)} % within SLA today, ${Math.round(ev.projected * 100)} % projected (${ev.open} open, ${ev.openNearSla?.length ?? 0} near the SLA)`;
    default:
      switch (e.kind) {
        case 'assumption_capacity_exceeded': return `${ev.teamRef}: ${ev.openIssues} open issues, assumption was ≤ ${ev.maxOpenIssues}`;
        case 'assumption_person_unavailable': return `${ev.displayName} ${ev.kind} ${fmtDate(ev.startsOn)} → ${fmtDate(ev.endsOn)}${ev.heldIssues?.length ? `, still holds ${ev.heldIssues.join(', ')}` : ''}${ev.note ? ` — ${ev.note}` : ''}`;
        case 'assumption_dependency_slipping': return `${ev.issueKey} "${ev.summary}" due ${fmtDate(ev.deadline)}${ev.blockedBy?.length ? `, blocked by ${ev.blockedBy[0].key} (no activity for ${ev.blockedBy[0].idleDays} days)` : ''}`;
        case 'decision_contradicted': return `${ev.divergent?.[0]?.key} "${ev.divergent?.[0]?.summary}" routes work to ${ev.divergent?.[0]?.label}, contradicting "${ev.decision}"`;
        case 'stale_critical_issue': return `${ev.issueKey} idle for ${ev.idleDays} days, due ${fmtDate(ev.dueOn)}`;
        case 'single_point_of_failure': return `${ev.personRef} holds ${ev.openIssues} of the open issues (${Math.round(ev.share * 100)} %)`;
        default: return e.kind;
      }
  }
}
