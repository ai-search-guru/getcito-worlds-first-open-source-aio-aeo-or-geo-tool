/**
 * "Send to Action Center" from the AI Traffic page's Pages section (AT-006,
 * spec §3.5): one page, or a list's pages, sent as one action.
 *
 * The person sends pages from a list; the lists themselves are read again
 * here from ai_traffic_pages (00178) over the same range, so only the pages
 * still on that list go, with their figures as the database has them, not as
 * a client says they are. Two lists can be sent:
 *
 *  - Cited, not clicked: answers cite the pages and nobody clicks through —
 *    Fix work, to make the cited page worth the click.
 *  - No AI traffic: pages with visitors or in the sitemap that AI sends
 *    nobody to — G01's plan (Capture AI Traffic), the one the nightly
 *    detection gives the same pages.
 *
 * Measured afterwards on its pages like any person-sent action
 * (basketMetrics.js): their citations and AI-referred sessions.
 */

import { createHash } from 'node:crypto';
import supabaseAdmin from '../../config/supabase.js';
import captureAiTraffic from './definitions/g01CaptureAiTraffic.js';
import { priorityOnCreate } from './priorityData.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const TRAFFIC_PAGES_ACTION_KIND = 'traffic_pages';

/** The lists a page can be sent from, as 00178 names its tabs. */
export const TRAFFIC_PAGE_REASONS = ['cited_not_clicked', 'no_ai_traffic'];

/** At most a few pages of the list at once. */
export const MAX_TRAFFIC_PAGES = 50;

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['ai_referral_traffic', 'citations'];
/** Every page of a list, however long, to find the ones sent. */
const LIST_LIMIT = 10_000;

/**
 * Cited, not clicked: the answers already show the page, so the work is the
 * page itself — what the answers say about it, what it lacks against them,
 * and the path from the answer to a click.
 */
export const CITED_NOT_CLICKED_TASKS = [
  'analyze_citations',
  'analyze_ai_responses',
  'identify_content_gaps',
  'optimize_content',
  'improve_cta_path',
  'publish_content',
  'validate_ai_traffic',
  'validate_citations',
  'measure_action_outcome',
];

