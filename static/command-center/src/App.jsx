import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Week 1 command center: a health screen.
 *
 * It answers the three questions a fresh install raises — is the database
 * there, has the engine ever run, is the app configured — and offers the two
 * repair actions. Weeks 4–6 replace the body with the real command center
 * (future incidents, obligations, decisions, averted ledger); the shell,
 * header and Settings stay.
 */
export default function App() {
  const [overview, setOverview] = useState(null);
  const [busy, setBusy] = useState(null); // 'repair' | 'analysis' | 'settings' | null
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    const res = await api.getOverview();
    setOverview(res);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const notify = (kind, text) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 6000);
  };

  const repair = async () => {
    setBusy('repair');
    const res = await api.repairDatabase();
    setBusy(null);
    notify(res.ok ? 'ok' : 'warn', res.ok ? 'Database schema is complete.' : `Repair incomplete: ${res.error ?? res.result?.error ?? 'see logs'}`);
    refresh();
  };

  const runAnalysis = async () => {
    setBusy('analysis');
    const res = await api.runAnalysisNow();
    setBusy(null);
    notify(res.ok ? 'ok' : 'warn', res.ok ? `Analysis run recorded (${res.durationMs} ms).` : `Analysis failed: ${res.error}`);
    refresh();
  };

  if (!overview) return <Shell><p className="muted">Loading…</p></Shell>;
  if (!overview.ok) return <Shell><Callout kind="warn" title="The app could not reach its backend">{overview.error}</Callout></Shell>;

  const { schema, settings, lastRun, counts } = overview;
  const configured = Boolean(settings.confluenceSpaceKey && settings.actionsProjectKey);

  return (
    <Shell toast={toast}>
      <section className="hero">
        <div>
          <p className="eyebrow">Week 1 · foundation</p>
          <h1>Nothing to forecast yet.</h1>
          <p className="lede">
            Antemortem writes the post-mortem of an incident <em>before</em> it happens. This screen only checks the
            foundations: storage, engine, configuration. The forecasting engine arrives in weeks 3–4.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={runAnalysis} disabled={busy !== null || !schema.ok}>
            {busy === 'analysis' ? 'Running…' : 'Run analysis now'}
          </button>
          <button className="btn subtle" onClick={repair} disabled={busy !== null}>
            {busy === 'repair' ? 'Repairing…' : 'Repair database'}
          </button>
        </div>
      </section>

      <section className="grid">
        <Card title="Storage" status={schema.ok ? 'ok' : 'warn'} statusLabel={schema.ok ? 'Schema complete' : `${schema.missing.length} migration(s) pending`}>
          <table className="table">
            <tbody>
              {schema.tables.map((t) => (
                <tr key={t.table}>
                  <td><code>{t.table}</code></td>
                  <td className="num">{t.ok ? t.rows : '—'}</td>
                  <td className={t.ok ? 'ok' : 'warn'}>{t.ok ? 'ready' : 'missing'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!schema.ok && (
            <p className="hint">
              Forge applies the schema shortly after installation and re-checks it every hour. If this does not clear
              within a minute, use <strong>Repair database</strong>.
            </p>
          )}
        </Card>

        <Card title="Engine" status={lastRun ? (lastRun.status === 'done' ? 'ok' : 'warn') : 'idle'} statusLabel={lastRun ? `Last run ${fmt(lastRun.started_at)} · ${lastRun.status}` : 'Never run'}>
          {lastRun ? (
            <dl className="kv">
              <dt>Triggered by</dt><dd>{lastRun.trigger_source}</dd>
              <dt>Finished</dt><dd>{fmt(lastRun.finished_at)}</dd>
              <dt>Summary</dt><dd><pre>{pretty(lastRun.summary)}</pre></dd>
              {lastRun.error && (<><dt>Error</dt><dd><pre className="warn">{lastRun.error}</pre></dd></>)}
            </dl>
          ) : (
            <p className="hint">The hourly schedule will run the engine automatically. You can also run it now.</p>
          )}
        </Card>

        <SettingsCard settings={settings} configured={configured} busy={busy} setBusy={setBusy} notify={notify} onSaved={refresh} />

        <Card title="Model" status="idle" statusLabel={`${sum(counts, ['contract', 'obligation', 'decision', 'assumption'])} objects`}>
          <p className="hint">
            Three primitives the platform does not have: <strong>obligations</strong> (what the contract requires),
            <strong> decisions with assumptions</strong> (what was decided, and what it rests on), and the{' '}
            <strong>causal links</strong> between them and the work in Jira. Week 2 adds the editors and the demo scenario.
          </p>
          <dl className="kv compact">
            <dt>Contracts</dt><dd>{counts.contract ?? 0}</dd>
            <dt>Obligations</dt><dd>{counts.obligation ?? 0}</dd>
            <dt>Decisions</dt><dd>{counts.decision ?? 0}</dd>
            <dt>Assumptions</dt><dd>{counts.assumption ?? 0}</dd>
            <dt>Links</dt><dd>{counts.link ?? 0}</dd>
          </dl>
        </Card>
      </section>
    </Shell>
  );
}

function SettingsCard({ settings, configured, busy, setBusy, notify, onSaved }) {
  const [form, setForm] = useState({
    confluenceSpaceKey: settings.confluenceSpaceKey ?? '',
    actionsProjectKey: settings.actionsProjectKey ?? '',
    publishThreshold: settings.publishThreshold,
  });

  const save = async (e) => {
    e.preventDefault();
    setBusy('settings');
    const res = await api.saveSettings({
      confluenceSpaceKey: form.confluenceSpaceKey || null,
      actionsProjectKey: form.actionsProjectKey || null,
      publishThreshold: Number(form.publishThreshold),
    });
    setBusy(null);
    notify(res.ok ? 'ok' : 'warn', res.ok ? 'Settings saved.' : `Could not save: ${res.error}`);
    onSaved();
  };

  return (
    <Card title="Configuration" status={configured ? 'ok' : 'warn'} statusLabel={configured ? 'Configured' : 'Not configured'}>
      <form onSubmit={save} className="form">
        <label>
          Confluence space key <span className="muted">(where future incidents are published)</span>
          <input value={form.confluenceSpaceKey} onChange={(e) => setForm({ ...form, confluenceSpaceKey: e.target.value.toUpperCase() })} placeholder="e.g. ANTE" />
        </label>
        <label>
          Jira project key <span className="muted">(where corrective actions are created)</span>
          <input value={form.actionsProjectKey} onChange={(e) => setForm({ ...form, actionsProjectKey: e.target.value.toUpperCase() })} placeholder="e.g. FIELD" />
        </label>
        <label>
          Publish threshold <span className="muted">(forecast probability above which a post-mortem is written)</span>
          <input type="number" min="0.05" max="0.98" step="0.05" value={form.publishThreshold} onChange={(e) => setForm({ ...form, publishThreshold: e.target.value })} />
        </label>
        <div className="actions left">
          <button className="btn" type="submit" disabled={busy !== null}>{busy === 'settings' ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Card>
  );
}

function Shell({ children, toast }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>Antemortem</span>
        </div>
        <span className="tag">v0.1.0</span>
      </header>
      <main>{children}</main>
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function Card({ title, status, statusLabel, children }) {
  return (
    <article className="card">
      <header>
        <h2>{title}</h2>
        <span className={`pill ${status}`}>{statusLabel}</span>
      </header>
      <div className="body">{children}</div>
    </article>
  );
}

function Callout({ kind, title, children }) {
  return (
    <div className={`callout ${kind}`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

const fmt = (v) => (v ? new Date(v.replace?.(' ', 'T') + (v.endsWith?.('Z') ? '' : 'Z')).toLocaleString('en-GB') : '—');
const pretty = (v) => {
  if (v == null) return '—';
  try {
    return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v, null, 2);
  } catch {
    return String(v);
  }
};
const sum = (counts, keys) => keys.reduce((n, k) => n + (counts[k] ?? 0), 0);
