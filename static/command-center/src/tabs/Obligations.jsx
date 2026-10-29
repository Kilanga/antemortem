import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Callout, ConfirmButton, Field, fmtDate, fmtMoney } from '../ui.jsx';

const METRICS = [
  ['ratio_within_sla', 'Ratio of issues resolved within an SLA'],
  ['count_max', 'Count must stay at or below a maximum'],
  ['count_min', 'Count must reach a minimum'],
  ['deadline', 'A deliverable must be done by a date'],
  ['custom', 'Custom (not computed)'],
];

const EMPTY = {
  contract_id: '', code: '', title: '', description: '', metric_type: 'ratio_within_sla', jql_scope: '',
  sla_hours: '', threshold: '', period: 'monthly', period_starts_on: '', period_ends_on: '',
  penalty_type: 'fixed', penalty_value: '', invoice_basis: '', status: 'active',
};

export default function Obligations({ notify }) {
  const [items, setItems] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | obligation
  const [contractForm, setContractForm] = useState(null);

  const load = async () => {
    const [o, c] = await Promise.all([api.listObligations(), api.listContracts()]);
    setItems(o.ok ? o.obligations : []);
    setContracts(c.ok ? c.contracts : []);
    if (!o.ok) notify('warn', o.error);
  };
  useEffect(() => { load(); }, []);

  if (items === null) return <p className="muted">Loading…</p>;

  return (
    <>
      <section className="hero compact">
        <div>
          <p className="eyebrow">Primitive 1 of 3</p>
          <h1>Obligations</h1>
          <p className="lede">
            A measurable rule from a contract, tied to the Jira issues that feed it. Jira has SLAs per ticket; it has no
            object for <em>"95 % of lot 3 interventions under 4 h, measured over the period, or 2 % off the invoice"</em>.
            This is that object.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setEditing('new')} disabled={!contracts.length}>New obligation</button>
          <button className="btn subtle" onClick={() => setContractForm({ name: '', counterparty: '', start_date: '', end_date: '', currency: 'EUR', notes: '' })}>New contract</button>
        </div>
      </section>

      {!contracts.length && <Callout kind="info" title="No contract yet">Create a contract first, or load the demo scenario from Settings.</Callout>}

      {contractForm && (
        <ContractEditor form={contractForm} setForm={setContractForm} onClose={() => setContractForm(null)} onSaved={() => { setContractForm(null); load(); }} notify={notify} />
      )}
      {editing && (
        <ObligationEditor
          initial={editing === 'new' ? { ...EMPTY, contract_id: contracts[0]?.id ?? '' } : toForm(editing)}
          contracts={contracts}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          notify={notify}
        />
      )}

      <section className="list">
        {items.map((o) => (
          <article key={o.id} className="row">
            <div className="row-main">
              <div className="row-title">
                <code className="code-pill">{o.code}</code>
                <strong>{o.title}</strong>
              </div>
              <div className="row-sub muted">
                {o.contract?.name ?? 'No contract'} · {METRICS.find((m) => m[0] === o.metric_type)?.[1] ?? o.metric_type}
                {o.sla_hours != null && ` · SLA ${o.sla_hours} h`}
                {o.threshold != null && ` · threshold ${o.metric_type === 'ratio_within_sla' ? `${Math.round(o.threshold * 100)} %` : o.threshold}`}
              </div>
              {o.jql_scope && <code className="jql">{o.jql_scope}</code>}
            </div>
            <div className="row-side">
              <div className="penalty">{o.penalty_type === 'percent_of_invoice' ? `${o.penalty_value} % of ${fmtMoney(o.invoice_basis, o.contract?.currency)}` : fmtMoney(o.penalty_value, o.contract?.currency)}</div>
              <div className="muted small">{o.period === 'custom' && o.period_ends_on ? `period ends ${fmtDate(o.period_ends_on)}` : o.period}</div>
              <div className="row-actions">
                <button className="linklike" onClick={() => setEditing(o)}>Edit</button>
                <ConfirmButton className="linklike danger" label="Archive" confirmLabel="Archive — confirm" onConfirm={async () => { const r = await api.archiveObligation(o.id); notify(r.ok ? 'ok' : 'warn', r.ok ? 'Archived.' : r.error); load(); }} />
              </div>
            </div>
          </article>
        ))}
        {!items.length && contracts.length > 0 && <p className="muted">No obligations yet.</p>}
      </section>
    </>
  );
}

function toForm(o) {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) f[k] = o[k] ?? '';
  f.id = o.id;
  if (o.period_starts_on) f.period_starts_on = String(o.period_starts_on).slice(0, 10);
  if (o.period_ends_on) f.period_ends_on = String(o.period_ends_on).slice(0, 10);
  return f;
}