/** What the list asks for: Fix for cited pages nobody clicks, Growth for pages AI skips. */
export function trafficPagesTasks(reason) {
  return reason === 'cited_not_clicked' ? CITED_NOT_CLICKED_TASKS : captureAiTraffic.tasks;
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** A page path as 00178 keys it: lowercased, without a trailing slash. */
export function pageKeyOf(path) {
  const trimmed = String(path ?? '')
    .trim()
    .replace(/\/+$/, '');
  return (trimmed || '/').toLowerCase();
}

/** One action per list and set of pages: the same pages sent again find it. */
export function trafficPagesDedupKey(reason, pages) {
  const digest = createHash('sha1')
    .update([...new Set(pages.map(pageKeyOf))].sort().join('\n'))
    .digest('hex');
  return `${TRAFFIC_PAGES_ACTION_KIND}:${reason}:${digest.slice(0, 20)}`;
}

/**
 * Category and impact. Cited pages nobody clicks are Fix work, more urgent
 * the more often answers show them; pages AI skips are Growth, worth more
 * when they make money or convert.
 */
export function trafficPagesWeight(pages, reason) {
  if (reason === 'cited_not_clicked') {
    const citations = pages.reduce((sum, p) => sum + p.citations, 0);
    return { category: 'fix', impact: citations >= 100 ? 'high' : 'medium' };
  }
  const sells = pages.some((p) => p.revenue > 0 || p.transactions > 0);
  const converts = pages.some((p) => p.keyEvents > 0);
  return { category: 'growth', impact: sells ? 'high' : converts ? 'medium' : 'low' };
}

/** What the pages are worth, in the strongest figure Analytics reports for them. */
export function trafficPagesValueSignal(pages) {
  if (pages.some((p) => p.revenue > 0)) return 'revenue';
  if (pages.some((p) => p.transactions > 0)) return 'transactions';
  if (pages.some((p) => p.keyEvents > 0)) return 'key_events';
  if (pages.some((p) => p.sessions > 0)) return 'engagement';
  return null;
}

/** A 00178 row in the action's terms. */
function pageFigures(row) {
  return {
    page: String(row.page),
    aiVisits: Number(row.ai_visits) || 0,
    citations: Number(row.citations) || 0,
    targetingPrompts: Number(row.targeting_prompts) || 0,
    sessions: Number(row.sessions) || 0,
    keyEvents: Number(row.key_events) || 0,
    transactions: Number(row.transactions) || 0,
    revenue: Number(row.revenue) || 0,
    inSitemap: Boolean(row.in_sitemap),
    valueRank:
      row.value_rank === null || row.value_rank === undefined ? null : Number(row.value_rank),
  };
}

/** The brand's primary host, for the pages' full URLs: measuring needs them. */
async function primaryHost(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary, created_at')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const domain = data?.[0]?.domain;
  if (!domain) return null;
  return (
    String(domain)
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase() || null
  );
}

/**
 * Creates the action, or returns the open one if these pages were already
 * sent from the same list.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{ pages: string[], reason: 'cited_not_clicked' | 'no_ai_traffic',
 *   from?: string, to?: string, userId: string }} opts
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendTrafficPagesToActionCenter(brandId, { pages, reason, from, to, userId }) {
  if (!TRAFFIC_PAGE_REASONS.includes(reason)) throw httpError('Unknown list', 400);
  const wanted = new Set(pages.slice(0, MAX_TRAFFIC_PAGES).map(pageKeyOf));

  // The list as the page showed it, read again over the same range.
  const { data: list, error: listErr } = await supabaseAdmin.rpc('ai_traffic_pages', {
    p_brand_id: brandId,
    p_from: from ?? null,
    p_to: to ?? null,
    p_tab: reason,
    p_limit: LIST_LIMIT,
    p_offset: 0,
  });
  if (listErr) throw new Error(listErr.message);
  const found = ((list ?? {}).rows ?? [])
    .filter((row) => wanted.has(pageKeyOf(row.page)))
    .map(pageFigures);
  if (!found.length) throw httpError('None of these pages are on the list for this range', 404);

  // Keyed on the pages found, so a page that left the list can't open a
  // second action for the same pages.
  const dedupKey = trafficPagesDedupKey(
    reason,
    found.map((p) => p.page),
  );
  const openAction = async () => {
    const { data } = await supabaseAdmin
      .from('actions')
      .select('id, action_no')
      .eq('brand_id', brandId)
      .eq('dedup_key', dedupKey)
      .in('status', ACTIVE)
      .maybeSingle();
    return data;
  };
  const open = await openAction();
  if (open) return { actionId: open.id, actionNo: Number(open.action_no), created: false };

  const host = await primaryHost(brandId);
  const { category, impact } = trafficPagesWeight(found, reason);
  const total = (field) => found.reduce((sum, p) => sum + p[field], 0);

  const payload = {
    source: TRAFFIC_PAGES_ACTION_KIND,
    reason,
    window: { from: from ?? null, to: to ?? null },
    pageCount: found.length,
    citations: total('citations'),
    sessions: total('sessions'),
    keyEvents: total('keyEvents'),
    revenue: total('revenue'),
    valueSignal: trafficPagesValueSignal(found),
    evidence: found,
    // Measured on these pages once done (basketMetrics.js), by full URL.
    pages: host ? found.map((p) => `https://${host}${p.page === '/' ? '' : p.page}`) : [],
    targetEntity: 'pages',
    targetCount: found.length,
    // The pages it counts, by path (AC-009): `pages` is empty without a domain.
    targetIds: found.map((p) => p.page),
    targets: found.map((p) => ({
      id: p.page,
      label: p.page,
      sessions: p.sessions,
      citations: p.citations,
    })),
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category,
      kind: TRAFFIC_PAGES_ACTION_KIND,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline: {
        aiVisits: total('aiVisits'),
        citations: payload.citations,
        sessions: payload.sessions,
      },
      dedup_key: dedupKey,
      ...(await priorityOnCreate({
        brand_id: brandId,
        kind: TRAFFIC_PAGES_ACTION_KIND,
        category,
        impact,
        payload,
      })),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // Two sends at once: the other one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') {
      const winner = await openAction();
      if (winner) {
        return { actionId: winner.id, actionNo: Number(winner.action_no), created: false };
      }
    }
    throw new Error(error.message);
  }

  const sources = await resolveBrandSources(brandId);
  const plan = planTasks(
    { id: TRAFFIC_PAGES_ACTION_KIND, tasks: trafficPagesTasks(reason) },
    { sources, payload },
  );
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: action.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
      details: item.details,
      status: 'todo',
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: {
      source: TRAFFIC_PAGES_ACTION_KIND,
      reason,
      pages: found.length,
      taskCount: plan.length,
    },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
