/**
 * Where a traffic signal's AI visits come from, and the prompts its pages
 * could be cited on (AC-001).
 *
 * A traffic signal names its pages and a session count. The panel asks for
 * the AI referrals by platform and the prompts where the page could be
 * cited; this reads both for the pages given, or the site's referrals for a
 * site-wide signal, in one call (`ae_page_traffic_evidence`, 00143).
 */

import supabaseAdmin from '../../config/supabase.js';

const DAY_MS = 86_400_000;

/**
 * The AI-traffic windows: the last 14 days against the 14 before. The
 * detector compares these (library/detect.js), and the evidence reads them.
 */
export const TRAFFIC_WINDOW_DAYS = 14;

const isoDay = (now, daysAgo) =>
  new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);

/** Rows by the page they were asked for; null for the whole site. */
function byPage(rows) {
  const pages = new Map();
  for (const row of rows ?? []) {
    const page = row.page ?? null;
    const list = pages.get(page);
    if (list) list.push(row);
    else pages.set(page, [row]);
  }
  return pages;
}

/** One page's AI visits by platform, most first, with their totals. */
export function summarizeReferrals(rows) {
  const platforms = rows
    .map((row) => ({
      platform: row.platform ?? 'unknown',
      sessions: Number(row.cur_sessions ?? 0),
      before: Number(row.prev_sessions ?? 0),
    }))
    .filter((p) => p.sessions > 0 || p.before > 0)
    .sort(
      (a, b) =>
        b.sessions - a.sessions || b.before - a.before || a.platform.localeCompare(b.platform),
    );
  return {
    sessions: platforms.reduce((sum, p) => sum + p.sessions, 0),
    before: platforms.reduce((sum, p) => sum + p.before, 0),
    platforms,
  };
}

/**
 * The evidence for `pages`, or for the whole site when `pages` is null, by
 * page. Visits are read from Analytics when it has the page and from the
 * tracking snippet otherwise: the snippet counts the same visits again, so
 * the two are never added, as in the detector. `exact` matches the pages as
 * written, for the detector's own pages; otherwise as paths. The prompts are
 * the active ones naming the page as their target URL.
 */
export async function trafficEvidence(brandId, pages, { now, exact = false }) {
  const { data, error } = await supabaseAdmin.rpc('ae_page_traffic_evidence', {
    p_brand_id: brandId,
    p_pages: pages,
    p_cur_from: isoDay(now, TRAFFIC_WINDOW_DAYS - 1),
    p_cur_to: isoDay(now, 0),
    p_prev_from: isoDay(now, TRAFFIC_WINDOW_DAYS * 2 - 1),
    p_prev_to: isoDay(now, TRAFFIC_WINDOW_DAYS),
    p_exact: exact,
  });
  if (error) throw new Error(`traffic evidence read failed: ${error.message}`);

  const analytics = byPage(data?.analytics);
  const snippet = byPage(data?.snippet);
  const prompts = byPage(data?.prompts);
  return new Map(
    (pages ?? [null]).map((page) => {
      const source = analytics.has(page) ? 'analytics' : snippet.has(page) ? 'snippet' : null;
      const rows = (source === 'analytics' ? analytics : snippet).get(page) ?? [];
      return [
        page,
        {
          referrals: { page, source, ...summarizeReferrals(rows) },
          prompts: (prompts.get(page) ?? []).map((p) => ({
            id: p.prompt_id,
            text: String(p.text ?? '').slice(0, 160),
          })),
        },
      ];
    }),
  );
}
