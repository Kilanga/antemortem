/**
 * Jira REST client (v3) — the only module that talks to Jira.
 *
 * Everything runs asApp(): the engine and the demo loader run from triggers
 * and queue consumers where there is no user. Resolvers that act on behalf of
 * a user check their Jira permissions first (see resolvers/guards.js).
 */
import api, { route } from '@forge/api';

export const ISSUE_PROPERTY_KEY = 'antemortem';

async function call(method, r, body, { okStatuses = [200, 201, 204] } = {}) {
  const res = await api.asApp().requestJira(r, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
  }
  if (!okStatuses.includes(res.status)) {
    const err = new Error(`Jira ${method} ${res.status}: ${summarizeError(json) || text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function summarizeError(json) {
  if (!json) return '';
  const msgs = [...(json.errorMessages ?? []), ...Object.entries(json.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
  return msgs.join('; ');
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function getProject(key) {
  try {
    return await call('GET', route`/rest/api/3/project/${key}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Company-managed Kanban software project. */
export async function createProject({ key, name, description, leadAccountId }) {
  return call('POST', route`/rest/api/3/project`, {
    key,
    name,
    description,
    leadAccountId,
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    assigneeType: 'UNASSIGNED',
  });
}

export async function deleteProject(key) {
  return call('DELETE', route`/rest/api/3/project/${key}?enableUndo=false`, null, { okStatuses: [204, 404] });
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/**
 * Enhanced JQL search, paginated. `fields` is an array of field ids.
 * Returns all issues (bounded by maxTotal).
 */
export async function searchIssues(jql, { fields = ['summary', 'status', 'labels', 'assignee', 'created', 'updated', 'resolutiondate', 'duedate', 'issuelinks'], maxTotal = 1000, properties = [ISSUE_PROPERTY_KEY] } = {}) {
  const issues = [];
  let nextPageToken;
  do {
    const page = await call('POST', route`/rest/api/3/search/jql`, {
      jql,
      fields,
      properties,
      maxResults: 100,
      nextPageToken,
    });
    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken && issues.length < maxTotal);
  return issues;
}

/** Bulk create (≤ 50 per request). Returns [{key,id}] in input order; errors throw. */
export async function bulkCreateIssues(issueFieldsList) {
  const created = [];
  for (let i = 0; i < issueFieldsList.length; i += 50) {
    const chunk = issueFieldsList.slice(i, i + 50);
    const res = await call('POST', route`/rest/api/3/issue/bulk`, {
      issueUpdates: chunk.map((fields) => ({ fields })),
    });
    if (res.errors?.length) {
      throw new Error(`Bulk create: ${res.errors.map((e) => `#${e.failedElementNumber}: ${summarizeError(e.elementErrors)}`).join(' | ')}`);
    }
    created.push(...res.issues.map((x) => ({ key: x.key, id: x.id })));
  }
  return created;
}

export async function getTransitions(issueKey) {
  const res = await call('GET', route`/rest/api/3/issue/${issueKey}/transitions`);
  return res.transitions ?? [];
}

export async function transitionIssue(issueKey, transitionId) {
  return call('POST', route`/rest/api/3/issue/${issueKey}/transitions`, { transition: { id: String(transitionId) } });
}

/**
 * Create "blocker blocks blocked". Jira's create-link API is counter-intuitive:
 * the `inwardIssue` is the one that carries the OUTWARD description, i.e.
 * { inwardIssue: A, outwardIssue: B, type: Blocks } reads "A blocks B".
 * (Verified empirically on 2026-10-30; the read side in RestGraphSource
 * follows the usual convention: on issue X, outwardIssue Y ⇒ "X blocks Y".)
 */
export async function createIssueLink({ type = 'Blocks', blockerKey, blockedKey }) {
  return call('POST', route`/rest/api/3/issueLink`, {
    type: { name: type },
    inwardIssue: { key: blockerKey },
    outwardIssue: { key: blockedKey },
  });
}

export async function setIssueProperty(issueKey, value, propertyKey = ISSUE_PROPERTY_KEY) {
  return call('PUT', route`/rest/api/3/issue/${issueKey}/properties/${propertyKey}`, value, { okStatuses: [200, 201] });
}

export async function getIssueProperty(issueKey, propertyKey = ISSUE_PROPERTY_KEY) {
  try {
    const res = await call('GET', route`/rest/api/3/issue/${issueKey}/properties/${propertyKey}`);
    return res?.value ?? null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function getIssue(issueKey, fields = ['summary', 'status', 'labels']) {
  return call('GET', route`/rest/api/3/issue/${issueKey}?fields=${encodeURIComponent(fields.join(','))}&properties=${ISSUE_PROPERTY_KEY}`);
}

// ---------------------------------------------------------------------------
// Users / permissions
// ---------------------------------------------------------------------------

/**
 * Does the *current user* (resolver context only) hold a global permission?
 * Runs asUser so Jira evaluates the caller, not the app.
 */
export async function currentUserHasPermission(permission = 'ADMINISTER') {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=${permission}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return false;
  const json = await res.json();
  return Boolean(json?.permissions?.[permission]?.havePermission);
}

/** Build an ADF document from plain paragraphs. */
export function adf(...paragraphs) {
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.filter(Boolean).map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}