function ObligationEditor({ initial, contracts, onClose, onSaved, notify }) {
  const [form, setForm] = useState(initial);
  const [jqlResult, setJqlResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const test = async () => {
    setJqlResult({ loading: true });
    const r = await api.testJql(form.jql_scope);
    setJqlResult(r);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api.saveObligation(form);
    setBusy(false);
    notify(r.ok ? 'ok' : 'warn', r.ok ? 'Obligation saved.' : r.error);
    if (r.ok) onSaved();
  };

  return (
    <Card title={form.id ? `Edit ${form.code}` : 'New obligation'} actions={<button className="linklike" onClick={onClose}>Close</button>}>
      <form className="form two-col" onSubmit={save}>
        <Field label="Contract"><select value={form.contract_id} onChange={set('contract_id')}>{contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Code" hint="short, e.g. O-3"><input value={form.code} onChange={set('code')} required /></Field>
        <Field label="Title" ><input className="span2" value={form.title} onChange={set('title')} required /></Field>
        <Field label="Description"><textarea className="span2" rows={2} value={form.description ?? ''} onChange={set('description')} /></Field>
        <Field label="Metric"><select value={form.metric_type} onChange={set('metric_type')}>{METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Period"><select value={form.period} onChange={set('period')}><option value="monthly">Calendar month</option><option value="weekly">Calendar week</option><option value="custom">Custom window</option><option value="one_shot">One-shot</option></select></Field>
        {form.period === 'custom' && (<>
          <Field label="Period starts"><input type="date" value={form.period_starts_on ?? ''} onChange={set('period_starts_on')} /></Field>
          <Field label="Period ends"><input type="date" value={form.period_ends_on ?? ''} onChange={set('period_ends_on')} /></Field>
        </>)}
        <Field label="JQL scope" hint="the issues that feed the measure">
          <div className="inline">
            <input className="grow" value={form.jql_scope ?? ''} onChange={set('jql_scope')} placeholder='project = "NFS" AND labels = lot-3' />
            <button type="button" className="btn subtle" onClick={test} disabled={!form.jql_scope}>Test</button>
          </div>
          {jqlResult && (
            <span className={`small ${jqlResult.ok ? 'ok' : 'warn'}`}>
              {jqlResult.loading ? 'Testing…' : jqlResult.ok ? `${jqlResult.total} issues in scope · ${jqlResult.done} done · ${jqlResult.open} open${jqlResult.capped ? ' (capped at 500)' : ''}` : jqlResult.error}
            </span>
          )}
        </Field>
        {form.metric_type === 'ratio_within_sla' && (<>
          <Field label="SLA (hours)"><input type="number" step="0.25" value={form.sla_hours ?? ''} onChange={set('sla_hours')} /></Field>
          <Field label="Threshold" hint="0–1, e.g. 0.95"><input type="number" step="0.01" min="0" max="1" value={form.threshold ?? ''} onChange={set('threshold')} /></Field>
        </>)}
        {(form.metric_type === 'count_max' || form.metric_type === 'count_min') && (
          <Field label="Threshold (count)"><input type="number" step="1" value={form.threshold ?? ''} onChange={set('threshold')} /></Field>
        )}
        <Field label="Penalty type"><select value={form.penalty_type ?? 'fixed'} onChange={set('penalty_type')}><option value="fixed">Fixed amount</option><option value="percent_of_invoice">Percent of invoice</option></select></Field>
        <Field label={form.penalty_type === 'percent_of_invoice' ? 'Penalty (%)' : 'Penalty (amount)'}><input type="number" step="0.01" value={form.penalty_value ?? ''} onChange={set('penalty_value')} /></Field>
        {form.penalty_type === 'percent_of_invoice' && <Field label="Invoice basis" hint="amount the % applies to"><input type="number" step="1" value={form.invoice_basis ?? ''} onChange={set('invoice_basis')} /></Field>}
        <div className="actions left span2"><button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Card>
  );
}

function ContractEditor({ form, setForm, onClose, onSaved, notify }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const r = await api.saveContract(form);
    notify(r.ok ? 'ok' : 'warn', r.ok ? 'Contract saved.' : r.error);
    if (r.ok) onSaved();
  };
  return (
    <Card title="New contract" actions={<button className="linklike" onClick={onClose}>Close</button>}>
      <form className="form two-col" onSubmit={save}>
        <Field label="Name"><input className="span2" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Counterparty"><input value={form.counterparty} onChange={set('counterparty')} /></Field>
        <Field label="Currency"><input value={form.currency} onChange={set('currency')} maxLength={3} /></Field>
        <Field label="Starts"><input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
        <Field label="Ends"><input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
        <Field label="Notes"><textarea className="span2" rows={2} value={form.notes} onChange={set('notes')} /></Field>
        <div className="actions left span2"><button className="btn" type="submit">Save</button></div>
      </form>
    </Card>
  );
}
