/**
 * Site Audit template grouping (SA-007): pages built from one template (the
 * blog's posts, the product pages) share most of their gaps, and fixing the
 * template fixes every page of it: "Fix once, applies to 38 pages". Pure, so
 * the route only reads rows and this decides what they add up to.
 *
 * A page's template is its path with the last part as a wildcard
 * (/blog/milk-drinks → /blog/*); a top-level page has none. A template
 * counts with at least three pages, from the site's pages (site_pages) and
 * the audited ones. Its shared gaps are the signals that fail or warn on at
 * least two-thirds of its audited pages, through each page's latest audit.
 * A template with shared gaps is a row of the Opportunities inbox (the
 * mockup's "/blog/* · 38 pages"), whose audit covers its pages not audited
 * yet.
 */

import { isExcludedPath } from '../pagePaths.js';
import { pageKey } from './history.js';
import { signalsByKey } from './rubric.js';

export const TEMPLATES = Object.freeze({
  /** Pages a template needs to be one. */
  minPages: 3,
  /** Audited pages a shared gap needs. */
  minAudited: 2,
  /** Share of the audited pages a signal must fail or warn on to be the template's. */
  sharedShare: 2 / 3,
  /** Shared gaps listed per template. */
  maxGaps: 3,
  /** Pages one audit of a template starts: a bulk request's limit (BULK_AUDIT_MAX). */
  maxToAudit: 50,
});

/** '/blog/milk-drinks' → '/blog/*', lowercased; null for a top-level page. */
export function templateOf(path) {
  const parts = String(path ?? '')
    .toLowerCase()
    .split('/')
    .filter(Boolean);
  return parts.length < 2 ? null : `/${parts.slice(0, -1).join('/')}/*`;
}

/**
 * @param {object} input
 * @param {string|null} input.primaryHost
 * @param {Array<{ url: string, ga_sessions?: number|null }>} [input.sitePages]  site_pages rows
 * @param {Array<{ key: string, host: string|null, path: string, url: string, auditId: string, score: number|null, status?: string }>} [input.auditPages]
 *   buildAuditPages output
 * @param {Array<{ audit_id: string, signal_key: string }>} [input.failingRows]
 *   failed or warning signals of the audited pages' latest audits
 * @returns {Array<{ template: string, pages: number, audited: number, sharedGaps: Array<{ key: string, label: string, category: string|null, pages: number }>, urls: string[], toAudit: string[], running: boolean, sessions: number|null }>}
 *   biggest first; urls are its pages, toAudit those without a completed
 *   audit (up to maxToAudit), sessions the site pages' summed GA sessions
 */
export function buildTemplates({ primaryHost, sitePages = [], auditPages = [], failingRows = [] }) {
  if (!primaryHost) return [];
  const groups = new Map();
  const groupFor = (path) => {
    // Checkout, login, legal and the like carry no opportunity (pagePaths.js).
    const template = isExcludedPath(path) ? null : templateOf(path);
    if (!template) return null;
    if (!groups.has(template)) {
      groups.set(template, {
        template,
        urls: new Map(),
        auditIds: new Set(),
        auditedKeys: new Set(),
        running: false,
        sessions: null,
      });
    }
    return groups.get(template);
  };

  for (const row of sitePages) {
    const page = pageKey(row.url);
    if (!page || page.host !== primaryHost) continue;
    const group = groupFor(page.path);
    if (!group) continue;
    const key = page.key.toLowerCase();
    if (!group.urls.has(key)) group.urls.set(key, row.url);
    if (typeof row.ga_sessions === 'number') {
      group.sessions = (group.sessions ?? 0) + row.ga_sessions;
    }
  }
  for (const page of auditPages) {
    if (page.host !== primaryHost) continue;
    const group = groupFor(page.path);
    if (!group) continue;
    const key = page.key.toLowerCase();
    if (!group.urls.has(key)) group.urls.set(key, page.url);
    if (page.status === 'running') group.running = true;
    if (page.score !== null) {
      group.auditIds.add(page.auditId);
      group.auditedKeys.add(key);
    }
  }

  // Each audited page once per signal.
  const pagesBySignal = new Map();
  for (const row of failingRows) {
    if (!pagesBySignal.has(row.audit_id)) pagesBySignal.set(row.audit_id, new Set());
    pagesBySignal.get(row.audit_id).add(row.signal_key);
  }

  return [...groups.values()]
    .filter((g) => g.urls.size >= TEMPLATES.minPages)
    .map((g) => {
      const counts = new Map();
      for (const id of g.auditIds) {
        for (const key of pagesBySignal.get(id) ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const audited = g.auditIds.size;
      const sharedGaps =
        audited < TEMPLATES.minAudited
          ? []
          : [...counts]
              .filter(([, pages]) => pages / audited >= TEMPLATES.sharedShare)
              .map(([key, pages]) => ({
                key,
                label: signalsByKey[key]?.label ?? key,
                category: signalsByKey[key]?.category ?? null,
                pages,
              }))
              .sort((a, b) => b.pages - a.pages || a.label.localeCompare(b.label))
              .slice(0, TEMPLATES.maxGaps);
      return {
        template: g.template,
        pages: g.urls.size,
        audited,
        sharedGaps,
        urls: [...g.urls.values()],
        toAudit: [...g.urls]
          .filter(([key]) => !g.auditedKeys.has(key))
          .map(([, url]) => url)
          .slice(0, TEMPLATES.maxToAudit),
        running: g.running,
        sessions: g.sessions,
      };
    })
    .sort((a, b) => b.pages - a.pages || a.template.localeCompare(b.template));
}

/**
 * The Opportunities inbox's template rows (mockup: "/blog/* · 38 pages"):
 * one per template whose pages share gaps, why being those gaps. Shaped like
 * a page's row, with `template` for its pages: how many, how many audited,
 * and the ones an audit of it starts.
 *
 * @param {ReturnType<typeof buildTemplates>} templates
 * @param {(path: string) => boolean} [excludedByPattern]  the brand's exclude patterns
 */
export function templateOpportunities(templates, excludedByPattern = () => false) {
  return templates
    .filter((t) => t.sharedGaps.length > 0 && !excludedByPattern(t.template))
    .map((t) => ({
      key: `template:${t.template}`,
      url: null,
      path: t.template,
      title: null,
      reasons: [
        { type: 'template_gaps', gaps: t.sharedGaps.map((g) => ({ key: g.key, label: g.label })) },
      ],
      pinned: false,
      running: t.running,
      sessions: t.sessions,
      citations: null,
      lastAudit: null,
      template: { pages: t.pages, audited: t.audited, toAudit: t.toAudit },
    }));
}
