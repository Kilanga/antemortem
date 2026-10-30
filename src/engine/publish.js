/**
 * Publication lifecycle of a future incident (BUILD.md §6.6).
 *
 *   forecast ≥ threshold  → draft/published: Confluence page under
 *                           "Projected incidents", corrective actions as
 *                           Jira issues, page updated on every run
 *   forecast < threshold  → averted: page moved under "Averted incidents"
 *                           with a banner and the cost avoided
 *   incident date passed and still breaching → materialized
 *   user dismisses        → dismissed (page banner, no more updates)
 *
 * All Jira/Confluence calls are best-effort: a failure is recorded on the
 * incident row (`publish_error` in `actions` JSON) and the run continues.
 */
import { kvs } from '@forge/kvs';
import api, { route } from '@forge/api';
import { futureIncidents, actionItems, contracts, decisions as decisionsRepo } from '../db/repo/index.js';
import { composeIncident } from './narrative/index.js';
import { renderStorage } from './narrative/confluence.js';
import * as confluence from '../confluence/client.js';
import * as jira from '../jira/client.js';

const PARENTS = { projected: 'Projected incidents', averted: 'Averted incidents' };

export async function reconcileIncident({ result, settings, now }) {
  const { obligation, forecast, metric, chain, directSignals, assumptionSignals, assumptionResults } = result;
  const decisions = result.decisions ?? [];
  const threshold = Number(settings.publishThreshold ?? 0.6);
  let [existing] = await futureIncidents.list({ where: "obligation_id = ? AND status IN ('draft','published')", params: [obligation.id], limit: 1 });
  const breaching = !forecast.healthy && forecast.probability >= threshold;

  if (!breaching && !existing) return { action: 'none' };

  const siteUrl = await getSiteUrl();
  const contract = obligation.contract_id ? await contracts.get(obligation.contract_id) : null;
  const signals = [...directSignals, ...assumptionSignals];
  const doc = composeIncident({ obligation, contract, decisions, metric, signals, assumptionResults, forecast, chain, now, siteUrl });

  // The incident comes back (an action reopened, the facts changed again):
  // the averted page of the same period is reinstated rather than duplicated.
  let reinstated = false;
  if (breaching && !existing) {
    const [averted] = await futureIncidents.list({ where: "obligation_id = ? AND status = 'averted' AND incident_date = ?", params: [obligation.id, doc.incidentDate], limit: 1 });
    if (averted) { existing = averted; reinstated = true; }
  }

  if (breaching) {
    const incident = existing ?? (await futureIncidents.create({
      forecast_id: result.forecastId,
      obligation_id: obligation.id,
      title: doc.title,
      incident_date: doc.incidentDate,
      status: 'draft',
      summary: doc.summary,
    }));
    await publish({ incident, doc, forecastId: result.forecastId, settings, siteUrl, now, reinstated });
    return { action: reinstated ? 'reinstated' : existing ? 'updated' : 'published', incidentId: incident.id };
  }

  // Below threshold with an open incident: averted (actions done, or the facts changed).
  const materialized = existing.incident_date && new Date(`${String(existing.incident_date).slice(0, 10)}T23:59:59Z`) < now && !metric.holds;
  if (materialized) {
    await setStatus(existing, 'materialized', { doc, settings, siteUrl, now });
    return { action: 'materialized', incidentId: existing.id };
  }
  await setStatus(existing, 'averted', { doc, settings, siteUrl, now, costAvoided: existing.actions?.cost ?? forecast.projected_cost ?? doc.cost });
  return { action: 'averted', incidentId: existing.id };
}

// ---------------------------------------------------------------------------

