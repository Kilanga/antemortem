/**
 * Single place where the frontend talks to resolvers. Every call returns the
 * resolver's JSON; a transport failure is normalised into { ok: false, error }.
 */
import { invoke } from '@forge/bridge';

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
};
