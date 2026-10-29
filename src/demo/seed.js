/**
 * Demo loader — runs in an async-event consumer (up to 15 min), reports
 * progress to the KVS so the command center can poll it, and is resumable:
 * every step checks what already exists before creating anything.
 */
import { kvs } from '@forge/kvs';
import { buildScenario, issueFields, issueProperty, DEMO } from './scenario.js';
import * as jira from '../jira/client.js';
import * as confluence from '../confluence/client.js';
import { contracts, obligations, decisions, assumptions, availability, linkObjects, signals, forecasts, futureIncidents, actionItems } from '../db/repo/index.js';
import { execute } from '../db/client.js';
import { saveSettings } from '../settings.js';

export const PROGRESS_KEY = 'demo.progress';
export const STATE_KEY = 'demo.state';

const STEPS = [
  ['project', 'Create Jira project NFS'],
  ['issues', 'Create ~90 field-service issues'],
  ['transitions', 'Resolve historical interventions'],
  ['properties', 'Backdate issue timelines'],
  ['links', 'Link the blocked dependency'],
  ['space', 'Create Confluence space ANTE'],
  ['pages', 'Write steering-committee pages'],
  ['model', 'Record contract, obligations, decisions, assumptions'],
  ['settings', 'Point Antemortem at NFS / ANTE'],
];

export async function getProgress() {
  return (await kvs.get(PROGRESS_KEY)) ?? { status: 'idle', steps: [], error: null };
}

async function setProgress(p) {
  await kvs.set(PROGRESS_KEY, { ...p, updatedAt: new Date().toISOString() });
}

async function getState() {
  return (await kvs.get(STATE_KEY)) ?? { issueKeys: {}, pageIds: {}, model: {} };
}
async function setState(s) {
  await kvs.set(STATE_KEY, s);
}

/**
 * Main entry — called by the consumer with { leadAccountId }.
 */
