/**
 * App settings live in the Key-Value Store (small, non-relational, read on
 * every analysis run). Everything relational lives in Forge SQL.
 */
import { kvs } from '@forge/kvs';

const KEY = 'settings';

export const DEFAULT_SETTINGS = {
  // Confluence space where future incidents are published (set in Settings).
  confluenceSpaceKey: null,
  // Jira project where corrective actions are created (set in Settings).
  actionsProjectKey: null,
  // Forecast probability above which a future incident is published.
  publishThreshold: 0.6,
  // rest | twg | auto — see BUILD.md §6.1
  graphSource: 'rest',
  // Set by the demo loader so Reset knows what to clean.
  demoLoaded: false,
  demoLoadedAt: null,
};

export async function getSettings() {
  const stored = (await kvs.get(KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...sanitize(patch) };
  await kvs.set(KEY, next);
  return next;
}

/** Only known keys, only sane values — the resolver passes user input here. */
function sanitize(patch) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in patch)) continue;
    let v = patch[key];
    if (key === 'publishThreshold') {
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      v = Math.min(0.98, Math.max(0.05, v));
    }
    if (key === 'graphSource' && !['rest', 'twg', 'auto'].includes(v)) continue;
    if ((key === 'confluenceSpaceKey' || key === 'actionsProjectKey') && v !== null) {
      v = String(v).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(v)) continue;
    }
    out[key] = v;
  }
  return out;
}
