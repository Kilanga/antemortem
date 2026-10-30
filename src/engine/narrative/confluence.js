/**
 * Render a composed incident to Confluence storage format (XHTML subset).
 * Kept plain on purpose: headings, paragraphs, lists, a table for the
 * timeline, Confluence panels for the banner. Reads like the post-mortems
 * people already write — only the date is in the future.
 */
import { esc } from '../../confluence/client.js';
import { fmtMoney, longDate } from './index.js';

export function renderStorage(doc, { status = 'published', averted = null, actionItems = [] } = {}) {
  const pct = Math.round(doc.probability * 100);
  const parts = [];

  if (status === 'averted' && averted) {
    parts.push(panel('success', `<p><strong>Averted on ${esc(longDate(averted.at))}.</strong> Estimated cost avoided: ${esc(fmtMoney(averted.costAvoided, doc.currency))}. This post-mortem was written ${averted.daysBefore} days before the projected incident and never had to be written for real.</p>`));
  } else if (status === 'materialized') {
    parts.push(panel('error', `<p><strong>This post-mortem was written ${esc(String(doc.daysBefore ?? ''))} days before the incident.</strong> The projected breach occurred.</p>`));
  } else {
    parts.push(panel('note', `<p><strong>This incident has not happened yet.</strong> Projected for ${esc(longDate(doc.incidentDate))}, probability ${pct} %, penalty ${esc(fmtMoney(doc.cost, doc.currency))}. Every line below links to evidence that exists today.</p>`));
  }

  parts.push(h2('Impact'), ...doc.sections.impact.map(p));
  parts.push(h2('Root cause'), ...doc.sections.rootCause.map((t) => (t.startsWith('• ') ? null : p(t))).filter(Boolean));
  const bullets = doc.sections.rootCause.filter((t) => t.startsWith('• ')).map((t) => t.slice(2));
  if (bullets.length) parts.push(ul(bullets));

  parts.push(h2('Timeline'));
  parts.push(`<table><tbody><tr><th>Date</th><th>Event</th></tr>${doc.sections.timeline.map((t) => `<tr><td>${esc(t.date)}</td><td>${t.projected ? `<em>${esc(t.text)}</em>` : esc(t.text)}${t.link ? ` <a href="${esc(t.link)}">↗</a>` : ''}</td></tr>`).join('')}</tbody></table>`);

  if (doc.sections.factors.length) parts.push(h2('Contributing factors'), ul(doc.sections.factors));

  parts.push(h2(status === 'averted' ? 'What prevented it' : 'Corrective actions'));
  if (actionItems.length) {
    parts.push(`<table><tbody><tr><th>Action</th><th>Jira</th><th>Status</th></tr>${actionItems.map((a) => `<tr><td>${esc(a.title)}</td><td>${a.issue_key && a.url ? `<a href="${esc(a.url)}">${esc(a.issue_key)}</a>` : esc(a.issue_key ?? '—')}</td><td>${esc(a.status)}</td></tr>`).join('')}</tbody></table>`);
  } else {
    parts.push(ul(doc.sections.actions.map((a) => a.title)));
  }

  if (doc.sections.evidence.length) {
    parts.push(h2('Source decision'), ul(doc.sections.evidence.map((e) => (e.url ? `<a href="${esc(e.url)}">${esc(e.label)}</a>` : esc(e.label))), true));
  }

  parts.push(h2('How this forecast was computed'), ul(doc.sections.method));
  parts.push(`<p><em>Written by Antemortem from the linked evidence.</em></p>`);
  return parts.join('\n');
}

const h2 = (t) => `<h2>${esc(t)}</h2>`;
const p = (t) => `<p>${esc(t)}</p>`;
const ul = (items, raw = false) => `<ul>${items.map((i) => `<li>${raw ? i : esc(i)}</li>`).join('')}</ul>`;
const panel = (type, inner) => `<ac:structured-macro ac:name="${type === 'success' ? 'tip' : type === 'error' ? 'warning' : 'info'}"><ac:rich-text-body>${inner}</ac:rich-text-body></ac:structured-macro>`;
