import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Callout, ConfirmButton, Field, fmtDate } from '../ui.jsx';

const KINDS = [
  ['person_available', 'A person stays available', 'personRef, displayName, until'],
  ['capacity', 'A team/vendor stays under a load', 'teamRef, maxOpenIssues'],
  ['dependency_done_by', 'An issue is done by a date', 'issueKey, date'],
  ['routing', 'Work in a scope keeps a label value', 'scopeJql, labelPrefix, expected'],
  ['obligation_holds', 'Another obligation keeps holding', 'obligationId'],
  ['freeform', 'Free text (not monitored)', ''],
];

const STATUS_PILL = { holding: 'ok', shaken: 'warn', broken: 'danger' };

export default function Decisions({ notify }) {
  const [items, setItems] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const [d, o] = await Promise.all([api.listDecisions(), api.listObligations()]);
    setItems(d.ok ? d.decisions : []);
    setObligations(o.ok ? o.obligations : []);
    if (!d.ok) notify('warn', d.error);
  };
  useEffect(() => { load(); }, []);

  if (items === null) return <p className="muted">Loading…</p>;

  return (
    <>
      <section className="hero compact">
        <div>
          <p className="dateline">Decisions and assumptions</p>
          <h1>Decisions</h1>
          <p className="lede">What was decided, and the assumptions it rests on — each one watched against the work.</p>
        </div>
        <div className="actions"><button className="btn" onClick={() => setEditing('new')}>Record a decision</button></div>
      </section>

      {editing && (
        <DecisionEditor
          initial={editing === 'new' ? emptyDecision() : toForm(editing)}
          obligations={obligations}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          notify={notify}
        />
      )}

      <section className="list">
        {items.map((d) => (
          <article key={d.id} className="row column">
            <div className="row-head">
              <div>
                <div className="row-title"><strong>{d.title}</strong> <span className={`pill ${d.status === 'active' ? 'ok' : 'warn'}`}>{d.status}</span></div>
                <div className="row-sub muted">
                  Decided {fmtDate(d.decided_at)}
                  {d.supports?.length ? `, supports ${d.supports.map((s) => s.code).join(', ')}` : ''}
                  {d.source_url ? <>. <a href={d.source_url} target="_blank" rel="noreferrer">Read the source</a></> : ''}
                </div>
              </div>
              <div className="row-actions">
                <button className="linklike" onClick={() => setEditing(d)}>Edit</button>
                <ConfirmButton className="linklike danger" label="Archive" confirmLabel="Archive — confirm" onConfirm={async () => { const r = await api.archiveDecision(d.id); notify(r.ok ? 'ok' : 'warn', r.ok ? 'Archived.' : r.error); load(); }} />
              </div>
            </div>
            <p className="statement">{d.statement}</p>
            {d.assumptions?.length ? (
              <ul className="assumptions">
                {d.assumptions.map((a) => (
                  <li key={a.id}>
                    <span className={`dot ${STATUS_PILL[a.status] ?? 'idle'}`} title={a.status} />
                    <span>{a.statement}</span>
                    <span className="code-pill">{(KINDS.find((k) => k[0] === a.kind)?.[1] ?? a.kind).toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">No assumptions recorded — this decision cannot be monitored.</p>}
          </article>
        ))}
        {!items.length && <Callout kind="info" title="No decisions yet">Record one, or load the demo scenario from Settings.</Callout>}
      </section>
    </>
  );
}

function emptyDecision() {
  return { title: '', statement: '', rationale: '', decided_at: new Date().toISOString().slice(0, 10), source_type: 'manual', source_url: '', alternatives_rejected: [], assumptions: [], supports: [], status: 'active' };
}
function toForm(d) {
  return {
    id: d.id, title: d.title, statement: d.statement, rationale: d.rationale ?? '', decided_at: d.decided_at ? String(d.decided_at).slice(0, 10) : '',
    source_type: d.source_type ?? 'manual', source_url: d.source_url ?? '', status: d.status,
    alternatives_rejected: d.alternatives_rejected ?? [],
    assumptions: (d.assumptions ?? []).map((a) => ({ id: a.id, statement: a.statement, kind: a.kind, params: a.params ?? {} })),
    supports: (d.supports ?? []).map((s) => s.id),
  };
}

function DecisionEditor({ initial, obligations, onClose, onSaved, notify }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setA = (i, patch) => setForm({ ...form, assumptions: form.assumptions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const setAParam = (i, key, value) => setA(i, { params: { ...form.assumptions[i].params, [key]: value } });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api.saveDecision({ ...form, decided_at: form.decided_at ? `${form.decided_at}T12:00:00Z` : null });
    setBusy(false);
    notify(r.ok ? 'ok' : 'warn', r.ok ? 'Decision saved.' : r.error);
    if (r.ok) onSaved();
  };

  return (
    <Card title={form.id ? 'Edit decision' : 'Record a decision'} actions={<button className="linklike" onClick={onClose}>Close</button>}>
      <form className="form two-col" onSubmit={save}>
        <Field label="Title"><input className="span2" value={form.title} onChange={set('title')} required /></Field>
        <Field label="What was decided"><textarea className="span2" rows={2} value={form.statement} onChange={set('statement')} required /></Field>
        <Field label="Why"><textarea className="span2" rows={2} value={form.rationale} onChange={set('rationale')} /></Field>
        <Field label="Decided on"><input type="date" value={form.decided_at} onChange={set('decided_at')} /></Field>
        <Field label="Source URL" hint="minutes, ticket, page"><input value={form.source_url} onChange={set('source_url')} /></Field>
        <Field label="Supports obligations">
          <select multiple value={form.supports} onChange={(e) => setForm({ ...form, supports: Array.from(e.target.selectedOptions).map((o) => o.value) })} size={Math.min(4, Math.max(2, obligations.length))}>
            {obligations.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.title}</option>)}
          </select>
        </Field>
        <Field label="Status"><select value={form.status} onChange={set('status')}><option>active</option><option>superseded</option><option>contradicted</option><option>retired</option></select></Field>

        <div className="span2">
          <div className="section-title">Alternatives rejected</div>
          {form.alternatives_rejected.map((a, i) => (
            <div className="inline" key={i}>
              <input className="grow" placeholder="Alternative" value={a.label} onChange={(e) => setForm({ ...form, alternatives_rejected: form.alternatives_rejected.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="grow" placeholder="Why it was rejected" value={a.reason} onChange={(e) => setForm({ ...form, alternatives_rejected: form.alternatives_rejected.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)) })} />
              <button type="button" className="linklike danger" onClick={() => setForm({ ...form, alternatives_rejected: form.alternatives_rejected.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="linklike" onClick={() => setForm({ ...form, alternatives_rejected: [...form.alternatives_rejected, { label: '', reason: '' }] })}>+ Add alternative</button>
        </div>

        <div className="span2">
          <div className="section-title">Assumptions</div>
          {form.assumptions.map((a, i) => {
            const kind = KINDS.find((k) => k[0] === a.kind) ?? KINDS[KINDS.length - 1];
            return (
              <div className="assumption-editor" key={i}>
                <div className="inline">
                  <input className="grow" placeholder="Assumption, in plain words" value={a.statement} onChange={(e) => setA(i, { statement: e.target.value })} />
                  <select value={a.kind} onChange={(e) => setA(i, { kind: e.target.value, params: {} })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <button type="button" className="linklike danger" onClick={() => setForm({ ...form, assumptions: form.assumptions.filter((_, j) => j !== i) })}>Remove</button>
                </div>
                {kind[2] && (
                  <div className="inline params">
                    {kind[2].split(', ').map((p) => (
                      <input key={p} placeholder={p} value={a.params?.[p] ?? ''} onChange={(e) => setAParam(i, p, p === 'maxOpenIssues' ? Number(e.target.value) : e.target.value)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="linklike" onClick={() => setForm({ ...form, assumptions: [...form.assumptions, { statement: '', kind: 'freeform', params: {} }] })}>+ Add assumption</button>
        </div>

        <div className="actions left span2"><button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Card>
  );
}
