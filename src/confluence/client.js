/**
 * Confluence REST client — spaces via the v1 API (classic scope
 * write:confluence-space; the v2 space-creation endpoint is only available
 * on tenants with role-based access control), pages via the v2 API.
 */
import api, { route } from '@forge/api';

async function call(method, r, body, { okStatuses = [200, 201, 202, 204] } = {}) {
  const res = await api.asApp().requestConfluence(r, {
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
    const msg = json?.message || json?.errors?.map?.((e) => e.title || e.message).join('; ') || text.slice(0, 300);
    const err = new Error(`Confluence ${method} ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

/** Returns { id, key, name, homepageId } or null. */
export async function getSpaceByKey(key) {
  const res = await call('GET', route`/wiki/api/v2/spaces?keys=${key}&limit=1`);
  const s = res?.results?.[0];
  return s ? { id: String(s.id), key: s.key, name: s.name, homepageId: s.homepageId ? String(s.homepageId) : null } : null;
}

/** Pages of a space with an exact title (v2). */
export async function findPagesByTitle(spaceId, title) {
  const res = await call('GET', route`/wiki/api/v2/spaces/${spaceId}/pages?title=${title}&limit=5`);
  return (res?.results ?? []).map((p) => ({ id: String(p.id), title: p.title }));
}

/** Direct child pages of a page (v2). */
export async function listChildPages(pageId) {
  const res = await call('GET', route`/wiki/api/v2/pages/${pageId}/children?limit=50`);
  return (res?.results ?? []).map((p) => ({ id: String(p.id), title: p.title }));
}

export async function createSpace({ key, name, description }) {
  await call('POST', route`/wiki/rest/api/space`, {
    key,
    name,
    description: description ? { plain: { value: description, representation: 'plain' } } : undefined,
  });
  // v1 returns the space but not in v2 shape; re-read through v2 for ids.
  return getSpaceByKey(key);
}

export async function deleteSpace(key) {
  return call('DELETE', route`/wiki/rest/api/space/${key}`, null, { okStatuses: [200, 202, 204, 404] });
}

// ---------------------------------------------------------------------------
// Pages (storage format)
// ---------------------------------------------------------------------------

export async function createPage({ spaceId, title, storageBody, parentId = null }) {
  const res = await call('POST', route`/wiki/api/v2/pages`, {
    spaceId: String(spaceId),
    status: 'current',
    title,
    ...(parentId ? { parentId: String(parentId) } : {}),
    body: { representation: 'storage', value: storageBody },
  });
  return { id: String(res.id), title: res.title, version: res.version?.number ?? 1, webui: res._links?.webui ?? null };
}

export async function getPage(id) {
  const res = await call('GET', route`/wiki/api/v2/pages/${id}?body-format=storage`);
  return { id: String(res.id), title: res.title, version: res.version?.number ?? 1, spaceId: String(res.spaceId), parentId: res.parentId ? String(res.parentId) : null, body: res.body?.storage?.value ?? '', webui: res._links?.webui ?? null };
}

export async function updatePage({ id, title, storageBody, version, parentId }) {
  const res = await call('PUT', route`/wiki/api/v2/pages/${id}`, {
    id: String(id),
    status: 'current',
    title,
    ...(parentId ? { parentId: String(parentId) } : {}),
    body: { representation: 'storage', value: storageBody },
    version: { number: version + 1, message: 'Updated by Antemortem' },
  });
  return { id: String(res.id), version: res.version?.number ?? version + 1, webui: res._links?.webui ?? null };
}

/** Absolute URL for a page from its webui path. */
export function pageUrl(webui, siteUrl) {
  if (!webui) return null;
  return `${siteUrl.replace(/\/$/, '')}/wiki${webui}`;
}

/** Escape text for Confluence storage format (XHTML). */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
