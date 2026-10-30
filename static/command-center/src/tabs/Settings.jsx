import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Card, Callout, ConfirmButton, Field, fmtDateTime } from '../ui.jsx';

export default function Settings({ overview, notify, onChanged }) {
  const { settings } = overview;
  const [form, setForm] = useState({
    confluenceSpaceKey: settings.confluenceSpaceKey ?? '',
    actionsProjectKey: settings.actionsProjectKey ?? '',
    publishThreshold: settings.publishThreshold,
    graphSource: settings.graphSource,
  });
  const [busy, setBusy] = useState(false);
  // Settings can change under the form (the demo loader points the app at NFS / ANTE).
  useEffect(() => {
    setForm({ confluenceSpaceKey: settings.confluenceSpaceKey ?? '', actionsProjectKey: settings.actionsProjectKey ?? '', publishThreshold: settings.publishThreshold, graphSource: settings.graphSource });
  }, [settings.confluenceSpaceKey, settings.actionsProjectKey, settings.publishThreshold, settings.graphSource]);
  const [progress, setProgress] = useState(overview.demo ?? { status: 'idle', steps: [] });
  const timer = useRef(null);

  // Poll while a demo job runs.
  useEffect(() => {
    const active = progress.status === 'running' || progress.status === 'resetting';
    if (active && !timer.current) {
      timer.current = setInterval(async () => {
        const r = await api.getDemoProgress();
        if (r.ok) setProgress(r.progress);
      }, 2500);
    }
    if (!active && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
      onChanged();
    }
    return () => {};
  }, [progress.status]);
  useEffect(() => () => timer.current && clearInterval(timer.current), []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api.saveSettings({
      confluenceSpaceKey: form.confluenceSpaceKey || null,
      actionsProjectKey: form.actionsProjectKey || null,
      publishThreshold: Number(form.publishThreshold),
      graphSource: form.graphSource,
    });
    setBusy(false);
    notify(r.ok ? 'ok' : 'warn', r.ok ? 'Settings saved.' : r.error);
    onChanged();
  };

  const loadDemo = async () => {
    const r = await api.loadDemo();
    if (!r.ok) return notify('warn', r.error);
    setProgress({ status: 'running', steps: [], error: null });
  };
  const resetDemo = async () => {
    const r = await api.resetDemo();
    if (!r.ok) return notify('warn', r.error);
    setProgress({ status: 'resetting', steps: [], error: null });
  };

  const active = progress.status === 'running' || progress.status === 'resetting';
  const [hook, setHook] = useState(null);
  const revealHook = async () => { const r = await api.getWebtrigger(); setHook(r.ok ? r : { error: r.error }); };

  return (
    <>
      <section className="hero compact">
        <div>
          <p className="dateline">Where Antemortem reads and writes</p>
          <h1>Settings</h1>
        </div>
      </section>

      <section className="grid">
        <Card title="Demo scenario" status={settings.demoLoaded ? 'ok' : 'idle'} statusLabel={settings.demoLoaded ? 'Loaded' : 'Not loaded'}>
          <p className="hint">
            A fictional field-service contract heading for a penalty in 16 days. Creates Jira project <code>NFS</code> and
            Confluence space <code>ANTE</code>. Takes one to two minutes.
          </p>
          <div className="actions left">
            <ConfirmButton className="btn" label={settings.demoLoaded ? 'Reload demo scenario' : 'Load demo scenario'} confirmLabel="Create NFS + ANTE — confirm" onConfirm={loadDemo} disabled={active} />
            <ConfirmButton className="btn subtle" label="Reset demo" confirmLabel="Delete NFS + ANTE — confirm" onConfirm={resetDemo} disabled={active} />
          </div>
          {active && (
            <div className="progress">
              <div className="section-title">{progress.status === 'resetting' ? 'Resetting…' : 'Loading…'}</div>
              <ol className="steps">
                {progress.steps.map((s) => (
                  <li key={s.key} className={s.status}>
                    <span className="step-status">{{ pending: '○', running: '◐', done: '●', failed: '✕' }[s.status] ?? '○'}</span>
                    <span>{s.label}</span>
                    {s.detail && <span className="muted small"> — {s.detail}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {progress.status === 'failed' && (
            <Callout kind="warn" title="Demo job failed">
              <div>{progress.error}</div>
              {progress.steps?.length > 0 && (
                <ol className="steps compact">
                  {progress.steps.map((s) => <li key={s.key} className={s.status}><span className="step-status">{{ pending: '○', running: '◐', done: '●', failed: '✕' }[s.status] ?? '○'}</span>{s.label}{s.detail ? ` — ${s.detail}` : ''}</li>)}
                </ol>
              )}
              <div className="small muted">Fix the cause (usually a permission or an existing project/space) and load again — completed steps are skipped.</div>
            </Callout>
          )}
          {progress.status === 'done' && !active && (
            <Callout kind="ok" title={`Loaded ${fmtDateTime(progress.finishedAt)}`}>
              <ol className="steps compact">{progress.steps.map((s) => <li key={s.key}>{s.label}{s.detail ? ` — ${s.detail}` : ''}</li>)}</ol>
            </Callout>
          )}
          {progress.status === 'idle' && progress.report?.length > 0 && (
            <Callout kind="info" title={`Reset ${fmtDateTime(progress.lastReset)}`}>{progress.report.join(' · ')}</Callout>
          )}
        </Card>

        <Card title="Targets">
          <form className="form" onSubmit={save}>
            <Field label="Confluence space key" hint="where projected incidents are published"><input value={form.confluenceSpaceKey} onChange={(e) => setForm({ ...form, confluenceSpaceKey: e.target.value.toUpperCase() })} placeholder="e.g. ANTE" /></Field>
            <Field label="Jira project key" hint="where corrective actions are created"><input value={form.actionsProjectKey} onChange={(e) => setForm({ ...form, actionsProjectKey: e.target.value.toUpperCase() })} placeholder="e.g. NFS" /></Field>
            <Field label="Publish threshold" hint="forecast probability above which a post-mortem is written"><input type="number" min="0.05" max="0.98" step="0.05" value={form.publishThreshold} onChange={(e) => setForm({ ...form, publishThreshold: e.target.value })} /></Field>
            <Field label="Graph source" hint="REST unless the Teamwork Graph scope is granted"><select value={form.graphSource} onChange={(e) => setForm({ ...form, graphSource: e.target.value })}><option value="rest">Jira & Confluence REST</option><option value="auto">Auto (Teamwork Graph when available)</option><option value="twg">Teamwork Graph</option></select></Field>
            <div className="actions left"><button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
          </form>
        </Card>

        <Card title="Automation hook">
          <p className="hint">POST to this URL with the <code>X-Antemortem-Token</code> header to run an analysis. It also runs hourly.</p>
          {hook ? (hook.error ? <Callout kind="warn">{hook.error}</Callout> : <pre>{hook.example}</pre>) : <div className="actions left"><button className="btn subtle" type="button" onClick={revealHook}>Reveal URL and token</button></div>}
        </Card>
      </section>
    </>
  );
}
