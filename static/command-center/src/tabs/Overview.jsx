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
                <strong>{next.obligation.code}</strong> — {next.obligation.title}.{' '}
                <strong>{Math.round(next.forecast.probability * 100)} %</strong>, <strong>{fmtMoney(next.forecast.projected_cost, next.forecast.currency)}</strong>.
                {atRisk.length > 1 && ` ${atRisk.length - 1} more at risk, ${fmtMoney(totalAtRisk)} in total.`}
              </>
            ) : modelObjects ? (
              'Every obligation holds.'
            ) : (
              <>Load the demo from <button className="linklike" onClick={() => onTab('settings')}>Settings</button>, then run the analysis.</>
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
  const [ignore, setIgnore] = useState([]);
  const [onTime, setOnTime] = useState(false);
  const [sim, setSim] = useState(null);
  const [history, setHistory] = useState(null);
  const toggle = async (fp) => {
    const next = ignore.includes(fp) ? ignore.filter((x) => x !== fp) : [...ignore, fp];
    setIgnore(next);
    await recompute(next, onTime);
  };
  const toggleOnTime = async () => { const v = !onTime; setOnTime(v); await recompute(ignore, v); };
  const recompute = async (ig, ot) => {
    if (!ig.length && !ot) { setSim(null); return; }
    setSim({ loading: true });
    setSim(await api.whatIf(o.id, ig, ot));
  };
  const loadHistory = async () => { setHistory({ loading: true }); setHistory(await api.backtest(o.id)); };
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
              <div className="meter-legend muted small">{Math.round(m.current * 100)} % → {Math.round(m.projected * 100)} %, required {Math.round(m.threshold * 100)} %</div>
            </div>
          )}
          {!healthy && signals.length > 0 && (
            <div className="signal-tags">{signals.map((s) => <span key={s.fingerprint} className={`tag-sig sev${s.severity}`}>{SIGNAL_LABEL[s.type] ?? s.type}</span>)}</div>
          )}
        </div>
        <div className="row-side">
          {!healthy && <div className="penalty">{fmtMoney(f.projected_cost, f.currency)}</div>}
          {f && !healthy && <button className="linklike" onClick={() => setOpen(!open)}>{open ? 'Hide chain' : 'Show chain'}</button>}
          {f && !healthy && <button className="linklike" onClick={() => (history ? setHistory(null) : loadHistory())}>{history ? 'Hide history' : 'History'}</button>}
        </div>
      </div>
      {history && <History data={history} />}
      {open && f && (
        <div className="chain">
          <ol className="timeline">
            {(f.chain ?? []).map((e, i) => {
              const fp = e.signalFingerprint;
              const fixable = e.role === 'event' && fp;
              const fixed = fp && ignore.includes(fp);
              return (
                <li key={i} className={`${e.role} ${fixed ? 'fixed' : ''}`}>
                  <span className="tl-date">{fmtDate(e.at)}</span>
                  <span className="tl-text">
                    {fixable && <input type="checkbox" className="whatif" checked={fixed} onChange={() => toggle(fp)} title="What if this were fixed?" />}
                    {chainText(e)}
                  </span>
                </li>
              );
            })}
            {m && m.kind === 'ratio_within_sla' && (
              <li className="measurement">
                <span className="tl-date" />
                <span className="tl-text"><input type="checkbox" className="whatif" checked={onTime} onChange={toggleOnTime} />every open issue restored within the SLA</span>
              </li>
            )}
          </ol>
          {sim && <WhatIf base={f} sim={sim} />}
          <div className="explain muted small">
            {f.explanation?.steps?.map((s, i) => <span key={i}>{s.delta > 0 ? '+' : ''}{s.delta} {s.label.toLowerCase()}{i < f.explanation.steps.length - 1 ? ' · ' : ''}</span>)}
            {' = '}{f.probability} · {f.explanation?.cost}
          </div>
        </div>
      )}
    </article>
  );
}

