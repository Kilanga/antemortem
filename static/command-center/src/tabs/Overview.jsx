import React from 'react';
import { Card, Callout, fmtDateTime, pretty } from '../ui.jsx';

/**
 * Overview — in week 2 still the health screen (storage, engine, model).
 * Week 4 replaces the hero with "Next post-mortem in N days" and the list
 * of projected incidents.
 */
export default function Overview({ overview, busy, onRunAnalysis, onRepair, onTab }) {
  const { schema, settings, lastRun, counts, demo } = overview;
  const configured = Boolean(settings.confluenceSpaceKey && settings.actionsProjectKey);
  const modelObjects = (counts.obligation ?? 0) + (counts.decision ?? 0);

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Week 2 · model</p>
          <h1>{modelObjects ? 'Model loaded. Engine arrives next.' : 'Nothing to forecast yet.'}</h1>
          <p className="lede">
            Antemortem writes the post-mortem of an incident <em>before</em> it happens. The forecasting engine lands in
            weeks 3–4; this release adds the three primitives it reasons over — obligations, decisions with assumptions,
            and the links between them — plus a one-click demo scenario.
          </p>
          {!modelObjects && (
            <p className="lede">
              Start with the demo: <button className="linklike" onClick={() => onTab('settings')}>Settings → Load demo scenario</button>.
            </p>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={onRunAnalysis} disabled={busy !== null || !schema.ok}>
            {busy === 'analysis' ? 'Running…' : 'Run analysis now'}
          </button>
          <button className="btn subtle" onClick={onRepair} disabled={busy !== null}>
            {busy === 'repair' ? 'Repairing…' : 'Repair database'}
          </button>
        </div>
      </section>

      {demo?.status === 'running' && <Callout kind="info" title="Demo scenario is loading">Follow progress in Settings.</Callout>}

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

        <Card title="Engine" status={lastRun ? (lastRun.status === 'done' ? 'ok' : 'warn') : 'idle'} statusLabel={lastRun ? `Last run ${fmtDateTime(lastRun.started_at)} · ${lastRun.status}` : 'Never run'}>
          {lastRun ? (
            <dl className="kv">
              <dt>Triggered by</dt><dd>{lastRun.trigger_source}</dd>
              <dt>Finished</dt><dd>{fmtDateTime(lastRun.finished_at)}</dd>
              <dt>Summary</dt><dd><pre>{pretty(lastRun.summary)}</pre></dd>
              {lastRun.error && (<><dt>Error</dt><dd><pre className="warn">{lastRun.error}</pre></dd></>)}
            </dl>
          ) : (
            <p className="hint">The hourly schedule will run the engine automatically. You can also run it now.</p>
          )}
        </Card>

        <Card title="Configuration" status={configured ? 'ok' : 'warn'} statusLabel={configured ? 'Configured' : 'Not configured'}>
          <dl className="kv">
            <dt>Confluence space</dt><dd>{settings.confluenceSpaceKey ?? <span className="muted">not set</span>}</dd>
            <dt>Jira project</dt><dd>{settings.actionsProjectKey ?? <span className="muted">not set</span>}</dd>
            <dt>Publish threshold</dt><dd>{settings.publishThreshold}</dd>
            <dt>Graph source</dt><dd>{settings.graphSource}</dd>
            <dt>Demo</dt><dd>{settings.demoLoaded ? `loaded ${fmtDateTime(settings.demoLoadedAt)}` : 'not loaded'}</dd>
          </dl>
          <div className="actions left"><button className="btn subtle" onClick={() => onTab('settings')}>Edit in Settings</button></div>
        </Card>

        <Card title="Model" status={modelObjects ? 'ok' : 'idle'} statusLabel={`${modelObjects} objects`}>
          <p className="hint">
            Three primitives the platform does not have: <strong>obligations</strong> (what the contract requires),
            <strong> decisions with assumptions</strong> (what was decided, and what it rests on), and the{' '}
            <strong>causal links</strong> between them and the work in Jira.
          </p>
          <dl className="kv compact">
            <dt>Contracts</dt><dd>{counts.contract ?? 0}</dd>
            <dt>Obligations</dt><dd>{counts.obligation ?? 0}</dd>
            <dt>Decisions</dt><dd>{counts.decision ?? 0}</dd>
            <dt>Assumptions</dt><dd>{counts.assumption ?? 0}</dd>
            <dt>Links</dt><dd>{counts.link ?? 0}</dd>
            <dt>Availability records</dt><dd>{counts.availability ?? 0}</dd>
          </dl>
        </Card>
      </section>
    </>
  );
}
