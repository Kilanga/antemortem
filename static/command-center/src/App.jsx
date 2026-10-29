import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Shell, Callout } from './ui.jsx';
import Overview from './tabs/Overview.jsx';
import Obligations from './tabs/Obligations.jsx';
import Decisions from './tabs/Decisions.jsx';
import Settings from './tabs/Settings.jsx';

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
  const runAnalysis = async () => {
    setBusy('analysis');
    const res = await api.runAnalysisNow();
    setBusy(null);
    notify(res.ok ? 'ok' : 'warn', res.ok ? `Analysis run recorded (${res.durationMs} ms).` : `Analysis failed: ${res.error}`);
    refresh();
  };

  const version = overview?.app?.version ? `v${overview.app.version}` : '';

  if (!overview) return <Shell tab={tab} onTab={onTab}><p className="muted">Loading…</p></Shell>;
  if (!overview.ok) return <Shell tab={tab} onTab={onTab}><Callout kind="warn" title="The app could not reach its backend">{overview.error}</Callout></Shell>;

  return (
    <Shell tab={tab} onTab={onTab} toast={toast} version={version}>
      {tab === 'overview' && <Overview overview={overview} busy={busy} onRunAnalysis={runAnalysis} onRepair={repair} onTab={onTab} />}
      {tab === 'obligations' && <Obligations notify={notify} />}
      {tab === 'decisions' && <Decisions notify={notify} />}
      {tab === 'settings' && <Settings overview={overview} notify={notify} onChanged={refresh} />}
    </Shell>
  );
}
