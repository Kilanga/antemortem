import { GraphSource, statusCategory, peopleOf, vendorOf } from './GraphSource.js';
import { searchIssues, ISSUE_PROPERTY_KEY } from '../jira/client.js';
import { availability } from '../db/repo/index.js';
import { toSqlDate } from '../db/client.js';

const toDate = (v) => (v ? new Date(v) : null);

/**
 * Jira/Confluence REST implementation.
 *
 * Timing: by default an issue's clock is `created` → `resolutiondate`, with
 * `duedate` as the deadline. If the issue carries an `antemortem` property
 * with explicit dates, those win. The demo scenario uses the property to
 * give issues a six-week history (Jira does not let an API client backdate
 * `created`); real installs rarely need it, but a migration tool could set
 * it too.
 */
export class RestGraphSource extends GraphSource {
  get name() { return 'Jira & Confluence REST'; }

  async issuesInScope(jql) {
    const raw = await searchIssues(jql);
    return raw.map(normalise);
  }

  async personAvailability(personRef, from, to) {
    const rows = await availability.list({
      where: 'account_id = ? AND ends_on >= ? AND starts_on <= ?',
      params: [personRef, toSqlDate(from), toSqlDate(to)],
      orderBy: 'starts_on ASC',
    });
    return rows.map((r) => ({ kind: r.kind, startsOn: toDate(r.starts_on), endsOn: toDate(r.ends_on), note: r.note, displayName: r.display_name }));
  }

  async issuesByKeys(keys) {
    const clean = [...new Set(keys)].filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k));
    if (!clean.length) return [];
    return this.issuesInScope(`key in (${clean.join(', ')})`);
  }

  async teamLoad(teamRef) {
    const issues = await this.issuesInScope(`labels = "${teamRef}" AND statusCategory != Done`);
    return issues;
  }
}

export function normalise(issue) {
  const f = issue.fields ?? {};
  const prop = issue.properties?.[ISSUE_PROPERTY_KEY] ?? null;
  const labels = f.labels ?? [];
  const links = f.issuelinks ?? [];
  const blockedBy = [];
  const blocks = [];
  for (const l of links) {
    if (l.type?.name !== 'Blocks') continue;
    if (l.inwardIssue) blockedBy.push(l.inwardIssue.key); // "is blocked by"
    if (l.outwardIssue) blocks.push(l.outwardIssue.key);  // "blocks"
  }
  const hasProp = prop && (prop.startedAt || prop.resolvedAt || prop.dueAt);
  return {
    key: issue.key,
    summary: f.summary ?? '',
    status: { name: f.status?.name ?? '?', category: statusCategory(f.status) },
    labels,
    people: peopleOf(f),
    vendor: vendorOf(labels),
    startedAt: toDate(hasProp && prop.startedAt ? prop.startedAt : f.created),
    dueAt: toDate(hasProp && prop.dueAt ? prop.dueAt : f.duedate),
    resolvedAt: toDate(hasProp && prop.resolvedAt !== undefined ? prop.resolvedAt : f.resolutiondate),
    lastActivityAt: toDate(hasProp && prop.lastActivityAt ? prop.lastActivityAt : f.updated),
    blockedBy,
    blocks,
    timingSource: hasProp ? 'property' : 'fields',
  };
}
