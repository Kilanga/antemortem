import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Shell, Callout } from './ui.jsx';
import Overview from './tabs/Overview.jsx';
import Obligations from './tabs/Obligations.jsx';
import Decisions from './tabs/Decisions.jsx';
import Settings from './tabs/Settings.jsx';
import Averted from './tabs/Averted.jsx';
import Portfolio from './tabs/Portfolio.jsx';

export default function App() {
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem('antemortem.tab') || 'overview'; } catch { return 'overview'; }
  });
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    const res = await api.getOverview();
    setOverview(res);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const onTab = (t) => {
    setTab(t);
    try { sessionStorage.setItem('antemortem.tab', t); } catch { /* ignore */ }
  };

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
  // The analysis runs in the background (it publishes pages and creates
  // issues); poll the latest run until it finishes.
  const runAnalysis = async () => {
    setBusy('analysis');
    const before = overview?.lastRun?.id ?? null;
    const res = await api.runAnalysisNow();
    if (!res.ok) { setBusy(null); return notify('warn', res.error); }
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await api.getLastRun();
      const run = r.ok ? r.lastRun : null;
      if (run && run.id !== before && run.status !== 'running') {
        setBusy(null);
        notify(run.status === 'done' ? 'ok' : 'warn', run.status === 'done' ? 'Analysis complete.' : `Analysis failed: ${run.error}`);
        return refresh();
      }
    }
    setBusy(null);
    notify('warn', 'The analysis is taking longer than expected; refresh in a moment.');
    refresh();
  };

  const version = overview?.app?.version ? `v${overview.app.version}` : '';

  if (!overview) return <Shell tab={tab} onTab={onTab}><p className="muted">Loading…</p></Shell>;
  if (!overview.ok) return <Shell tab={tab} onTab={onTab}><Callout kind="warn" title="The app could not reach its backend">{overview.error}</Callout></Shell>;

  return (
    <Shell tab={tab} onTab={onTab} toast={toast} version={version}>
      {tab === 'overview' && <Overview overview={overview} busy={busy} onRunAnalysis={runAnalysis} onRepair={repair} onTab={onTab} notify={notify} refresh={refresh} />}
      {tab === 'portfolio' && <Portfolio onTab={onTab} />}
      {tab === 'averted' && <Averted />}
      {tab === 'obligations' && <Obligations notify={notify} />}
      {tab === 'decisions' && <Decisions notify={notify} />}
      {tab === 'settings' && <Settings overview={overview} notify={notify} onChanged={refresh} />}
    </Shell>
  );
}
