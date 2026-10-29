/**
 * GraphSource — the engine's only view of the organisation's work graph.
 *
 * Two implementations (BUILD.md §6.1):
 *   RestGraphSource  — Jira / Confluence REST + Antemortem's own link table.
 *                      Complete on its own; what every install gets.
 *   TwgGraphSource   — Teamwork Graph (Cypher) on top of the REST source,
 *                      when the EAP scope is available. Enriches people
 *                      availability and decision discovery.
 *
 * Normalised issue shape (every source must return exactly this):
 * {
 *   key, summary, status: { name, category: 'new'|'indeterminate'|'done' },
 *   labels: string[],
 *   people: string[],          // person refs: accountId, or 'label:tech-karim'
 *   vendor: string|null,       // from a 'vendor-*' label
 *   startedAt: Date, dueAt: Date|null, resolvedAt: Date|null, lastActivityAt: Date,
 *   blockedBy: string[], blocks: string[],   // issue keys
 *   timingSource: 'fields' | 'property'      // where the dates came from
 * }
 */
export class GraphSource {
  /** Issues matching a JQL scope, normalised. */
  async issuesInScope(jql) { throw new Error('not implemented'); }

  /** Absences for a person ref overlapping [from, to]. → [{ kind, startsOn, endsOn, note }] */
  async personAvailability(personRef, from, to) { throw new Error('not implemented'); }

  /** Open issues attributed to a vendor/team ref (e.g. 'vendor-boreal'). */
  async teamLoad(teamRef) { throw new Error('not implemented'); }

  /** Specific issues by key, normalised (missing keys are skipped). */
  async issuesByKeys(keys) { throw new Error('not implemented'); }

  /** Human-readable name of this source for the UI and the narrative. */
  get name() { return 'abstract'; }
}

/** Map a Jira status category key to our three buckets. */
export function statusCategory(statusField) {
  const key = statusField?.statusCategory?.key;
  if (key === 'done') return 'done';
  if (key === 'indeterminate') return 'indeterminate';
  return 'new';
}

/** Person refs for an issue: assignee accountId + any 'tech-*' label. */
export function peopleOf(fields) {
  const refs = [];
  if (fields?.assignee?.accountId) refs.push(fields.assignee.accountId);
  for (const l of fields?.labels ?? []) if (l.startsWith('tech-')) refs.push(`label:${l}`);
  return refs;
}

export function vendorOf(labels = []) {
  const v = labels.find((l) => l.startsWith('vendor-'));
  return v ?? null;
}
