import React, { useState } from 'react';
import { api } from '../api.js';
import { Callout, ConfirmButton, fmtDate, fmtDateTime, fmtMoney } from '../ui.jsx';

const STATUS_PILL = { open: 'warn', in_progress: 'info', done: 'ok' };

/** The projected post-mortems: the product's main object. */
export function IncidentCard({ incident: fi, notify, onChanged }) {
  const [open, setOpen] = useState(true);
  const [reason, setReason] = useState('');
  const actions = fi.actions?.items ?? [];
  const done = actions.filter((a) => a.status === 'done').length;
  const pct = Math.round((fi.actions?.probability ?? 0) * 100);
  const daysTo = Math.ceil((new Date(String(fi.incident_date).slice(0, 10)) - Date.now()) / 86400_000);
  const errors = fi.actions?.errors ?? [];

  const dismiss = async () => {
    const r = await api.dismissIncident(fi.id, reason || null);
    notify(r.ok ? 'ok' : 'warn', r.ok ? 'Incident dismissed.' : r.error);
    onChanged();
  };

  return (
    <article className="incident">
      <header className="incident-head">
        <div>
          <p className="dateline risk">Written {daysTo} day{daysTo === 1 ? '' : 's'} before the incident</p>
          <h2 className="incident-title">{fi.title}</h2>
        </div>
        <div className="incident-side">
          <div className="fact"><span className="big">{fmtMoney(fi.actions?.cost, fi.actions?.currency)}</span><span className="fact-label">projected penalty</span></div>
          <div className="fact"><span className="big">{pct} %</span><span className="fact-label">probability today</span></div>
          <div className="incident-links">
            {fi.confluence_page_url && <a className="btn" href={fi.confluence_page_url} target="_blank" rel="noreferrer">Open the post-mortem</a>}
            <button className="linklike" onClick={() => setOpen(!open)}>{open ? 'Hide corrective actions' : 'Show corrective actions'}</button>
          </div>
        </div>
      </header>

      {errors.length > 0 && <Callout kind="warn" title="Publication incomplete">{errors.join(' · ')}</Callout>}

      {open && (
        <div className="incident-body">
          <div className="section-title">Corrective actions, {done} of {actions.length} done</div>
          {actions.length ? (
            <ul className="actions-list">
              {actions.map((a) => (
                <li key={a.id}>
                  <span className={`pill ${STATUS_PILL[a.status] ?? 'idle'}`}>{a.status.replace('_', ' ')}</span>
                  <span className="action-title">{a.title}</span>
                  {a.url ? <a href={a.url} target="_blank" rel="noreferrer"><code className="code-pill">{a.issue_key}</code></a> : a.issue_key ? <code className="code-pill">{a.issue_key}</code> : null}
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No corrective actions were created (check the Jira project key in Settings).</p>}
          <div className="inline dismiss">
            <input className="grow" placeholder="Reason (optional) — e.g. penalty waived by the client" value={reason} onChange={(e) => setReason(e.target.value)} />
            <ConfirmButton className="btn subtle" label="Dismiss" confirmLabel="Dismiss — confirm" onConfirm={dismiss} />
          </div>
        </div>
      )}
    </article>
  );
}

export function AvertedLedger({ items, costAvoided }) {
  if (!items.length) return <p className="muted">Nothing averted yet.</p>;
  return (
    <>
      <div className="ledger-total"><span className="big">{fmtMoney(costAvoided)}</span><span className="muted"> in penalties that never happened</span></div>
      <section className="list">
        {items.map((fi) => (
          <article key={fi.id} className={`row column ledger ${fi.status}`}>
            <div className="row-head">
              <div className="row-main">
                <div className="row-title">
                  <span className={`pill ${fi.status === 'averted' ? 'ok' : fi.status === 'materialized' ? 'danger' : 'idle'}`}>{fi.status}</span>
                  <strong>{fi.title}</strong>
                </div>
                <div className="row-sub muted">
                  {fi.obligation?.code}, projected for {fmtDate(fi.incident_date)}
                  {fi.status === 'averted' && `, averted ${fmtDateTime(fi.averted_at)}`}
                  {fi.status === 'dismissed' && fi.dismissed_reason && ` — ${fi.dismissed_reason}`}
                </div>
              </div>
              <div className="row-side">
                {fi.status === 'averted' && <div className="penalty ok">{fmtMoney(fi.cost_avoided)} avoided</div>}
                {fi.confluence_page_url && <a href={fi.confluence_page_url} target="_blank" rel="noreferrer">Open page</a>}
              </div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