async function publish({ incident, doc, forecastId, settings, siteUrl, now, reinstated = false }) {
  const errors = [];
  let items = await actionItems.list({ where: 'future_incident_id = ?', params: [incident.id], limit: 50 });

  // 1. Corrective actions → Jira issues (once), then status sync.
  if (!items.length && settings.actionsProjectKey) {
    try {
      items = await createActionIssues({ incident, doc, projectKey: settings.actionsProjectKey, siteUrl });
    } catch (err) {
      errors.push(`actions: ${err.message}`);
    }
  } else if (items.length) {
    items = await syncActionStatuses(items);
  }
  const itemsWithUrl = items.map((a) => ({ ...a, url: a.issue_key && siteUrl ? `${siteUrl}/browse/${a.issue_key}` : null }));

  // 2. Confluence page (create or update).
  let pageId = incident.confluence_page_id;
  let pageUrl = incident.confluence_page_url;
  let version = incident.version ?? 1;
  if (settings.confluenceSpaceKey) {
    try {
      const body = renderStorage(doc, { status: 'published', actionItems: itemsWithUrl });
      if (!pageId) {
        const parent = await ensureParent(settings.confluenceSpaceKey, 'projected');
        const page = await confluence.createPage({ spaceId: parent.spaceId, parentId: parent.id, title: doc.title, storageBody: body });
        pageId = page.id;
        version = page.version;
        pageUrl = confluence.pageUrl(page.webui, siteUrl);
      } else {
        const current = await confluence.getPage(pageId);
        const parent = reinstated ? await ensureParent(settings.confluenceSpaceKey, 'projected') : null;
        const page = await confluence.updatePage({ id: pageId, title: doc.title, storageBody: body, version: current.version, parentId: parent?.id ?? current.parentId });
        version = page.version;
        pageUrl = confluence.pageUrl(page.webui, siteUrl) ?? pageUrl;
      }
    } catch (err) {
      errors.push(`page: ${err.message}`);
    }
  }

  await futureIncidents.update(incident.id, {
    forecast_id: forecastId,
    title: doc.title,
    incident_date: doc.incidentDate,
    status: 'published',
    confluence_page_id: pageId,
    confluence_page_url: pageUrl,
    version,
    averted_at: null,
    cost_avoided: null,
    summary: doc.summary,
    impact_statement: doc.sections.impact.join(' '),
    root_cause: doc.sections.rootCause.join('\n'),
    timeline: doc.sections.timeline,
    contributing_factors: doc.sections.factors,
    actions: { items: itemsWithUrl.map((a) => ({ id: a.id, title: a.title, issue_key: a.issue_key, status: a.status, url: a.url })), probability: doc.probability, cost: doc.cost, currency: doc.currency, errors },
  });
}

async function setStatus(incident, status, { doc, settings, siteUrl, now, costAvoided = null }) {
  const items = await syncActionStatuses(await actionItems.list({ where: 'future_incident_id = ?', params: [incident.id], limit: 50 }));
  const itemsWithUrl = items.map((a) => ({ ...a, url: a.issue_key && siteUrl ? `${siteUrl}/browse/${a.issue_key}` : null }));
  const errors = [];
  const daysBefore = Math.max(0, Math.round((new Date(`${String(incident.incident_date).slice(0, 10)}T12:00:00Z`) - now) / 86400_000));
  if (incident.confluence_page_id && settings.confluenceSpaceKey) {
    try {
      const current = await confluence.getPage(incident.confluence_page_id);
      const body = renderStorage({ ...doc, daysBefore }, { status, averted: status === 'averted' ? { at: now, costAvoided, daysBefore } : null, actionItems: itemsWithUrl });
      const parent = status === 'averted' ? await ensureParent(settings.confluenceSpaceKey, 'averted') : null;
      await confluence.updatePage({ id: incident.confluence_page_id, title: current.title, storageBody: body, version: current.version, parentId: parent?.id ?? current.parentId });
    } catch (err) {
      errors.push(`page: ${err.message}`);
    }
  }
  const patch = { status, actions: { items: itemsWithUrl.map((a) => ({ id: a.id, title: a.title, issue_key: a.issue_key, status: a.status, url: a.url })), probability: doc.probability, cost: doc.cost, currency: doc.currency, errors } };
  if (status === 'averted') { patch.averted_at = now; patch.cost_avoided = costAvoided; }
  if (status === 'materialized') patch.materialized_at = now;
  await futureIncidents.update(incident.id, patch);
}

