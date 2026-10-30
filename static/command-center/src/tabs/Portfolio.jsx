import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDate, fmtMoney } from '../ui.jsx';

/** Every contract on one page: exposure, next breach, what holds. */
export default function Portfolio({ onTab }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.listForecasts().then((r) => setRows(r.ok ? r.forecasts : [])); }, []);
  if (rows === null) return <p className="muted">Loading…</p>;

  const byContract = new Map();
  for (const it of rows) {
    const c = it.obligation.contract ?? { id: 'none', name: 'No contract' };
    if (!byContract.has(c.id)) byContract.set(c.id, { contract: c, items: [] });
    byContract.get(c.id).items.push(it);
  }
  const groups = [...byContract.values()].map((g) => {
    const atRisk = g.items.filter((it) => it.forecast && !it.forecast.healthy);
    const exposure = atRisk.reduce((s, it) => s + Number(it.forecast.projected_cost ?? 0), 0);
    const maxPenalty = g.items.reduce((s, it) => s + penaltyOf(it.obligation), 0);
    const next = atRisk.sort((a, b) => String(a.forecast.projected_breach_date).localeCompare(String(b.forecast.projected_breach_date)))[0] ?? null;
    return { ...g, atRisk, exposure, maxPenalty, next, currency: g.contract.currency ?? atRisk[0]?.forecast?.currency ?? 'EUR' };
  }).sort((a, b) => b.exposure - a.exposure);

  const totalExposure = groups.reduce((s, g) => s + g.exposure, 0);
  const totalAtRisk = groups.reduce((s, g) => s + g.atRisk.length, 0);
  const totalObl = rows.length;

  return (
    <>
      <section className="hero compact">
        <div>
          <p className="dateline">All contracts</p>
          <h1>{totalAtRisk ? `${fmtMoney(totalExposure)} exposed across ${groups.length} contract${groups.length === 1 ? '' : 's'}.` : 'Every contract holds.'}</h1>
          <p className="lede">{totalAtRisk} of {totalObl} obligations at risk.</p>
        </div>
      </section>

      <section className="list">
        {groups.map((g) => (
          <article key={g.contract.id} className="row portfolio-row">
            <div className="row-main">
              <div className="row-title"><strong>{g.contract.name}</strong>{g.contract.counterparty ? <span className="muted"> · {g.contract.counterparty}</span> : null}</div>
              <div className="row-sub muted">
                {g.items.length} obligation{g.items.length === 1 ? '' : 's'}, {g.atRisk.length} at risk
                {g.next ? <> · next breach <strong>{g.next.obligation.code}</strong> on {fmtDate(g.next.forecast.projected_breach_date)} ({Math.round(g.next.forecast.probability * 100)} %)</> : null}
              </div>
              <div className="obl-strip">
                {g.items.map((it) => {
                  const f = it.forecast; const risk = f && !f.healthy;
                  return <button key={it.obligation.id} className={`chip ${risk ? (f.probability >= 0.6 ? 'danger' : 'warn') : 'ok'}`} onClick={() => onTab('overview')} title={it.obligation.title}>{it.obligation.code}{risk ? ` ${Math.round(f.probability * 100)} %` : ''}</button>;
                })}
              </div>
            </div>
            <div className="row-side">
              <div className="fact"><span className="big">{fmtMoney(g.exposure, g.currency)}</span><span className="fact-label">projected penalties</span></div>
              {g.maxPenalty > 0 && <div className="muted small">of {fmtMoney(g.maxPenalty, g.currency)} at stake this period</div>}
            </div>
          </article>
        ))}
        {!groups.length && <p className="muted">No obligations yet.</p>}
      </section>
    </>
  );
}

/** Worst case for one obligation over its period. */
function penaltyOf(o) {
  if (o.penalty_type === 'fixed') return Number(o.penalty_value ?? 0);
  if (o.penalty_type === 'percent_of_invoice') return Number(o.penalty_value ?? 0) / 100 * Number(o.invoice_basis ?? 0);
  return 0;
}
