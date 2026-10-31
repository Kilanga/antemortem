/**
 * Single place where the frontend talks to resolvers. Every call returns the
 * resolver's JSON; a transport failure is normalised into { ok: false, error }.
 */
import { isMock, mockInvoke } from './mock.js';

// @forge/bridge throws at import time outside an Atlassian product, so it is
// loaded lazily; mock mode (?mock=1) never touches it.
let bridge = null;
async function invoke(name, payload) {
  if (isMock()) return mockInvoke(name, payload);
  bridge ??= await import('@forge/bridge');
  return bridge.invoke(name, payload);
}

async function call(name, payload) {
  try {
    const res = await invoke(name, payload);
    return res ?? { ok: false, error: 'Empty response' };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export const api = {
  getOverview: () => call('getOverview'),
  repairDatabase: () => call('repairDatabase'),
  runAnalysisNow: () => call('runAnalysisNow'),
  getSettings: () => call('getSettings'),
  saveSettings: (patch) => call('saveSettings', patch),

  loadDemo: () => call('loadDemo'),
  resetDemo: () => call('resetDemo'),
  getDemoProgress: () => call('getDemoProgress'),

  whatIf: (obligationId, ignore, onTime) => call('whatIf', { obligationId, ignore, onTime }),
  backtest: (obligationId) => call('backtest', { obligationId }),

  listContracts: () => call('listContracts'),
  saveContract: (c) => call('saveContract', c),
  listObligations: () => call('listObligations'),
  saveObligation: (o) => call('saveObligation', o),
  archiveObligation: (id) => call('archiveObligation', { id }),
  testJql: (jql) => call('testJql', { jql }),

  listDecisions: () => call('listDecisions'),
  saveDecision: (d) => call('saveDecision', d),
  archiveDecision: (id) => call('archiveDecision', { id }),
  listAvailability: () => call('listAvailability'),
  listForecasts: () => call('listForecasts'),
  getLastRun: () => call('getLastRun'),
  countOpenSignals: () => call('countOpenSignals'),
  listIncidents: () => call('listIncidents'),
  dismissIncident: (id, reason) => call('dismissIncident', { id, reason }),
  getWebtrigger: () => call('getWebtrigger'),
};