function WhatIf({ base, sim }) {
  if (sim.loading) return <p className="whatif-result muted small">Recomputing…</p>;
  if (!sim.ok) return <p className="whatif-result warn small">{sim.error}</p>;
  const p = Math.round(sim.forecast.probability * 100);
  const d = p - Math.round(base.probability * 100);
  const m = sim.metric;
  return (
    <p className="whatif-result">
      If so: <strong>{p} %</strong> ({d > 0 ? '+' : ''}{d} pts)
      {m?.kind === 'ratio_within_sla' && <>, projected {Math.round(m.projected * 100)} % against {Math.round(m.threshold * 100)} %</>}
      {sim.forecast.healthy || sim.forecast.probability <= 0.05 ? ' — no incident.' : `, ${fmtMoney(sim.forecast.projected_cost, sim.forecast.currency)}.`}
    </p>
  );
}

function History({ data }) {
  if (data.loading) return <p className="history muted small">Replaying the period…</p>;
  if (!data.ok) return <p className="history warn small">{data.error}</p>;
  const pts = data.points ?? [];
  if (!pts.length) return null;
  const W = 420; const H = 56; const pad = 4;
  const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (W - 2 * pad);
  const y = (p) => H - pad - p * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.probability).toFixed(1)}`).join(' ');
  const thr = y(data.threshold);
  return (
    <div className="history">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-label="Probability over the period">
        <line x1={pad} x2={W - pad} y1={thr} y2={thr} className="hist-thr" />
        <path d={line} className="hist-line" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.probability)} r="2.5" className={p.probability >= data.threshold ? 'hist-dot above' : 'hist-dot'} />)}
      </svg>
      <div className="hist-legend muted small">
        <span>{fmtDate(pts[0].at)}</span>
        <span>
          {data.firstAbove
            ? <>Would have been published on <strong>{fmtDate(data.firstAbove)}</strong>{data.leadDays != null ? `, ${data.leadDays} days before the breach` : ''}</>
            : 'Never crossed the publish threshold'}
        </span>
        <span>{fmtDate(pts[pts.length - 1].at)}</span>
      </div>
    </div>
  );
}

function chainText(e) {
  const ev = e.evidence ?? {};
  switch (e.role) {
    case 'root': return `Decision: ${e.title}`;
    case 'projection': return `${e.obligationCode} breached: ${Math.round((e.metric?.projected ?? 0) * 100)} % vs ${Math.round((e.metric?.threshold ?? 0) * 100)} % — ${fmtMoney(e.cost, e.currency)}`;
    case 'measurement': return `${ev.code} at ${Math.round(ev.current * 100)} %, projected ${Math.round(ev.projected * 100)} % (${ev.open} open, ${ev.openNearSla?.length ?? 0} near the limit)`;
    default:
      switch (e.kind) {
        case 'assumption_capacity_exceeded': return `${ev.teamRef} at ${ev.openIssues} open issues (ceiling ${ev.maxOpenIssues})`;
        case 'assumption_person_unavailable': return `${ev.displayName} ${ev.kind} until ${fmtDate(ev.endsOn)}${ev.heldIssues?.length ? `, still holds ${ev.heldIssues.length} issues` : ''}`;
        case 'assumption_dependency_slipping': return `${ev.issueKey} due ${fmtDate(ev.deadline)}${ev.blockedBy?.length ? `, blocked by ${ev.blockedBy[0].key} (idle ${ev.blockedBy[0].idleDays} days)` : ''}`;
        case 'decision_contradicted': return `${ev.divergent?.[0]?.key} routes work to ${ev.divergent?.[0]?.label}, contrary to the decision`;
        case 'stale_critical_issue': return `${ev.issueKey} idle for ${ev.idleDays} days, due ${fmtDate(ev.dueOn)}`;
        case 'single_point_of_failure': return `${ev.personRef} holds ${ev.openIssues} of the open issues (${Math.round(ev.share * 100)} %)`;
        default: return e.kind;
      }
  }
}
