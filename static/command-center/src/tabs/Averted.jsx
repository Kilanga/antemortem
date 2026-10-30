import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { AvertedLedger } from './Incidents.jsx';

export default function Averted() {
  const [data, setData] = useState(null);
  useEffect(() => { api.listIncidents().then((r) => setData(r.ok ? r : { averted: [], costAvoided: 0 })); }, []);
  return (
    <>
      <section className="hero compact">
        <div>
          <p className="eyebrow">The other ledger</p>
          <h1>Incidents that never happened</h1>
          <p className="lede">Every page here was a post-mortem written before its incident. The corrective actions were completed in time, and the document archived itself.</p>
        </div>
      </section>
      {data === null ? <p className="muted">Loading…</p> : <AvertedLedger items={data.averted} costAvoided={data.costAvoided} />}
    </>
  );
}