export async function loadDemo({ leadAccountId }) {
  const scenario = buildScenario(new Date());
  const state = await getState();
  const progress = { status: 'running', steps: STEPS.map(([key, label]) => ({ key, label, status: 'pending' })), error: null, startedAt: new Date().toISOString() };
  await setProgress(progress);

  const mark = async (key, status, detail) => {
    const s = progress.steps.find((x) => x.key === key);
    s.status = status;
    if (detail) s.detail = detail;
    await setProgress(progress);
  };

  try {
    for (const [key] of STEPS) {
      await mark(key, 'running');
      const detail = await runStep(key, { scenario, state, leadAccountId });
      await setState(state);
      await mark(key, 'done', detail);
    }
    progress.status = 'done';
    progress.finishedAt = new Date().toISOString();
    await setProgress(progress);
    await saveSettings({ demoLoaded: true, demoLoadedAt: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    const msg = String(err?.message ?? err);
    console.error('[antemortem] demo load failed', err);
    const running = progress.steps.find((s) => s.status === 'running');
    if (running) running.status = 'failed';
    progress.status = 'failed';
    progress.error = msg;
    await setProgress(progress);
    await setState(state);
    return { ok: false, error: msg };
  }
}

async function runStep(key, ctx) {
  switch (key) {
    case 'project': return stepProject(ctx);
    case 'issues': return stepIssues(ctx);
    case 'transitions': return stepTransitions(ctx);
    case 'properties': return stepProperties(ctx);
    case 'links': return stepLinks(ctx);
    case 'space': return stepSpace(ctx);
    case 'pages': return stepPages(ctx);
    case 'model': return stepModel(ctx);
    case 'settings': return stepSettings(ctx);
    default: throw new Error(`unknown step ${key}`);
  }
}

// ---------------------------------------------------------------------------

async function stepProject({ state, leadAccountId }) {
  let project = await jira.getProject(DEMO.projectKey);
  if (!project) {
    if (!leadAccountId) throw new Error('No lead account id available to create the project.');
    await jira.createProject({
      key: DEMO.projectKey,
      name: DEMO.projectName,
      description: `Demo data for Antemortem — ${DEMO.contractor} field operations for ${DEMO.client}. Entirely fictional.`,
      leadAccountId,
    });
    project = await jira.getProject(DEMO.projectKey);
  }
  // Pick the "Task" issue type (fall back to the first non-subtask type).
  const types = project.issueTypes ?? [];
  const task = types.find((t) => t.name === 'Task' && !t.subtask) ?? types.find((t) => !t.subtask);
  if (!task) throw new Error('Project has no usable issue type.');
  state.projectId = project.id;
  state.issueTypeId = task.id;
  return `${project.key} (${project.name}), issue type ${task.name}`;
}

async function stepIssues({ scenario, state }) {
  const todo = scenario.issues.filter((i) => !state.issueKeys[i.id]);
  if (!todo.length) return `${Object.keys(state.issueKeys).length} issues already present`;
  let withDue = true;
  try {
    const created = await jira.bulkCreateIssues(todo.map((i) => issueFields(i, DEMO.projectKey, state.issueTypeId)));
    created.forEach((c, idx) => { state.issueKeys[todo[idx].id] = c.key; });
  } catch (err) {
    // Some project templates don't expose Due date on the create screen.
    // Timing is carried by the issue property anyway, so retry without it.
    if (!/duedate/i.test(err.message)) throw err;
    withDue = false;
    const created = await jira.bulkCreateIssues(todo.map((i) => {
      const f = issueFields(i, DEMO.projectKey, state.issueTypeId);
      delete f.duedate;
      return f;
    }));
    created.forEach((c, idx) => { state.issueKeys[todo[idx].id] = c.key; });
  }
  return `${Object.keys(state.issueKeys).length} issues${withDue ? '' : ' (due date not on create screen; carried by property)'}`;
}

async function stepTransitions({ scenario, state }) {
  const resolved = scenario.issues.filter((i) => i.resolved);
  state.transitioned ??= {};
  const pending = resolved.filter((i) => !state.transitioned[i.id]);
  if (!pending.length) return `${resolved.length} already resolved`;
  // Transition ids are shared by all issues in a company-managed project.
  const first = state.issueKeys[pending[0].id];
  const transitions = await jira.getTransitions(first);
  const done = transitions.find((t) => t.to?.statusCategory?.key === 'done') ?? transitions.find((t) => /done/i.test(t.name));
  if (!done) throw new Error(`No "Done" transition found (${transitions.map((t) => t.name).join(', ')})`);
  let n = 0;
  for (const i of pending) {
    await jira.transitionIssue(state.issueKeys[i.id], done.id);
    state.transitioned[i.id] = true;
    n += 1;
    if (n % 10 === 0) await setState(state);
  }
  return `${resolved.length} resolved via "${done.name}"`;
}

async function stepProperties({ scenario, state }) {
  state.propertied ??= {};
  let n = 0;
  for (const i of scenario.issues) {
    if (state.propertied[i.id]) continue;
    await jira.setIssueProperty(state.issueKeys[i.id], issueProperty(i));
    state.propertied[i.id] = true;
    n += 1;
    if (n % 15 === 0) await setState(state);
  }
  return `${scenario.issues.length} timelines set`;
}

async function stepLinks({ scenario, state }) {
  state.linked ??= {};
  for (const l of scenario.links) {
    const id = `${l.outward}>${l.inward}`;
    if (state.linked[id]) continue;
    await jira.createIssueLink({ type: l.type, outwardKey: state.issueKeys[l.outward], inwardKey: state.issueKeys[l.inward] });
    state.linked[id] = true;
  }
  return `${scenario.links.length} link(s): ${state.issueKeys[scenario.special.amendment]} blocks ${state.issueKeys[scenario.special.badges]}`;
}

async function stepSpace({ state }) {
  let space = await confluence.getSpaceByKey(DEMO.spaceKey);
  if (!space) {
    space = await confluence.createSpace({ key: DEMO.spaceKey, name: DEMO.spaceName, description: 'Demo space for Antemortem — steering-committee minutes and projected incidents. Entirely fictional.' });
  }
  if (!space) throw new Error('Space creation returned nothing.');
  state.spaceId = space.id;
  state.spaceHomepageId = space.homepageId;
  return `${space.key} (${space.name})`;
}

async function stepPages({ scenario, state }) {
  for (const [ref, page] of Object.entries(scenario.pages)) {
    if (state.pageIds[ref]) continue;
    const created = await confluence.createPage({ spaceId: state.spaceId, title: page.title, storageBody: page.body });
    state.pageIds[ref] = { id: created.id, webui: created.webui };
  }
  return `${Object.keys(scenario.pages).length} pages`;
}

async function stepModel({ scenario, state }) {
  // Idempotent: if the demo contract already exists, wipe model rows and redo.
  if (state.model.contractId) await deleteModelRows(state);

  const contract = await contracts.create({ ...scenario.contract });
  state.model = { contractId: contract.id, obligationIds: {}, decisionIds: {}, assumptionIds: [] , availabilityIds: [] };

  for (const o of scenario.obligations) {
    const { ref, healthy, ...row } = o;
    const created = await obligations.create({ ...row, contract_id: contract.id, period_starts_on: scenario.window.startsOn, period_ends_on: scenario.window.endsOn });
    state.model.obligationIds[ref] = created.id;
  }

  for (const d of scenario.decisions) {
    const page = state.pageIds[d.pageRef];
    const created = await decisions.create({
      title: d.title,
      statement: d.statement,
      rationale: d.rationale,
      decided_at: d.decided_at,
      decided_by: [],
      source_type: 'confluence_page',
      source_id: page?.id ?? null,
      source_url: page?.webui ? `/wiki${page.webui}` : null,
      alternatives_rejected: d.alternatives_rejected,
      status: 'active',
    });
    state.model.decisionIds[d.ref] = created.id;
    for (const a of d.assumptions) {
      const params = { ...a.params };
      if (params.issueRef) { params.issueKey = state.issueKeys[params.issueRef]; delete params.issueRef; }
      const asm = await assumptions.create({ decision_id: created.id, statement: a.statement, kind: a.kind, params, status: 'holding' });
      state.model.assumptionIds.push(asm.id);
      await linkObjects('decision', created.id, 'rests_on', 'assumption', asm.id, { origin: 'import' });
      if (params.issueKey) await linkObjects('assumption', asm.id, 'about', 'issue', params.issueKey, { origin: 'import' });
      if (params.personRef) await linkObjects('assumption', asm.id, 'about', 'person', params.personRef, { origin: 'import' });
    }
    for (const oref of d.obligationRefs) {
      await linkObjects('obligation', state.model.obligationIds[oref], 'depends_on', 'decision', created.id, { origin: 'import' });
    }
  }

  for (const a of scenario.availability) {
    const created = await availability.create(a);
    state.model.availabilityIds.push(created.id);
  }
  return `1 contract, ${scenario.obligations.length} obligations, ${scenario.decisions.length} decisions, ${state.model.assumptionIds.length} assumptions`;
}

async function stepSettings() {
  await saveSettings({ confluenceSpaceKey: DEMO.spaceKey, actionsProjectKey: DEMO.projectKey });
  return `space ${DEMO.spaceKey}, project ${DEMO.projectKey}`;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function deleteModelRows(state) {
  const m = state.model ?? {};
  // Rows that a crashed earlier load may have written without an id.
  for (const t of ['contract', 'obligation', 'decision', 'assumption', 'link', 'availability']) {
    await execute(`DELETE FROM ${t} WHERE id = '' OR id IS NULL`);
  }
  // Demo contracts are flagged; anything hanging off them goes too.
  const demoContracts = await contracts.list({ where: 'is_demo = 1', includeArchived: true });
  for (const c of demoContracts) {
    const obls = await obligations.list({ where: 'contract_id = ?', params: [c.id], includeArchived: true });
    m.obligationIds = { ...(m.obligationIds ?? {}), ...Object.fromEntries(obls.map((o) => [o.code + ':' + o.id, o.id])) };
    m.contractId = m.contractId ?? c.id;
    if (m.contractId !== c.id) await contracts.hardDelete(c.id);
  }
  const obligationIds = Object.values(m.obligationIds ?? {});
  for (const oid of obligationIds) {
    const fis = await futureIncidents.list({ where: 'obligation_id = ?', params: [oid], includeArchived: true });
    for (const fi of fis) {
      await actionItems.deleteWhere('future_incident_id = ?', [fi.id]);
      await futureIncidents.hardDelete(fi.id);
    }
    await forecasts.deleteWhere('obligation_id = ?', [oid]);
    await signals.deleteWhere('subject_type = ? AND subject_id = ?', ['obligation', oid]);
    await execute('DELETE FROM link WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)', ['obligation', oid, 'obligation', oid]);
    await obligations.hardDelete(oid);
  }
  for (const did of Object.values(m.decisionIds ?? {})) {
    await execute('DELETE FROM link WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)', ['decision', did, 'decision', did]);
    await signals.deleteWhere('subject_type = ? AND subject_id = ?', ['decision', did]);
    await decisions.hardDelete(did);
  }
  for (const aid of m.assumptionIds ?? []) {
    await execute('DELETE FROM link WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)', ['assumption', aid, 'assumption', aid]);
    await signals.deleteWhere('subject_type = ? AND subject_id = ?', ['assumption', aid]);
    await assumptions.hardDelete(aid);
  }
  for (const vid of m.availabilityIds ?? []) await availability.hardDelete(vid);
  if (m.contractId) await contracts.hardDelete(m.contractId);
  state.model = {};
}

export async function resetDemo() {
  const state = await getState();
  const progress = { status: 'resetting', steps: [], error: null, startedAt: new Date().toISOString() };
  await setProgress(progress);
  const report = [];
  try {
    await deleteModelRows(state);
    report.push('model rows removed');
    if (await jira.getProject(DEMO.projectKey)) {
      await jira.deleteProject(DEMO.projectKey);
      report.push(`project ${DEMO.projectKey} deleted`);
    }
    if (await confluence.getSpaceByKey(DEMO.spaceKey)) {
      await confluence.deleteSpace(DEMO.spaceKey);
      report.push(`space ${DEMO.spaceKey} deletion queued`);
    }
    await kvs.delete(STATE_KEY);
    await saveSettings({ demoLoaded: false, demoLoadedAt: null });
    await setProgress({ status: 'idle', steps: [], error: null, lastReset: new Date().toISOString(), report });
    return { ok: true, report };
  } catch (err) {
    const msg = String(err?.message ?? err);
    await setProgress({ status: 'failed', steps: [], error: `Reset failed: ${msg}`, report });
    return { ok: false, error: msg, report };
  }
}
