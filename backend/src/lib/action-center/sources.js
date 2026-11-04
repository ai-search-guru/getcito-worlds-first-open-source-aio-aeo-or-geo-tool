/**
 * What a brand actually has to work with (#818).
 *
 * A definition declares the data it needs; this module answers whether a
 * given brand has it. It gates generation — a brand with no Search Console
 * connection is not offered a Search Console definition — and the task planner
 * reads the same answer to decide which tasks a plan can contain.
 *
 * Deliberately coarse. "Does this brand have X at all" is a stable fact about
 * the workspace; whether X moved this week is a detector's question.
 */

import supabaseAdmin from '../../config/supabase.js';
import { brandConnection } from '../brandIntegrations.js';

/**
 * Every source a definition may declare. Validation rejects anything else, so
 * a typo in a definition fails at load rather than silently making that
 * definition ineligible for every brand forever.
 */
export const SOURCES = Object.freeze([
  /** Our own prompt tracking. Every brand has it. */
  'tracking',
  /** Competitors configured on the brand. */
  'competitors',
  /** Site Audit runs. */
  'site_audits',
  /** A Google Analytics connection the brand uses (00470). */
  'analytics',
  /** A Google Search Console connection with synced query data. */
  'search_console',
  /** Search/AI demand estimates on at least one tracked prompt. */
  'volumes',
  /** AI-referred traffic from either analytics or the tracking snippet. */
  'ai_traffic',
  /** Prompts organised into topics. */
  'topics',
]);

const DAY_MS = 86_400_000;

async function hasRow(query) {
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * The sources available to one brand.
 *
 * @param {string} brandId
 * @returns {Promise<Set<string>>}
 */
export async function resolveBrandSources(brandId) {
  const available = new Set(['tracking']);
  const recent = new Date(Date.now() - 30 * DAY_MS).toISOString();

  const [competitors, audits, gscRows, analyticsPages, snippetRows, topics, volumes, analytics] =
    await Promise.all([
      hasRow(supabaseAdmin.from('competitors').select('id').eq('brand_id', brandId)),
      hasRow(supabaseAdmin.from('site_audits').select('id').eq('brand_id', brandId)),
      hasRow(supabaseAdmin.from('gsc_query_stats').select('id').eq('brand_id', brandId)),
      hasRow(
        supabaseAdmin
          .from('ga_ai_traffic_stats')
          .select('id')
          .eq('brand_id', brandId)
          .gte('date', recent.slice(0, 10)),
      ),
      hasRow(
        supabaseAdmin
          .from('ai_traffic_logs')
          .select('id')
          .eq('brand_id', brandId)
          .gte('created_at', recent),
      ),
      hasRow(
        supabaseAdmin.from('topics').select('id').eq('brand_id', brandId).eq('is_active', true),
      ),
      hasVolumes(brandId),
      // The Google sign-in the brand uses for Analytics: every brand of a
      // workspace uses its one connection until a brand picks its own (PR 15).
      brandConnection(brandId, 'google-analytics'),
    ]);

  if (competitors) available.add('competitors');
  if (audits) available.add('site_audits');
  if (gscRows) available.add('search_console');
  if (analyticsPages || snippetRows) available.add('ai_traffic');
  if (topics) available.add('topics');
  if (volumes) available.add('volumes');
  if (analytics?.connected) available.add('analytics');

  return available;
}

/** Volumes hang off prompts, which hang off prompt sets, which hang off the
 *  brand — so this is the one source that needs a join to answer. */
async function hasVolumes(brandId) {
  const { data: sets, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  const setIds = (sets ?? []).map((s) => s.id);
  if (setIds.length === 0) return false;

  const { data: prompts, error: promptErr } = await supabaseAdmin
    .from('prompts')
    .select('id')
    .in('prompt_set_id', setIds)
    .limit(500);
  if (promptErr) throw new Error(promptErr.message);
  const promptIds = (prompts ?? []).map((p) => p.id);
  if (promptIds.length === 0) return false;

  return hasRow(
    supabaseAdmin.from('prompt_volumes').select('id').in('prompt_id', promptIds.slice(0, 100)),
  );
}