export async function dismissIncident(id, reason) {
  const incident = await futureIncidents.get(id);
  if (!incident) return null;
  await futureIncidents.update(id, { status: 'dismissed', dismissed_reason: reason ?? null });
  return futureIncidents.get(id);
}

// ---------------------------------------------------------------------------

async function createActionIssues({ incident, doc, projectKey, siteUrl }) {
  const project = await jira.getProject(projectKey);
  if (!project) throw new Error(`Jira project ${projectKey} not found`);
  const task = (project.issueTypes ?? []).find((t) => t.name === 'Task' && !t.subtask) ?? (project.issueTypes ?? []).find((t) => !t.subtask);
  if (!task) throw new Error('No usable issue type');
  const specs = doc.sections.actions;
  if (!specs.length) return [];
  const created = await jira.bulkCreateIssues(specs.map((a) => ({
    project: { key: projectKey },
    issuetype: { id: task.id },
    summary: a.title.slice(0, 250),
    labels: ['antemortem', 'corrective-action'],
    description: jira.adf(a.description, `Corrective action for the projected incident "${doc.title}".`, incident.confluence_page_url ? `Post-mortem: ${incident.confluence_page_url}` : null),
  })));
  const items = [];
  for (let i = 0; i < specs.length; i++) {
    const row = await actionItems.create({ future_incident_id: incident.id, title: specs[i].title, description: specs[i].description, issue_key: created[i]?.key ?? null, status: 'open', prevents_signal_types: specs[i].prevents_signal_types });
    items.push(row);
  }
  return items;
}

export async function syncActionStatuses(items) {
  const out = [];
  for (const a of items) {
    if (!a.issue_key) { out.push(a); continue; }
    try {
      const raw = await jira.getIssue(a.issue_key, ['status']);
      const cat = raw?.fields?.status?.statusCategory?.key;
      const status = !raw ? a.status : cat === 'done' ? 'done' : cat === 'indeterminate' ? 'in_progress' : 'open';
      out.push(status !== a.status ? await actionItems.update(a.id, { status }) : a);
    } catch {
      out.push(a);
    }
  }
  return out;
}

/** Parent pages ("Projected incidents" / "Averted incidents") in the configured space, cached in KVS. */
async function ensureParent(spaceKey, kind) {
  const cacheKey = `confluence.parents.${spaceKey}`;
  const cache = (await kvs.get(cacheKey)) ?? {};
  const space = await confluence.getSpaceByKey(spaceKey);
  if (!space) throw new Error(`Confluence space ${spaceKey} not found`);
  if (cache[kind]) {
    try {
      const page = await confluence.getPage(cache[kind]);
      if (page) return { id: page.id, spaceId: space.id };
    } catch { /* recreate below */ }
  }
  const page = await confluence.createPage({
    spaceId: space.id,
    title: PARENTS[kind],
    storageBody: kind === 'projected'
      ? '<p>Post-mortems of incidents that have not happened yet, written by Antemortem from evidence present in Jira and Confluence. Each page archives itself under <em>Averted incidents</em> once its corrective actions bring the forecast below the publish threshold.</p>'
      : '<p>Incidents that never happened. Each page below was a projected post-mortem whose corrective actions were completed in time.</p>',
  });
  cache[kind] = page.id;
  await kvs.set(cacheKey, cache);
  return { id: page.id, spaceId: space.id };
}

/** Site base URL (for links in pages and issues), cached in KVS. */
export async function getSiteUrl() {
  const cached = await kvs.get('site.url');
  if (cached) return cached;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
    const json = await res.json();
    if (json?.baseUrl) { await kvs.set('site.url', json.baseUrl); return json.baseUrl; }
  } catch { /* fall through */ }
  return '';
}
