import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { allowedBrands, brandAccessFor, hasBrandAccess } from '@/lib/brandAccess';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { Citation } from '@/types';
import {
  classifyDomain,
  extractHostname,
  normalizeDomain,
  SOURCE_CATEGORIES,
  type SourceCategory,
} from '@/lib/citations/classify';
import { classifyArticleType } from '@/lib/citations/articleType';
import { expandDateToEndOfDay } from '@/lib/dates';
import { countTrafficLogs, scanTrafficLogs } from '@/lib/trafficScan';
import { readSnippet } from '@/lib/trafficSnippet';
import { snippetState, type SnippetState } from '@/lib/trafficSources';
import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import { API_BASE_URL } from '@/config/api';
import { ORG_PLAN_COLUMNS, planFromOrgRow, usagePlanFromOrgRow } from '@/lib/guards/planGuard';
import { PLANS, type Feature, getMinimumPlanForFeature, hasFeature, isCloud } from '@/config/plans';
import { assertSubscriptionActive } from '@/lib/mcp/subscriptionGate';
import { DemoBrandError, assertNotDemoBrand, callOnDemoBrand } from '@/lib/mcp/demoGate';
import { MEMBER_ROLES, requireManager, requireRole } from '@/lib/mcp/roleGate';
import {
  fetchPromptUsageRow,
  toPromptUsageSummary,
  type PromptUsageSummary,
} from '@/lib/promptUsageSummary';
import { mapSignalRows, type SignalRow } from '@/lib/signals/map';
import { readPromptPlaces } from '@/lib/signals/promptPlaces';
import { currentActionFirst, signalDetailForApi, type SignalActionRef } from '@/lib/signals/detail';
import {
  currentPriorityReason,
  currentTaskParams,
  readEntityCounts,
  withEntityCounts,
  withoutTargetIds,
} from '@/lib/action-center/entityCounts';
import {
  parseTaskDetails,
  withTemplateCheck,
  withTemplateDoneWhen,
} from '@/lib/action-center/taskDetails';
import { controlNetOf } from '@/lib/action-center/history';
import {
  confidenceNote,
  parsePriorityReason,
  type ConfidenceLevel,
} from '@/lib/action-center/priority';
import {
  dismissReasonOf,
  missingDismissReason,
  type ActionDismissReason,
} from '@/lib/action-center/registry';
import { locationCode, isValidLocation } from '@/lib/region';
import { promptVolumeEstimate, type EstimateConfidence } from '@/lib/volumeEstimate';
import { readPromptDemand, type PromptDemand } from './promptDemand';
import { getOrgLocationUsage, locationLimitMessage } from '@/lib/promptLocations';
import { NO_TOPICS, brandHasTopics } from '@/lib/topicsRequired';
import { filterPromptSuggestionEngines, promptSuggestionsAreStale } from './promptSuggestionsUtils';
import { readQuestionVolume } from '@/lib/content/questionVolumeRead';
import {
  opportunityVolumeForMcp,
  type OpportunityVolumeForMcp,
} from '@/lib/content/questionVolume';
import { refreshYears } from '@/lib/content/currentYear';

/**
 * Pure data-fetch functions shared by the MCP route and the parallel REST
 * endpoints under `/api/mcp/*`. Each function takes an authenticated context
 * (already resolved to a user + organization) and returns plain JSON the
 * caller can ship over the wire or into an MCP tool result.
 */

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  region: string | null;
  created_at: string;
  /** The demo brand (00380): sample data, read like any brand; nothing on it is written or run. */
  is_demo: boolean;
}

/**
 * The organization's brands the person may use (BRAND-ACCESS: all, or the
 * ones shared with them), newest first. The demo brand is one of them,
 * marked is_demo, unless the organization hid it (once a plan was bought, or
 * from the brand menu).
 */
export async function listBrandsFor(auth: McpAuthContext): Promise<BrandRow[]> {
  if (!auth.organizationId) return [];

  const [{ data, error }, access] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id, name, slug, industry, region, created_at, is_demo')
      .eq('organization_id', auth.organizationId)
      .or('is_demo.eq.false,demo_hidden_at.is.null')
      .order('created_at', { ascending: false }),
    brandAccessFor(auth),
  ]);

  if (error) throw new Error(error.message);
  return allowedBrands(access, (data ?? []) as BrandRow[]);
}

export interface VisibilitySummaryParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  model?: string;
  region?: string;
}

export interface VisibilitySummary {
  brand: { id: string; name: string };
  totals: {
    resultCount: number;
    /** DEPRECATED — all-answers average of the legacy 0-100 intensity score. */
    avgVisibility: number;
    totalMentions: number;
    totalCitations: number;
    /** Distinct prompts the brand appeared in (mention_count > 0 OR citation_count > 0). */
    visiblePrompts: number;
    /** Distinct prompts that produced results (shopping excluded). */
    promptCount: number;
    /**
     * DEPRECATED as the headline — coverage: visiblePrompts / promptCount ×
     * 100. Kept for compatibility; prefer aiVisibilityScore.
     */
    visibilityRatePct: number;
    /**
     * HEADLINE metric (0-100): 0.6 × mention rate + 0.25 × citation rate +
     * 0.15 × position factor over the filtered answers. Matches the
     * dashboard's Visibility number everywhere. Null when no answers.
     */
    aiVisibilityScore: number | null;
    /** Answers mentioning the brand (score component). */
    mentionAnswers: number;
    /** Answers citing the brand's own domain (score component). */
    citationAnswers: number;
    /** Mean of 1/position over mentioning answers; null when never mentioned. */
    positionFactor: number | null;
  };
  topCompetitors: Array<{
    name: string;
    mentions: number;
    /** DEPRECATED — legacy average intensity over the shared denominator. */
    avgVisibility: number;
    /** AI Visibility Score over the brand's answers (shared denominator). */
    score: number | null;
  }>;
}

interface CompetitorMentionRow {
  name: string;
  mention_count: number;
  visibility_score: number;
}

export async function getVisibilitySummaryFor(
  auth: McpAuthContext,
  params: VisibilitySummaryParams,
): Promise<VisibilitySummary | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // Build a shared model list once — used by both the raw query and the RPCs.
  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const p_models_arg = p_models && p_models.length > 0 ? p_models : null;

  const rpcBaseArgs = {
    p_brand_id: params.brandId,
    p_platform: null as string | null,
    p_models: p_models_arg,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    p_topic_id: null as string | null,
  };

  // #155 — getVisibilitySummaryFor mirrors the insights_aggregates RPC and
  // excludes chatgpt-shopping for the same reason: its model isn't
  // comparable to a normal ChatGPT answer and would skew brand visibility.
  //
  // Run the raw-row query and the two rate RPCs in parallel:
  //   • visible_prompt_stats  → visiblePrompts (numerator)
  //   • tracked_prompt_count  → promptCount (denominator)
  // This is the exact same source pair used by getVisibilityRateKpi /
  // getTrackedPromptsKpi on the Insights KPI card, so the numbers match.
  let query = supabaseAdmin
    .from('prompt_results')
    .select(
      'visibility_score, mention_count, citation_count, sentiment, model_used, competitor_mentions',
    )
    .eq('brand_id', params.brandId)
    .neq('platform', 'chatgpt-shopping');

  if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(params.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);
  if (params.region) query = query.eq('region', params.region);
  if (p_models_arg) {
    query =
      p_models_arg.length > 1
        ? query.in('model_used', p_models_arg)
        : query.eq('model_used', p_models_arg[0]);
  }

  const [{ data: rows, error }, visibleRes, promptCountRes, aiVisRes] = await Promise.all([
    query,
    supabaseAdmin.rpc('visible_prompt_stats', rpcBaseArgs),
    supabaseAdmin.rpc('tracked_prompt_count', rpcBaseArgs),
    supabaseAdmin.rpc('ai_visibility_aggregates', rpcBaseArgs),
  ]);

  if (error) throw new Error(error.message);
  if (visibleRes.error) throw new Error(visibleRes.error.message);
  if (promptCountRes.error) throw new Error(promptCountRes.error.message);
  if (aiVisRes.error) throw new Error(aiVisRes.error.message);

  const results = (rows ?? []) as Array<{
    visibility_score: number;
    mention_count: number;
    citation_count: number;
    sentiment: string;
    model_used: string | null;
    competitor_mentions: CompetitorMentionRow[] | null;
  }>;

  // Rate fields come from the RPCs — single source of truth, exact parity
  // with the Insights KPI card for the same brand/window/filters.
  const visRpcRow = (visibleRes.data ?? {}) as {
    visible_prompts?: number;
    visible_results?: number;
  };
  const visiblePrompts = Number(visRpcRow.visible_prompts ?? 0);
  const promptCount = Number(promptCountRes.data ?? 0);
  const visibilityRatePct =
    promptCount > 0 ? Math.round((visiblePrompts / promptCount) * 1000) / 10 : 0;

  // AI Visibility Score — the same blend every dashboard surface shows.
  const aiVis = (aiVisRes.data ?? {}) as {
    answers?: number;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | null;
    by_competitor?: Array<{
      name: string | null;
      mention_answers?: number;
      citation_answers?: number;
      position_factor?: number | null;
    }>;
  };
  const aiAnswers = Number(aiVis.answers ?? 0);
  const mentionAnswers = Number(aiVis.mention_answers ?? 0);
  const citationAnswers = Number(aiVis.citation_answers ?? 0);
  const positionFactor = aiVis.position_factor ?? null;
  const aiVisibilityScore = computeAiVisibilityScore({
    answers: aiAnswers,
    mentionAnswers,
    citationAnswers,
    positionFactor,
  });
  const compScoreByName = new Map<string, number | null>();
  for (const c of aiVis.by_competitor ?? []) {
    if (!c.name) continue;
    compScoreByName.set(
      c.name,
      computeAiVisibilityScore({
        answers: aiAnswers,
        mentionAnswers: Number(c.mention_answers ?? 0),
        citationAnswers: Number(c.citation_answers ?? 0),
        positionFactor: c.position_factor ?? null,
      }),
    );
  }

  if (results.length === 0) {
    return {
      brand: { id: brand.id, name: brand.name },
      totals: {
        resultCount: 0,
        avgVisibility: 0,
        totalMentions: 0,
        totalCitations: 0,
        visiblePrompts,
        promptCount,
        visibilityRatePct,
        aiVisibilityScore,
        mentionAnswers,
        citationAnswers,
        positionFactor,
      },
      topCompetitors: [],
    };
  }

  let totalMentions = 0;
  let totalCitations = 0;
  let sumVis = 0;
  const compTotals = new Map<string, { mentions: number; visSum: number }>();

  for (const r of results) {
    sumVis += r.visibility_score ?? 0;
    totalMentions += r.mention_count ?? 0;
    totalCitations += r.citation_count ?? 0;

    for (const cm of r.competitor_mentions ?? []) {
      const agg = compTotals.get(cm.name) ?? { mentions: 0, visSum: 0 };
      agg.mentions += cm.mention_count ?? 0;
      agg.visSum += cm.visibility_score ?? 0;
      compTotals.set(cm.name, agg);
    }
  }

  const avgVisibility = Math.round((sumVis / results.length) * 10) / 10;

  // Fix: divide competitor scores by the same total result-row count as the
  // brand (every filtered row, not just rows where the competitor appeared).
  // Prevents inflated scores for competitors that only appear in their best
  // runs — the same denominator fix applied to the dashboard leaderboard in
  // PR #478.
  const totalRows = results.length;
  const topCompetitors = [...compTotals.entries()]
    .map(([name, agg]) => ({
      name,
      mentions: agg.mentions,
      avgVisibility: totalRows > 0 ? Math.round((agg.visSum / totalRows) * 10) / 10 : 0,
      score: compScoreByName.get(name) ?? null,
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 5);

  return {
    brand: { id: brand.id, name: brand.name },
    totals: {
      resultCount: results.length,
      avgVisibility,
      totalMentions,
      totalCitations,
      visiblePrompts,
      promptCount,
      visibilityRatePct,
      aiVisibilityScore,
      mentionAnswers,
      citationAnswers,
      positionFactor,
    },
    topCompetitors,
  };
}

// ── Topics ────────────────────────────────────────────────────────────────────

export interface TopicRow {
  id: string;
  name: string;
  is_active: boolean;
  prompt_count: number;
  created_at: string;
}

export async function listTopicsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<TopicRow[] | null> {
  if (!auth.organizationId) return null;

  // Ownership check — make sure the brand belongs to the caller's org.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data: topics, error: tErr } = await supabaseAdmin
    .from('topics')
    .select('id, name, is_active, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (tErr) throw new Error(tErr.message);

  const topicRows = (topics ?? []) as Array<{
    id: string;
    name: string;
    is_active: boolean | null;
    created_at: string;
  }>;
  if (topicRows.length === 0) return [];

  // Count prompts per topic in one round trip (instead of N+1) by selecting
  // topic_id from prompts joined to prompt_sets for this brand and bucketing
  // client-side. Topic-less prompts (topic_id null) are intentionally
  // dropped here — they show up in list_prompts but don't add to any topic.
  const { data: prompts } = await supabaseAdmin
    .from('prompts')
    .select('topic_id, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .not('topic_id', 'is', null);

  const promptRows = (prompts as Array<{ topic_id: string | null }> | null) ?? [];
  const countByTopic = new Map<string, number>();
  for (const row of promptRows) {
    if (!row.topic_id) continue;
    countByTopic.set(row.topic_id, (countByTopic.get(row.topic_id) ?? 0) + 1);
  }

  return topicRows.map((t) => ({
    id: t.id,
    name: t.name,
    is_active: t.is_active ?? true,
    prompt_count: countByTopic.get(t.id) ?? 0,
    created_at: t.created_at,
  }));
}

// ── Topic suggestions (#498) ─────────────────────────────────────────────────
// Read/act on the AI-generated suggestions persisted by #497 (topic_suggestions
// table). Generation itself stays plan-gated behind the web UI's refresh
// button — these tools only list, accept, or dismiss what already exists.

export interface TopicSuggestionRow {
  id: string;
  name: string;
  reason: string | null;
  generated_at: string;
}

/**
 * List pending (status = 'new') topic suggestions for a brand. Ownership is
 * checked the same way as listTopicsFor — a wrong-org or missing brand id
 * returns null before any suggestion row is read.
 */
export async function listTopicSuggestionsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<TopicSuggestionRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data, error } = await supabaseAdmin
    .from('topic_suggestions')
    .select('id, name, reason, generated_at')
    .eq('brand_id', brandId)
    .eq('status', 'new')
    .order('generated_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []) as TopicSuggestionRow[];
}

export interface DismissedTopicSuggestion {
  id: string;
  status: 'dismissed';
}

/**
 * Dismiss a pending suggestion so it never reappears in future refreshes.
 * Scoped to status = 'new' so dismissing an already-decided suggestion (added
 * or already dismissed) is a no-op that returns null rather than silently
 * "succeeding" twice. An admin's or a manager's call, as on the Topics page.
 */
export async function dismissTopicSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<DismissedTopicSuggestion | null> {
  if (!auth.organizationId) return null;
  requireManager(auth);

  const { data: ownership } = await supabaseAdmin
    .from('topic_suggestions')
    .select('id, brand_id, status, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (!ownership || !(await mayUseBrand(auth, ownership.brand_id))) return null;

  const { data, error } = await supabaseAdmin
    .from('topic_suggestions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .select('id, status')
    .single();
  if (error) throw new Error(error.message);

  return { id: data.id, status: 'dismissed' };
}

export interface AcceptedTopicSuggestion {
  suggestion_id: string;
  topic_id: string;
  topic_name: string;
}

/**
 * Accept a suggestion: create exactly ONE topic via a singular insert (never
 * a bulk replace of the brand's topic list — mirrors the web app's
 * createTopic action), then mark the suggestion added with a pointer to the
 * new topic. Scoped to status = 'new' up front, so accepting the same
 * suggestion twice fails the ownership lookup on the second call instead of
 * creating a second topic. An admin's or a manager's call, as on the Topics
 * page.
 */
export async function acceptTopicSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<AcceptedTopicSuggestion | null> {
  if (!auth.organizationId) return null;
  requireManager(auth);

  const { data: suggestion } = await supabaseAdmin
    .from('topic_suggestions')
    .select('id, brand_id, name, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (!suggestion || !(await mayUseBrand(auth, suggestion.brand_id))) return null;

  const { data: topic, error: topicErr } = await supabaseAdmin
    .from('topics')
    .insert({ brand_id: suggestion.brand_id, name: suggestion.name.trim() })
    .select('id, name')
    .single();
  if (topicErr) throw new Error(topicErr.message);

  const { error: updateErr } = await supabaseAdmin
    .from('topic_suggestions')
    .update({
      status: 'added',
      added_topic_id: topic.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId);
  if (updateErr) throw new Error(updateErr.message);

  return { suggestion_id: suggestionId, topic_id: topic.id, topic_name: topic.name };
}

// ── Prompt suggestions (#918) ──────────────────────────────────────────────────
// These tools operate only on suggestions already persisted by the dashboard.
// Generation remains behind the existing plan-gated refresh action.

export interface PromptSuggestionRow {
  id: string;
  suggested_text: string;
  topic_name: string | null;
  topic_id: string | null;
  reason: string | null;
  est_volume: number | null;
  relevance: number | null;
  source: string;
  source_data: Record<string, unknown> | null;
  generated_at: string;
  expires_at: string;
}

export interface PromptSuggestionList {
  suggestions: PromptSuggestionRow[];
  stale: boolean;
}

/** List pending suggestions only after verifying that the brand belongs to this organization. */
export async function listPromptSuggestionsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<PromptSuggestionList | null> {
  if (!auth.organizationId) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data, error } = await supabaseAdmin
    .from('prompt_suggestions')
    .select(
      'id, suggested_text, topic_name, topic_id, reason, est_volume, relevance, source, source_data, generated_at, expires_at',
    )
    .eq('brand_id', brandId)
    .eq('status', 'new')
    .order('generated_at', { ascending: false });
  if (error) throw new Error(error.message);

  const suggestions = (data ?? []) as unknown as PromptSuggestionRow[];
  return { suggestions, stale: promptSuggestionsAreStale(suggestions) };
}

export interface DismissedPromptSuggestion {
  id: string;
  status: 'dismissed';
}

/**
 * Dismiss only a pending suggestion belonging to the authenticated
 * organization. Any member but an agency partner may, as the table's update
 * rule.
 */
export async function dismissPromptSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<DismissedPromptSuggestion | null> {
  if (!auth.organizationId) return null;
  requireRole(auth, MEMBER_ROLES);

  const { data: owned, error: lookupError } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('id, brand_id, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!owned || !(await mayUseBrand(auth, owned.brand_id))) return null;

  const { data, error } = await supabaseAdmin
    .from('prompt_suggestions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .eq('status', 'new')
    .select('id, status')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return { id: data.id, status: 'dismissed' };
}

export interface AcceptedPromptSuggestion {
  suggestion_id: string;
  prompt_id: string;
  prompt_text: string;
  status: 'added';
}

export type AcceptPromptSuggestionResult =
  AcceptedPromptSuggestion | { error: string; code?: 'plan_limit' | typeof NO_TOPICS };

/**
 * The refusal for a brand with no topic yet, with what an agent can do about
 * it: topic suggestions are the topics it can add itself.
 */
export const MCP_NO_TOPICS_MESSAGE =
  'This brand has no topics yet. Prompts are grouped under topics, so add a topic first: accept one from list_topic_suggestions with accept_topic_suggestion, or add one in GetCito under Prompts › Topics. Then accept the prompt suggestion again.';

/**
 * Accept one pending prompt suggestion by creating a tracked prompt, then
 * marking the suggestion added. Mirrors the dashboard's target defaults,
 * plan engine filtering, shopping-mode behavior, region choice and location
 * quota check. Every lookup is organization-scoped; duplicate acceptance
 * removes any losing concurrent insert rather than leaving duplicate prompts.
 * Adding a prompt is an admin's or a manager's call, as on the Prompts page.
 * A brand with no topic yet is refused (`no_topics`), as on the dashboard.
 */
export async function acceptPromptSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<AcceptPromptSuggestionResult | null> {
  if (!auth.organizationId) return null;
  requireManager(auth);

  const { data: suggestion, error: suggestionError } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('id, brand_id, suggested_text, topic_name, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (suggestionError) throw new Error(suggestionError.message);
  if (!suggestion) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id, region, state, shopping_mode_enabled')
    .eq('id', suggestion.brand_id)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  if (!(await brandHasTopics(supabaseAdmin, brand.id))) {
    return { error: MCP_NO_TOPICS_MESSAGE, code: NO_TOPICS };
  }

  const { data: promptSet, error: promptSetError } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (promptSetError) throw new Error(promptSetError.message);
  if (!promptSet) {
    return { error: 'No prompt set exists for this brand. Create one first.' };
  }

  const { data: defaults, error: defaultsError } = await supabaseAdmin
    .from('prompts')
    .select('platforms, models')
    .eq('prompt_set_id', promptSet.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (defaultsError) throw new Error(defaultsError.message);

  const defaultPlatforms =
    Array.isArray(defaults?.platforms) && defaults.platforms.length > 0
      ? (defaults.platforms as string[])
      : ['chatgpt-web'];
  const defaultModels = Array.isArray(defaults?.models) ? (defaults.models as string[]) : [];

  const { data: organization, error: organizationError } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', auth.organizationId)
    .maybeSingle();
  if (organizationError) throw new Error(organizationError.message);
  if (!organization) return { error: 'Could not load the organization plan.' };

  const plan = planFromOrgRow(organization);
  const filtered = filterPromptSuggestionEngines(plan.limits, defaultPlatforms, defaultModels);
  if (filtered.platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'Your plan does not allow any of the default prompt engines.' };
  }

  const platforms = brand.shopping_mode_enabled
    ? Array.from(new Set([...filtered.platforms, 'chatgpt-shopping']))
    : filtered.platforms.filter((platform) => platform !== 'chatgpt-shopping');
  if (platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'At least one platform or model must be selected.' };
  }

  const usage = await getOrgLocationUsage(supabaseAdmin, auth.organizationId);
  const limitError = locationLimitMessage(plan, usage.total, 1);
  if (limitError) return { error: limitError, code: 'plan_limit' };

  const country = (brand.region as string | null) ?? 'US';
  const candidateRegion = locationCode(country, brand.state as string | null);
  const region = isValidLocation(candidateRegion) ? candidateRegion : country;

  let topicId: string | null = null;
  if (suggestion.topic_name) {
    const { data: topic, error: topicError } = await supabaseAdmin
      .from('topics')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('name', suggestion.topic_name)
      .limit(1)
      .maybeSingle();
    if (topicError) throw new Error(topicError.message);
    topicId = topic?.id ?? null;
  }

  const { data: prompt, error: promptError } = await supabaseAdmin
    .from('prompts')
    .insert({
      prompt_set_id: promptSet.id,
      text: suggestion.suggested_text,
      category: suggestion.topic_name ?? null,
      topic_id: topicId,
      platforms,
      regions: [region],
      models: filtered.models,
      is_active: true,
    })
    .select('id, text')
    .single();
  if (promptError || !prompt) {
    return { error: promptError?.message ?? 'Failed to add the prompt.' };
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('prompt_suggestions')
    .update({
      status: 'added',
      added_prompt_id: prompt.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('status', 'new')
    .select('id')
    .maybeSingle();

  if (updateError || !updated) {
    // A concurrent accept may have won after our initial read. Remove the
    // prompt we just inserted so the suggestion cannot create duplicates.
    const { error: cleanupError } = await supabaseAdmin
      .from('prompts')
      .delete()
      .eq('id', prompt.id);
    if (cleanupError) {
      throw new Error(
        updateError?.message ??
          'Suggestion was processed concurrently and the duplicate prompt could not be removed.',
      );
    }
    if (updateError) throw new Error(updateError.message);
    return null;
  }

  return {
    suggestion_id: suggestionId,
    prompt_id: prompt.id,
    prompt_text: prompt.text,
    status: 'added',
  };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export interface PromptRow {
  id: string;
  text: string;
  topic_id: string | null;
  topic_name: string | null;
  platforms: string[];
  models: string[];
  regions: string[];
  is_active: boolean;
  created_at: string;
}

export interface ListPromptsParams {
  brandId: string;
  topicId?: string;
  isActive?: boolean;
  limit?: number;
}

const PROMPT_LIST_DEFAULT_LIMIT = 100;
const PROMPT_LIST_MAX_LIMIT = 500;

export async function listPromptsFor(
  auth: McpAuthContext,
  params: ListPromptsParams,
): Promise<PromptRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(
    Math.max(params.limit ?? PROMPT_LIST_DEFAULT_LIMIT, 1),
    PROMPT_LIST_MAX_LIMIT,
  );

  let query = supabaseAdmin
    .from('prompts')
    .select(
      'id, text, topic_id, platforms, models, regions, is_active, created_at, prompt_sets!inner(brand_id), topics(name)',
    )
    .eq('prompt_sets.brand_id', params.brandId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.topicId) query = query.eq('topic_id', params.topicId);
  if (typeof params.isActive === 'boolean') {
    query = query.eq('is_active', params.isActive);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Supabase's generated types model the prompts→topics FK as an array (it
  // can't tell single vs many from the schema alone), so the join returns
  // `topics: { name }[]` rather than `topics: { name } | null`. We know it's
  // a single relation, so peel the first element off.
  const rows =
    (data as unknown as Array<{
      id: string;
      text: string;
      topic_id: string | null;
      platforms: string[] | null;
      models: string[] | null;
      regions: string[] | null;
      is_active: boolean;
      created_at: string;
      topics: Array<{ name: string }> | { name: string } | null;
    }> | null) ?? [];

  return rows.map((r) => {
    const topic = Array.isArray(r.topics) ? (r.topics[0] ?? null) : r.topics;
    return {
      id: r.id,
      text: r.text,
      topic_id: r.topic_id,
      topic_name: topic?.name ?? null,
      platforms: r.platforms ?? [],
      models: r.models ?? [],
      regions: r.regions ?? [],
      is_active: r.is_active,
      created_at: r.created_at,
    };
  });
}

// ── Content Opportunities ───────────────────────────────────────────────────

export interface ContentOpportunityRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  impact: string;
  opportunity_score: number;
  status: string;
  prompt_id: string | null;
  prompt_text: string | null;
  has_brief: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListContentOpportunitiesParams {
  brandId: string;
  status?: 'new' | 'reviewed' | 'sent' | 'in_progress' | 'done' | 'dismissed' | 'archived';
  impact?: 'high' | 'medium' | 'low';
  type?: 'owned' | 'earned';
  limit?: number;
}

export async function listContentOpportunitiesFor(
  auth: McpAuthContext,
  params: ListContentOpportunitiesParams,
): Promise<ContentOpportunityRow[] | null> {
  if (!auth.organizationId) return null;

  // Ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  let query = supabaseAdmin
    .from('content_opportunities')
    .select(
      'id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, brief, prompts(text)',
    )
    .eq('brand_id', params.brandId)
    .order('opportunity_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  // The archived per-prompt backlog (#857) only when asked for by status.
  query = params.status ? query.eq('status', params.status) : query.neq('status', 'archived');
  if (params.impact) query = query.eq('impact', params.impact);
  if (params.type) query = query.eq('type', params.type);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows =
    (data as unknown as Array<{
      id: string;
      title: string;
      description: string | null;
      type: string;
      impact: string;
      opportunity_score: number | null;
      status: string;
      prompt_id: string | null;
      created_at: string | null;
      updated_at: string | null;
      brief: Record<string, unknown> | null;
      prompts: Array<{ text: string }> | { text: string } | null;
    }> | null) ?? [];

  return rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
    return {
      id: r.id,
      // A past year in it reads as this year, as Content shows it (currentYear.ts).
      title: refreshYears(r.title),
      description: r.description,
      type: r.type,
      impact: r.impact,
      opportunity_score: Number(r.opportunity_score ?? 0),
      status: r.status,
      prompt_id: r.prompt_id,
      prompt_text: prompt?.text ?? null,
      has_brief: r.brief !== null,
      created_at: r.created_at ?? '',
      updated_at: r.updated_at ?? '',
    };
  });
}

export interface ContentOpportunityDetail {
  id: string;
  title: string;
  description: string | null;
  type: string;
  impact: string;
  opportunity_score: number;
  status: string;
  prompt_id: string | null;
  prompt_text: string | null;
  /**
   * Its estimated AI searches a month, as the Content page shows it: its
   * question's (prompt_text), one of `of_prompts` it answers
   * (questionVolume.ts). Null when its prompt has no volume.
   */
  volume: OpportunityVolumeForMcp | null;
  source_data: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedBrief {
  id: string;
  brief: Record<string, unknown>;
  generated_at: string;
  regenerated: boolean;
}

/**
 * Generate (or re-generate) the AI content brief for an opportunity.
 *
 * Org-ownership is verified *first* via supabaseAdmin — a wrong-org or
 * missing id returns `null` (→ 404 upstream) and never reaches the
 * aeo-server, so the LLM is never invoked for a tenant that doesn't own
 * the opportunity. Only after ownership passes do we call the internal
 * brief endpoint at `${NEXT_PUBLIC_API_URL}/api/internal/content/:id/brief`
 * with `Authorization: Bearer ${CRON_SECRET}` — same pattern as the
 * `/api/cron/daily-tracking` route. The `getcito_` API key never leaves the
 * web layer.
 *
 * Always passes `force: true` because MCP callers explicitly want a fresh
 * brief; cached reads belong on `getContentOpportunityFor`.
 */
export async function generateBriefFor(
  auth: McpAuthContext,
  opportunityId: string,
): Promise<GeneratedBrief | null> {
  if (!auth.organizationId) return null;
  // Generating costs AI: an admin's or a manager's, as in the dashboard.
  requireManager(auth);

  // Ownership check first — wrong-org or missing id returns null with no
  // outbound call, so no LLM cost or data leak for an attacker probing ids.
  const { data: ownership } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, brand_id, brands!inner(organization_id)')
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership || !(await mayUseBrand(auth, ownership.brand_id))) return null;
  // No brief (an LLM call) on the demo brand, nor for a read-only workspace, whoever asks.
  // Only GetCito Cloud has demo brands: self-hosted reads nothing for it.
  if (
    await callOnDemoBrand('generate_content_brief', auth.organizationId, {
      opportunity_id: opportunityId,
    })
  ) {
    throw new DemoBrandError();
  }
  await assertSubscriptionActive(auth.organizationId);

  const apiUrl = API_BASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP brief generation');
  }

  const res = await fetch(`${apiUrl}/api/internal/content/${opportunityId}/brief`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ force: true }),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Internal brief endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    brief: Record<string, unknown>;
    generated_at: string;
    regenerated?: boolean;
  };

  return {
    id: opportunityId,
    brief: body.brief,
    generated_at: body.generated_at,
    regenerated: Boolean(body.regenerated),
  };
}

export interface SiteAuditRun {
  id: string;
  brandId: string;
  url: string;
  /** "running", or "recently_audited": the page's audit of minutes ago, not run again. */
  status: string;
  /** The page's audit already running: no new credit was used. */
  alreadyRunning?: boolean;
  /** When the recent audit finished. */
  finishedAt?: string;
  message?: string;
}

export interface SiteAuditListRow {
  id: string;
  url: string;
  status: string;
  totalScore: number | null;
  signalsEvaluated: number | null;
  signalsTotal: number | null;
  createdAt: string;
}

/**
 * List a brand's recent Site Audits (newest first). Pure DB read, no quota —
 * ownership is verified via the brand belonging to the caller's org, so a
 * foreign or unknown brand returns `null`. Lets an agent find a past audit by
 * url/date instead of needing its id.
 */
export async function listSiteAuditsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<SiteAuditListRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, status, total_score, signals_evaluated, signals_total, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    url: r.url as string,
    status: r.status as string,
    totalScore: r.total_score == null ? null : Number(r.total_score),
    signalsEvaluated: r.signals_evaluated == null ? null : Number(r.signals_evaluated),
    signalsTotal: r.signals_total == null ? null : Number(r.signals_total),
    createdAt: r.created_at as string,
  }));
}

export interface SiteAuditQuota {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * The org's monthly Site Audit allowance ({ used, limit, remaining };
 * limit -1 = unlimited). Delegates to the server's `getSiteAuditQuotaStatus`
 * via the CRON_SECRET internal endpoint so plan-limit + usage-counting logic
 * stays single-sourced on the server. No quota is charged.
 */
export async function getSiteAuditQuotaFor(auth: McpAuthContext): Promise<SiteAuditQuota | null> {
  if (!auth.organizationId) return null;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP site audit quota');
  }

  const url = `${API_BASE_URL}/api/internal/site-audit-quota?orgId=${encodeURIComponent(
    auth.organizationId,
  )}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal site-audit-quota endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as { quota: SiteAuditQuota };
  return body.quota;
}

/**
 * The Tracked Prompts usage cards for a brand (PROMPT-012), so the Agent Chat
 * can answer "how many prompt slots do we have left?" with the page's own
 * numbers: prompt_usage_counters for the counts, the organization's effective
 * plan (Enterprise overrides merged) for the limit.
 */
export async function getPromptUsageFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<PromptUsageSummary | null> {
  if (!auth.organizationId || !(await brandAllowed(auth, brandId))) return null;

  const [{ data: org, error: orgError }, row] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', auth.organizationId)
      .maybeSingle(),
    fetchPromptUsageRow(supabaseAdmin, brandId),
  ]);
  if (orgError) throw new Error(orgError.message);
  if (!row) return null;
  const { plan, ended } = usagePlanFromOrgRow(org);
  return toPromptUsageSummary(row, plan, new Date(), { ended });
}

/**
 * Start a Site Audit for a brand + URL via MCP.
 *
 * Org-ownership is verified *first* via supabaseAdmin — a wrong-org or missing
 * brand returns `null` (→ 404 upstream) and never reaches the aeo-server, so
 * no audit is created and no quota is charged for a tenant that doesn't own the
 * brand. Only after ownership passes do we call the internal audit endpoint at
 * `${API_BASE_URL}/api/internal/site-audits` with `Authorization: Bearer
 * ${CRON_SECRET}` — same pattern as `generateBriefFor`. The `getcito_` API key
 * never leaves the web layer. The audit runs async (~30s); the caller polls
 * `getSiteAuditFor` with the returned id.
 */
export async function runSiteAuditFor(
  auth: McpAuthContext,
  brandId: string,
  url: string,
  options: { force?: boolean } = {},
): Promise<SiteAuditRun | null> {
  if (!auth.organizationId) return null;

  // Ownership check first — a wrong-org or missing brand returns null with no
  // outbound call, so probing brand ids costs nothing and starts no audit.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;
  // No audit (quota and crawling) on the demo brand, nor for a read-only workspace, whoever asks.
  await assertNotDemoBrand(auth.organizationId, brandId);
  await assertSubscriptionActive(auth.organizationId);

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP site audits');
  }

  const res = await fetch(`${API_BASE_URL}/api/internal/site-audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ brandId, url, ...(options.force ? { force: true } : {}) }),
  });

  if (res.status === 404) return null;

  // Audited in the last minutes (00431): not run again, so the agent asks first.
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
      recent?: { auditId: string; finishedAt: string };
    } | null;
    if (body?.error === 'recently_audited' && body.recent) {
      return {
        id: body.recent.auditId,
        brandId,
        url,
        status: 'recently_audited',
        finishedAt: body.recent.finishedAt,
        message: `${body.message ?? 'This page was audited minutes ago.'} Read it with get_site_audit, or ask the user, and run run_site_audit again with force: true to audit it again (uses one audit).`,
      };
    }
  }

  if (!res.ok) {
    // Surface the server's message (e.g. the monthly-quota / inactive-subscription
    // text) so the agent can relay it instead of a generic failure.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal site-audit endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as {
    audit: { id: string; brandId: string; url: string; status: string };
    alreadyRunning?: boolean;
  };
  return {
    id: body.audit.id,
    brandId: body.audit.brandId,
    url: body.audit.url,
    status: body.audit.status,
    ...(body.alreadyRunning ? { alreadyRunning: true } : {}),
  };
}

export interface SiteAuditSignal {
  key: string;
  category: string | null;
  status: string;
  score: number | null;
  evidence: Record<string, unknown>;
}

export interface SiteAuditResult {
  id: string;
  brandId: string;
  url: string;
  finalUrl: string | null;
  status: string;
  totalScore: number | null;
  categoryScores: Record<string, unknown>;
  signalsEvaluated: number | null;
  signalsTotal: number | null;
  recommendations: unknown[];
  signals: SiteAuditSignal[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Read a Site Audit by id for the caller's org. Pure DB read (no LLM, no
 * quota) — the org-ownership filter is applied in the query via the
 * `brands!inner(organization_id)` join, so a foreign or unknown id returns
 * `null`. Returns the status + scores + signals + AI recommendations.
 */
export async function getSiteAuditFor(
  auth: McpAuthContext,
  auditId: string,
): Promise<SiteAuditResult | null> {
  if (!auth.organizationId) return null;

  const { data: audit } = await supabaseAdmin
    .from('site_audits')
    .select('*, brands!inner(organization_id)')
    .eq('id', auditId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!audit || !(await mayUseBrand(auth, audit.brand_id))) return null;

  const { data: signalRows } = await supabaseAdmin
    .from('audit_signal_results')
    .select('signal_key, category, status, score, evidence')
    .eq('audit_id', auditId);

  const signals: SiteAuditSignal[] = ((signalRows ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      key: r.signal_key as string,
      category: (r.category as string | null) ?? null,
      status: r.status as string,
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      evidence: (r.evidence as Record<string, unknown>) ?? {},
    }),
  );

  const a = audit as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: a.id as string,
    brandId: a.brand_id as string,
    url: a.url as string,
    finalUrl: (a.final_url as string | null) ?? null,
    status: a.status as string,
    totalScore: num(a.total_score),
    categoryScores: (a.category_scores as Record<string, unknown>) ?? {},
    signalsEvaluated: a.signals_evaluated == null ? null : Number(a.signals_evaluated),
    signalsTotal: a.signals_total == null ? null : Number(a.signals_total),
    recommendations: (a.recommendations as unknown[]) ?? [],
    signals,
    error: (a.error as string | null) ?? null,
    createdAt: a.created_at as string,
    completedAt: (a.completed_at as string | null) ?? null,
  };
}

/** An opportunity's question and asset titles, a past year read as this one, as Content shows them. */
function withCurrentYear(sd: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!sd) return null;
  return {
    ...sd,
    ...(typeof sd.promptText === 'string' ? { promptText: refreshYears(sd.promptText) } : {}),
    ...(Array.isArray(sd.assets)
      ? {
          assets: sd.assets.map((a: unknown) =>
            a && typeof a === 'object' && typeof (a as { title?: unknown }).title === 'string'
              ? { ...a, title: refreshYears((a as { title: string }).title) }
              : a,
          ),
        }
      : {}),
  };
}

export async function getContentOpportunityFor(
  auth: McpAuthContext,
  opportunityId: string,
): Promise<ContentOpportunityDetail | null> {
  if (!auth.organizationId) return null;

  const { data, error } = await supabaseAdmin
    .from('content_opportunities')
    .select(
      'id, brand_id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, source_data, brief, prompts(text), brands!inner(organization_id)',
    )
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !(await mayUseBrand(auth, data.brand_id))) return null;

  const r = data as unknown as {
    id: string;
    brand_id: string;
    title: string;
    description: string | null;
    type: string;
    impact: string;
    opportunity_score: number | null;
    status: string;
    prompt_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    source_data: Record<string, unknown> | null;
    brief: Record<string, unknown> | null;
    prompts: Array<{ text: string }> | { text: string } | null;
  };

  const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
  // The organization is checked above: its prompt is read as the brand's.
  const question = r.prompt_id
    ? await readQuestionVolume(supabaseAdmin, r.brand_id, r.prompt_id)
    : null;
  const kept = r.source_data?.prompts;
  const prompts = Array.isArray(kept) ? kept.length : 1;

  return {
    id: r.id,
    title: refreshYears(r.title),
    description: r.description,
    type: r.type,
    impact: r.impact,
    opportunity_score: Number(r.opportunity_score ?? 0),
    status: r.status,
    prompt_id: r.prompt_id,
    // The tracked prompt's own text, as it is tracked.
    prompt_text: prompt?.text ?? null,
    volume: opportunityVolumeForMcp(question, prompts),
    source_data: withCurrentYear(r.source_data),
    brief: r.brief ?? null,
    created_at: r.created_at ?? '',
    updated_at: r.updated_at ?? '',
  };
}

export const CONTENT_OPPORTUNITY_STATUSES = [
  'new',
  'reviewed',
  'sent',
  'in_progress',
  'done',
  'dismissed',
] as const;

export type ContentOpportunityStatus = (typeof CONTENT_OPPORTUNITY_STATUSES)[number];

export interface UpdatedOpportunityStatus {
  id: string;
  status: ContentOpportunityStatus;
  updated_at: string;
}

/**
 * Move a content opportunity between workflow states (`new` → `sent` →
 * `in_progress` → `done`, or `dismissed`). Closes the loop for MCP-driven
 * content workflows — without this, the user analyses an opportunity in
 * Claude and still has to click through the dashboard to mark progress.
 *
 * Ownership-check-first: the update only runs after we've verified the
 * opportunity's brand belongs to the caller's org. Wrong-org or missing
 * id returns null (→ 404) with no DB write. Any member may record progress;
 * dismissing one, or bringing a dismissed one back, is an admin's or a
 * manager's call.
 */
export async function updateOpportunityStatusFor(
  auth: McpAuthContext,
  opportunityId: string,
  status: ContentOpportunityStatus,
): Promise<UpdatedOpportunityStatus | null> {
  if (!auth.organizationId) return null;

  // Ownership check via the same brands!inner join used by the read tools.
  // A wrong-org id misses here and we return null *before* any update.
  const { data: ownership } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, brand_id, status, brands!inner(organization_id)')
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership || !(await mayUseBrand(auth, ownership.brand_id))) return null;
  if (status === 'dismissed' || ownership.status === 'dismissed') requireManager(auth);

  const updatedAt = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('content_opportunities')
    .update({ status, updated_at: updatedAt })
    .eq('id', opportunityId)
    .select('id, status, updated_at')
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    status: data.status as ContentOpportunityStatus,
    updated_at: data.updated_at ?? updatedAt,
  };
}

// ── Competitor comparison + share of voice ───────────────────────────────────

export interface CompetitorComparisonParams {
  brandId: string;
  model?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  topicId?: string;
}

export interface CompetitorComparisonOutput {
  brand: {
    id: string;
    name: string;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    appearance_count: number;
    /** Distinct prompts the brand appeared in. */
    visible_prompts: number;
    /** Distinct prompts that produced results (shared denominator for all entries). */
    prompt_count: number;
    /**
     * DEPRECATED as the headline — coverage: visible_prompts / prompt_count
     * × 100. Prefer ai_visibility_score.
     */
    visibility_rate_pct: number;
    /**
     * HEADLINE metric (0-100): 0.6 × mention rate + 0.25 × citation rate +
     * 0.15 × position factor over the brand's filtered answers. Matches the
     * dashboard leaderboard. Null when the window has no answers.
     */
    ai_visibility_score: number | null;
  };
  competitors: Array<{
    competitor_id: string;
    name: string;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    appearance_count: number;
    /** Distinct prompts this competitor appeared in. */
    visible_prompts: number;
    /**
     * visible_prompts / prompt_count × 100, where prompt_count is the brand's
     * denominator so all entries are on the same scale.
     */
    visibility_rate_pct: number;
    /** Same prompt_count denominator as the brand for transparency. */
    prompt_count: number;
    /** AI Visibility Score over the brand's answers (shared denominator). */
    ai_visibility_score: number | null;
  }>;
  share_of_voice: {
    overall_sov_pct: number;
    total_brand_mentions: number;
    total_competitor_mentions: number;
    by_platform: Array<{
      model_used: string | null;
      platform: string | null;
      brand_mentions: number;
      competitor_mentions: number;
      sov_pct: number;
    }>;
  };
}

interface CompetitorAggRpc {
  brand_row_count: number;
  brand_sum_visibility: number;
  brand_total_mentions: number;
  brand_total_citations: number;
  /** Distinct prompts that produced result rows (shared denominator for all rates). */
  brand_prompt_count: number;
  /** Distinct prompts the brand appeared in (mention_count > 0 OR citation_count > 0). */
  brand_visible_prompts: number;
  by_competitor: Array<{
    competitor_id: string;
    name: string | null;
    sum_visibility: number;
    row_count: number;
    total_mentions: number;
    total_citations: number;
    /** Distinct prompts this competitor appeared in, using brand_prompt_count as denominator. */
    visible_prompts: number;
  }>;
}

interface SoVAggRpc {
  total_brand_mentions: number;
  total_competitor_mentions: number;
  by_platform: Array<{
    model_used: string | null;
    platform: string | null;
    brand_mentions: number;
    competitor_mentions: number;
  }>;
}

/**
 * Return a brand's competitor benchmark + share of voice for a window. Combines
 * two existing RPCs (`competitor_aggregates`, `share_of_voice_aggregates`) so the
 * MCP tool and REST surface answer "how do I compare?" / "who's gaining share of
 * voice?" in one round trip.
 *
 * Ownership-check first — wrong-org or missing brand returns null (→ 404
 * upstream) before either RPC fires. Deltas vs a previous window are out of
 * scope for V1 (matches the snapshot-shaped existing MCP tools); a caller that
 * wants a delta can issue a second tool call for the prior period.
 */
export async function getCompetitorComparisonFor(
  auth: McpAuthContext,
  params: CompetitorComparisonParams,
): Promise<CompetitorComparisonOutput | null> {
  if (!auth.organizationId) return null;

  // Ownership check + grab brand name in one query.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const rpcArgs = {
    p_brand_id: params.brandId,
    p_platform: null as string | null,
    p_models: p_models && p_models.length > 0 ? p_models : null,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    p_prompt_id: null as string | null,
    p_topic_id: params.topicId ?? null,
  };

  // Both RPCs are SECURITY DEFINER per the existing pattern — they trust the
  // caller's brand_id, which we've just verified above.
  const [compRes, sovRes, aiVisRes] = await Promise.all([
    supabaseAdmin.rpc('competitor_aggregates', rpcArgs),
    supabaseAdmin.rpc('share_of_voice_aggregates', rpcArgs),
    supabaseAdmin.rpc('ai_visibility_aggregates', rpcArgs),
  ]);
  if (compRes.error) throw new Error(compRes.error.message);
  if (sovRes.error) throw new Error(sovRes.error.message);
  if (aiVisRes.error) throw new Error(aiVisRes.error.message);

  const aiVis = (aiVisRes.data ?? {}) as {
    answers?: number;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | null;
    by_competitor?: Array<{
      competitor_id: string;
      mention_answers?: number;
      citation_answers?: number;
      position_factor?: number | null;
    }>;
  };
  const aiAnswers = Number(aiVis.answers ?? 0);
  const brandScore = computeAiVisibilityScore({
    answers: aiAnswers,
    mentionAnswers: Number(aiVis.mention_answers ?? 0),
    citationAnswers: Number(aiVis.citation_answers ?? 0),
    positionFactor: aiVis.position_factor ?? null,
  });
  const compScoreById = new Map<string, number | null>();
  for (const c of aiVis.by_competitor ?? []) {
    compScoreById.set(
      c.competitor_id,
      computeAiVisibilityScore({
        answers: aiAnswers,
        mentionAnswers: Number(c.mention_answers ?? 0),
        citationAnswers: Number(c.citation_answers ?? 0),
        positionFactor: c.position_factor ?? null,
      }),
    );
  }

  const comp = compRes.data as unknown as CompetitorAggRpc;
  const sov = sovRes.data as unknown as SoVAggRpc;

  const brandAvg =
    comp.brand_row_count > 0 ? Math.round(comp.brand_sum_visibility / comp.brand_row_count) : 0;

  const brandPromptCount = Number(comp.brand_prompt_count ?? 0);
  const brandVisiblePrompts = Number(comp.brand_visible_prompts ?? 0);
  const brandRatePct =
    brandPromptCount > 0 ? Math.round((brandVisiblePrompts / brandPromptCount) * 1000) / 10 : 0;

  const rateOf = (visible: number, total: number): number =>
    total > 0 ? Math.round((Number(visible) / total) * 1000) / 10 : 0;

  const competitors = comp.by_competitor.map((c) => ({
    competitor_id: c.competitor_id,
    name: c.name && c.name.trim() !== '' ? c.name : c.competitor_id,
    // Same denominator as the brand's average (every filtered row, absence
    // counts as 0) — mirrors getCompetitorComparison in actions/tracking.ts
    // so the MCP surface ranks brands the same way the Insights page does.
    avg_visibility_score:
      comp.brand_row_count > 0 ? Math.round(Number(c.sum_visibility) / comp.brand_row_count) : 0,
    total_mentions: Number(c.total_mentions),
    total_citations: Number(c.total_citations),
    appearance_count: c.row_count,
    visible_prompts: Number(c.visible_prompts ?? 0),
    // Use brand_prompt_count as the shared denominator so all entries are
    // directly comparable — matches the leaderboard semantics from PR #490.
    visibility_rate_pct: rateOf(c.visible_prompts ?? 0, brandPromptCount),
    prompt_count: brandPromptCount,
    ai_visibility_score: compScoreById.get(c.competitor_id) ?? null,
  }));

  const totalBrandMentions = Number(sov.total_brand_mentions);
  const totalCompMentions = Number(sov.total_competitor_mentions);
  const totalAll = totalBrandMentions + totalCompMentions;
  const overallSovPct = totalAll > 0 ? Math.round((totalBrandMentions / totalAll) * 1000) / 10 : 0;

  const byPlatform = sov.by_platform.map((bp) => {
    const brandM = Number(bp.brand_mentions);
    const compM = Number(bp.competitor_mentions);
    const total = brandM + compM;
    return {
      model_used: bp.model_used,
      platform: bp.platform,
      brand_mentions: brandM,
      competitor_mentions: compM,
      sov_pct: total > 0 ? Math.round((brandM / total) * 1000) / 10 : 0,
    };
  });

  return {
    brand: {
      id: brand.id,
      name: brand.name,
      avg_visibility_score: brandAvg,
      total_mentions: Number(comp.brand_total_mentions),
      total_citations: Number(comp.brand_total_citations),
      appearance_count: comp.brand_row_count,
      visible_prompts: brandVisiblePrompts,
      prompt_count: brandPromptCount,
      visibility_rate_pct: brandRatePct,
      ai_visibility_score: brandScore,
    },
    competitors,
    share_of_voice: {
      overall_sov_pct: overallSovPct,
      total_brand_mentions: totalBrandMentions,
      total_competitor_mentions: totalCompMentions,
      by_platform: byPlatform,
    },
  };
}

// ── Citations ────────────────────────────────────────────────────────────────

/**
 * Scope a citations query by the source category each URL is classified into
 * (#297). `owned` = the brand's own domains (`you`), `competitor` = a tracked
 * competitor domain, `external` = everything else (editorial / forum / social /
 * review / institutional / other), `all` = no filter (default, current output).
 */
export type CitationSourceFilter = 'all' | 'owned' | 'competitor' | 'external';

export const CITATION_SOURCE_FILTERS: CitationSourceFilter[] = [
  'all',
  'owned',
  'competitor',
  'external',
];

/** Does a classified category pass the requested source filter? */
function citationCategoryMatches(category: SourceCategory, filter: CitationSourceFilter): boolean {
  switch (filter) {
    case 'owned':
      return category === 'you';
    case 'competitor':
      return category === 'competitor';
    case 'external':
      return category !== 'you' && category !== 'competitor';
    case 'all':
    default:
      return true;
  }
}

export interface ListCitationsParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  /** Comma-separated model_used slugs (e.g. `gpt-4o,claude-sonnet-4-6`). */
  model?: string;
  region?: string;
  topicId?: string;
  /** Cap on the top_domains / top_urls arrays. Default 50, max 200. */
  limit?: number;
  /** Restrict to owned / competitor / external citations. Default `all`. */
  sourceFilter?: CitationSourceFilter;
}

export interface CitationsOverviewOutput {
  totals: {
    domains: number;
    urls: number;
    citations: number;
    results_with_citations: number;
    avg_citations_per_result: number;
  };
  source_type_breakdown: Array<{
    category: SourceCategory;
    count: number;
    pct: number;
  }>;
  top_domains: Array<{
    domain: string;
    category: SourceCategory;
    total_citations: number;
    results_citing: number;
    usage_pct: number;
    models: string[];
    article_types: Array<{ type: string; count: number }>;
  }>;
  top_urls: Array<{
    url: string;
    domain: string;
    category: SourceCategory;
    title: string;
    total_citations: number;
    results_citing: number;
    usage_pct: number;
    article_type: string | null;
  }>;
}

const CITATIONS_DEFAULT_LIMIT = 50;
const CITATIONS_MAX_LIMIT = 200;

/**
 * Return the URLs and domains AI engines cite alongside a brand, classified by
 * source type (news / review / owned / social / forum). Ports the JS-side
 * aggregation from `getCitationsOverview` in `actions/citations.ts` — citations
 * are stored as JSONB inside `prompt_results.citations` and each URL needs the
 * `classifyDomain` / `classifyArticleType` helpers, so this can't be folded
 * into a Postgres aggregate the way the competitor / SoV surfaces were in #114.
 *
 * Ownership-check first; the prompt_results scan only runs after the brand
 * belongs to the caller's org.
 */
export async function listCitationsFor(
  auth: McpAuthContext,
  params: ListCitationsParams,
): Promise<CitationsOverviewOutput | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // Brand + competitor domains feed `classifyDomain` so a URL hosted on the
  // user's own domain comes back as `'you'`, competitor URLs as `'competitor'`.
  const [{ data: brandDomainRows }, { data: competitorRows }] = await Promise.all([
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', params.brandId),
    supabaseAdmin.from('competitors').select('domain').eq('brand_id', params.brandId),
  ]);

  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const classifyCtx = { brandDomains, competitorDomains };

  // #155 — Citations summary is part of the Insights surface; chatgpt-shopping
  // rows are isolated from these aggregations.
  let query = supabaseAdmin
    .from('prompt_results')
    .select('id, prompt_id, platform, model_used, region, created_at, citations, citation_count')
    .eq('brand_id', params.brandId)
    .neq('platform', 'chatgpt-shopping');

  if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(params.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);
  if (params.region) query = query.eq('region', params.region);
  if (params.model) {
    const list = params.model
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    query =
      list.length > 1
        ? query.in('model_used', list)
        : query.eq('model_used', list[0] ?? params.model);
  }
  if (params.topicId) {
    const { data: topicPrompts } = await supabaseAdmin
      .from('prompts')
      .select('id')
      .eq('topic_id', params.topicId);
    const topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
    query = query.in(
      'prompt_id',
      topicPromptIds.length > 0 ? topicPromptIds : ['00000000-0000-0000-0000-000000000000'],
    );
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const results = (rows ?? []) as Array<{
    id: string;
    platform: string | null;
    model_used: string | null;
    citations: Citation[] | null;
  }>;

  interface DomainAgg {
    domain: string;
    category: SourceCategory;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
    articleTypeCounts: Map<string, number>;
  }
  interface UrlAgg {
    url: string;
    domain: string;
    category: SourceCategory;
    title: string;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
    articleType: string | null;
  }

  const domainMap = new Map<string, DomainAgg>();
  const urlMap = new Map<string, UrlAgg>();
  let totalCitations = 0;
  let resultsWithCitations = 0;
  const sourceFilter = params.sourceFilter ?? 'all';
  const hasSourceFilter = sourceFilter !== 'all';

  for (const result of results) {
    const citations = Array.isArray(result.citations) ? result.citations : [];
    if (citations.length === 0) continue;
    const modelKey = result.model_used || result.platform || '';
    // #297 — when a source_filter is set, a result only counts toward
    // results_with_citations if it contributes at least one matching citation.
    // With `all` (the default) we never call the matcher, so the aggregation is
    // byte-identical to the pre-#297 output.
    let matchedInResult = false;

    for (const cite of citations) {
      const host = extractHostname(cite.url);
      if (!host) continue;

      const category = classifyDomain(host, classifyCtx);
      if (hasSourceFilter && !citationCategoryMatches(category, sourceFilter)) continue;
      matchedInResult = true;
      totalCitations += 1;

      const existingDomain = domainMap.get(host) ?? {
        domain: host,
        category,
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
        articleTypeCounts: new Map<string, number>(),
      };
      existingDomain.totalCitations += 1;
      existingDomain.resultsCiting.add(result.id);
      if (modelKey) existingDomain.models.add(modelKey);
      const articleType = classifyArticleType(cite.url, cite.title);
      if (articleType) {
        existingDomain.articleTypeCounts.set(
          articleType,
          (existingDomain.articleTypeCounts.get(articleType) ?? 0) + 1,
        );
      }
      domainMap.set(host, existingDomain);

      // De-dupe URLs by stripping query/fragment + trailing slash so the same
      // article cited with different tracking params still aggregates.
      let normalizedUrl = cite.url;
      try {
        const parsed = new URL(cite.url);
        parsed.search = '';
        parsed.hash = '';
        normalizedUrl = parsed.toString().replace(/\/$/, '');
      } catch {
        // leave as-is
      }
      const existingUrl = urlMap.get(normalizedUrl) ?? {
        url: normalizedUrl,
        domain: host,
        category,
        title: cite.title || '',
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
        articleType,
      };
      existingUrl.totalCitations += 1;
      existingUrl.resultsCiting.add(result.id);
      if (modelKey) existingUrl.models.add(modelKey);
      if (!existingUrl.title && cite.title) existingUrl.title = cite.title;
      urlMap.set(normalizedUrl, existingUrl);
    }
    // `all`: count every result that had citations (original behavior).
    // Filtered: only results that contributed a matching citation.
    if (!hasSourceFilter || matchedInResult) resultsWithCitations += 1;
  }

  const totalResults = results.length;
  const limit = Math.min(Math.max(params.limit ?? CITATIONS_DEFAULT_LIMIT, 1), CITATIONS_MAX_LIMIT);

  const allDomains = Array.from(domainMap.values()).sort(
    (a, b) => b.totalCitations - a.totalCitations,
  );
  const topDomains = allDomains.slice(0, limit).map((agg) => {
    const resultsCiting = agg.resultsCiting.size;
    const articleTypes = Array.from(agg.articleTypeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return {
      domain: agg.domain,
      category: agg.category,
      total_citations: agg.totalCitations,
      results_citing: resultsCiting,
      usage_pct: totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0,
      models: Array.from(agg.models).sort(),
      article_types: articleTypes,
    };
  });

  const allUrls = Array.from(urlMap.values()).sort((a, b) => b.totalCitations - a.totalCitations);
  const topUrls = allUrls.slice(0, limit).map((agg) => {
    const resultsCiting = agg.resultsCiting.size;
    return {
      url: agg.url,
      domain: agg.domain,
      category: agg.category,
      title: agg.title,
      total_citations: agg.totalCitations,
      results_citing: resultsCiting,
      usage_pct: totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0,
      article_type: agg.articleType,
    };
  });

  // Source breakdown counts each *domain* once (matches the existing UI),
  // not each citation, so news/review/owned/social/forum percentages reflect
  // the diversity of cited sources rather than raw URL volume.
  const categoryCounts = new Map<SourceCategory, number>();
  for (const d of allDomains) {
    categoryCounts.set(d.category, (categoryCounts.get(d.category) ?? 0) + 1);
  }
  const totalDomains = allDomains.length;
  const sourceTypeBreakdown = SOURCE_CATEGORIES.map((category) => {
    const count = categoryCounts.get(category) ?? 0;
    return {
      category,
      count,
      pct: totalDomains > 0 ? Math.round((count / totalDomains) * 1000) / 10 : 0,
    };
  }).filter((b) => b.count > 0);

  return {
    totals: {
      domains: totalDomains,
      urls: allUrls.length,
      citations: totalCitations,
      results_with_citations: resultsWithCitations,
      avg_citations_per_result:
        totalResults > 0 ? Math.round((totalCitations / totalResults) * 10) / 10 : 0,
    },
    source_type_breakdown: sourceTypeBreakdown,
    top_domains: topDomains,
    top_urls: topUrls,
  };
}

// ── Visibility trend ────────────────────────────────────────────────────────

export type VisibilityTrendGranularity = 'day' | 'week';

export interface VisibilityTrendParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  /** Comma-separated model_used slugs (e.g. `gpt-4o,claude-sonnet-4-6`). */
  model?: string;
  region?: string;
  topicId?: string;
  granularity?: VisibilityTrendGranularity;
}

export interface VisibilityTrendOutput {
  granularity: VisibilityTrendGranularity;
  buckets: Array<{
    /** UTC bucket key in `YYYY-MM-DD` (week bucket = the ISO Monday). */
    date: string;
    result_count: number;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    /** Average competitor visibility unwrapped from `competitor_mentions`. */
    avg_competitor_score: number | null;
    /**
     * AI Visibility Score for the day (0-100) — the dashboard's Visibility
     * number. Only populated for day granularity; null on week buckets and
     * on payloads produced before the score shipped.
     */
    ai_visibility_score: number | null;
  }>;
}

interface VisibilityTrendBucketRpc {
  bucket_date: string;
  row_count: number;
  sum_visibility: number;
  sum_mentions: number;
  sum_citations: number;
  comp_sum_visibility: number;
  comp_count: number;
}

/**
 * Visibility / mentions / citations over time for a brand, with the
 * competitor average pulled out of `competitor_mentions` per row so a chart
 * can plot brand vs. competitor lines side by side.
 *
 * Aggregates server-side via the `visibility_trend_aggregates` RPC introduced
 * in 00008 — same pattern as the insights / competitor / SoV surfaces from
 * #114. The JS layer only divides and rounds; the row scan stays in
 * Postgres. Designed for the chart-rendering surfaces in the planned
 * in-product assistant (#94), which can fire a lot of these.
 *
 * Ownership-check first; wrong-org or missing brand returns null (→ 404)
 * before the RPC fires.
 */
export async function getVisibilityTrendFor(
  auth: McpAuthContext,
  params: VisibilityTrendParams,
): Promise<VisibilityTrendOutput | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const granularity: VisibilityTrendGranularity = params.granularity ?? 'day';

  const [{ data, error }, scoreRes] = await Promise.all([
    supabaseAdmin.rpc('visibility_trend_aggregates', {
      p_brand_id: params.brandId,
      p_models: p_models && p_models.length > 0 ? p_models : null,
      p_region: params.region ?? null,
      p_date_from: params.dateFrom ?? null,
      p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
      p_topic_id: params.topicId ?? null,
      p_granularity: granularity,
    }),
    // Per-day score components (00040); the trend RPC above only carries the
    // legacy sums. Day buckets merge by date; week buckets keep null.
    granularity === 'day'
      ? supabaseAdmin.rpc('visibility_rate_trend', {
          p_brand_id: params.brandId,
          p_platform: null,
          p_models: p_models && p_models.length > 0 ? p_models : null,
          p_region: params.region ?? null,
          p_date_from: params.dateFrom ?? null,
          p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
          p_topic_id: params.topicId ?? null,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) throw new Error(error.message);

  const scoreByDay = new Map<string, number | null>();
  for (const row of (scoreRes.data ?? []) as unknown as Array<{
    day: string;
    answers: number;
    mention_answers: number;
    citation_answers: number;
    position_factor: number | null;
  }>) {
    scoreByDay.set(
      row.day,
      computeAiVisibilityScore({
        answers: Number(row.answers ?? 0),
        mentionAnswers: Number(row.mention_answers ?? 0),
        citationAnswers: Number(row.citation_answers ?? 0),
        positionFactor: row.position_factor ?? null,
      }),
    );
  }

  const raw = (data as unknown as VisibilityTrendBucketRpc[]) ?? [];
  const buckets = raw.map((b) => ({
    date: b.bucket_date,
    result_count: Number(b.row_count),
    avg_visibility_score:
      b.row_count > 0 ? Math.round(Number(b.sum_visibility) / Number(b.row_count)) : 0,
    total_mentions: Number(b.sum_mentions),
    total_citations: Number(b.sum_citations),
    avg_competitor_score:
      b.comp_count > 0 ? Math.round(Number(b.comp_sum_visibility) / Number(b.comp_count)) : null,
    ai_visibility_score: scoreByDay.get(b.bucket_date) ?? null,
  }));

  return { granularity, buckets };
}

export interface AiTrafficParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AiTrafficOutput {
  /**
   * Whether the tracking snippet is installed (trafficSources.ts
   * snippetState): 'not_detected' (not seen on the site, so no visit can
   * be counted yet), 'installed_quiet' (installed, no AI visit in the last
   * 7 days) or 'active'.
   */
  tracking: SnippetState;
  total_visits: number;
  platform_breakdown: Array<{
    platform: string;
    visits: number;
  }>;
  top_pages: Array<{
    url: string;
    visits: number;
  }>;
  country_breakdown: Array<{
    country: string;
    visits: number;
  }>;
}

/**
 * Returns AI-referral breakdown (platform / pages / country) for the brand/range.
 * Enforces organization ownership.
 */
export async function getAiTrafficFor(
  auth: McpAuthContext,
  params: AiTrafficParams,
): Promise<AiTrafficOutput | null> {
  if (!auth.organizationId) return null;

  // Ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // Visits, not pageviews: a row whose visit_of is null starts one (00172),
  // as the AI Traffic page counts them. The total by count, which no row cap
  // touches, and the breakdowns by paging through the range: one plain
  // select stopped at PostgREST's 1,000 rows.
  const range = {
    from: params.dateFrom,
    to: expandDateToEndOfDay(params.dateTo),
    toInclusive: true,
  };
  const rawRows: Array<{
    source_platform: string | null;
    url: string;
    country: string | null;
  }> = [];
  const [totalVisits, snippet] = await Promise.all([
    countTrafficLogs(supabaseAdmin, params.brandId, range),
    readSnippet(supabaseAdmin, params.brandId),
    scanTrafficLogs(
      supabaseAdmin,
      params.brandId,
      { ...range, columns: 'source_platform, url, country' },
      (row) => rawRows.push(row as (typeof rawRows)[number]),
    ),
  ]);

  // Platform breakdown
  const platformMap = new Map<string, number>();
  for (const r of rawRows) {
    const p = r.source_platform || 'unknown';
    platformMap.set(p, (platformMap.get(p) ?? 0) + 1);
  }
  const platform_breakdown = Array.from(platformMap.entries())
    .map(([platform, visits]) => ({ platform, visits }))
    .sort((a, b) => b.visits - a.visits);

  // Top pages
  const pageMap = new Map<string, number>();
  for (const r of rawRows) {
    const url = r.url;
    try {
      const path = new URL(url).pathname;
      pageMap.set(path, (pageMap.get(path) ?? 0) + 1);
    } catch {
      pageMap.set(url, (pageMap.get(url) ?? 0) + 1);
    }
  }
  const top_pages = Array.from(pageMap.entries())
    .map(([url, visits]) => ({ url, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  // Country breakdown
  const countryMap = new Map<string, number>();
  for (const r of rawRows) {
    const c = r.country || 'unknown';
    countryMap.set(c, (countryMap.get(c) ?? 0) + 1);
  }
  const country_breakdown = Array.from(countryMap.entries())
    .map(([country, visits]) => ({ country, visits }))
    .sort((a, b) => b.visits - a.visits);

  return {
    tracking: snippetState(snippet),
    total_visits: totalVisits,
    platform_breakdown,
    top_pages,
    country_breakdown,
  };
}

// ── Prompt volumes ──────────────────────────────────────────────────────────

export interface PromptVolumesParams {
  brandId: string;
  /** Row cap on the returned prompts. Default 100, max 500. */
  limit?: number;
}

export interface PromptVolumeRow {
  prompt_id: string;
  prompt_text: string | null;
  intent: string;
  keywords: string[];
  /** `{ keyword: monthly_google_volume }` map. */
  google_volumes: Record<string, number>;
  total_google_volume: number;
  est_ai_volume: number;
  /**
   * The estimate's likely range (PROMPT-013): from the spread of the measured
   * keyword volumes, never under half or over twice est_ai_volume.
   */
  est_ai_volume_low: number;
  est_ai_volume_high: number;
  /** How far the measured keywords agree; one level less after six months. */
  volume_confidence: EstimateConfidence;
  /** Always 'estimate': AI engines publish no search volumes. */
  volume_type: 'estimate';
  ai_volume_multiplier: number;
  /** Volume-weighted competition index 0-100, or null if unknown. */
  competition_index: number | null;
  /** Bucketed competition label ("LOW" | "MEDIUM" | "HIGH"), or null. */
  competition: string | null;
  fetched_at: string | null;
  /**
   * The prompt's real demand (PROMPT-014): Search Console, Google Trends,
   * People Also Ask and YouTube, with the level they come to. Null until the
   * nightly sweep read any.
   */
  measured_demand: PromptDemand | null;
}

const PROMPT_VOLUMES_DEFAULT_LIMIT = 100;
const PROMPT_VOLUMES_MAX_LIMIT = 500;

/**
 * Return per-prompt search-volume + competition rows for a brand, scoped
 * `brand → prompt_sets → prompts → prompt_volumes`. Surfaces the demand
 * (`total_google_volume`, the median of the keywords' volumes, and
 * `est_ai_volume`) and competition meter
 * (`competition_index` / `competition`, see #44) so callers can answer
 * "which prompts have the most demand / the least competition?".
 *
 * Ownership-check first; wrong-org or missing brand returns null (→ 404
 * upstream) before any volume rows are read. Triggering a fresh volume
 * analysis (the paid DataForSEO call) lives on the aeo-server and is out of
 * scope here — this is a read of already-computed rows.
 */
export async function getPromptVolumesFor(
  auth: McpAuthContext,
  params: PromptVolumesParams,
): Promise<PromptVolumeRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(
    Math.max(params.limit ?? PROMPT_VOLUMES_DEFAULT_LIMIT, 1),
    PROMPT_VOLUMES_MAX_LIMIT,
  );

  // prompt_volumes → prompts (1:1) → prompt_sets, filtered to this brand via
  // the nested inner joins. Sorted by AI demand so the highest-opportunity
  // prompts come first.
  const { data, error } = await supabaseAdmin
    .from('prompt_volumes')
    .select(
      'prompt_id, intent, keywords, google_volumes, total_google_volume, est_ai_volume, ai_volume_multiplier, competition_index, competition, fetched_at, prompts!inner(text, prompt_sets!inner(brand_id))',
    )
    .eq('prompts.prompt_sets.brand_id', params.brandId)
    .order('est_ai_volume', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows =
    (data as unknown as Array<{
      prompt_id: string;
      intent: string;
      keywords: string[] | null;
      google_volumes: Record<string, number> | null;
      total_google_volume: number | null;
      est_ai_volume: number | null;
      ai_volume_multiplier: number | string | null;
      competition_index: number | null;
      competition: string | null;
      fetched_at: string | null;
      prompts: { text: string } | Array<{ text: string }> | null;
    }> | null) ?? [];

  const demand = await readPromptDemand(
    params.brandId,
    rows.map((r) => r.prompt_id),
  );
  const now = new Date();
  return rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
    const estimate = promptVolumeEstimate(
      {
        estAiVolume: Number(r.est_ai_volume ?? 0),
        googleVolumes: r.google_volumes ?? {},
        aiVolumeMultiplier: Number(r.ai_volume_multiplier ?? 0),
        keywords: r.keywords ?? [],
        fetchedAt: r.fetched_at as string,
      },
      now,
    );
    return {
      prompt_id: r.prompt_id,
      prompt_text: prompt?.text ?? null,
      intent: r.intent,
      keywords: r.keywords ?? [],
      google_volumes: r.google_volumes ?? {},
      total_google_volume: Number(r.total_google_volume ?? 0),
      est_ai_volume: Number(r.est_ai_volume ?? 0),
      est_ai_volume_low: estimate.low,
      est_ai_volume_high: estimate.high,
      volume_confidence: estimate.confidence,
      volume_type: 'estimate' as const,
      ai_volume_multiplier: Number(r.ai_volume_multiplier ?? 0),
      competition_index: r.competition_index,
      competition: r.competition,
      fetched_at: r.fetched_at,
      measured_demand: demand.get(r.prompt_id) ?? null,
    };
  });
}

// ── Shopping Cards ────────────────────────────────────────────────────────────

/** A read of a feature the organization's plan doesn't include. */
export const NOT_IN_PLAN = 'not_in_plan';

/**
 * What a shopping read answers without the feature, as the API's
 * requireFeature does: the tools' error text, and the REST routes' 403 body.
 */
export const SHOPPING_NOT_IN_PLAN = {
  error: 'plan_limit',
  message:
    `Shopping analytics comes with the ${PLANS[getMinimumPlanForFeature('shopping_analytics')].name} ` +
    "plan and above, and this workspace's plan doesn't include it. An admin can upgrade in " +
    'Settings › Billing.',
} as const;

/**
 * Whether the organization's plan includes `feature`, for a read: once a plan
 * has ended (read-only), the plan it was on, as the dashboard and the API's
 * readOnly reads keep it. Self-hosted has every feature.
 */
export async function planIncludes(organizationId: string, feature: Feature): Promise<boolean> {
  if (!isCloud()) return true;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return hasFeature(usagePlanFromOrgRow(data).plan, feature);
}

export interface ListShoppingCardsParams {
  brandId: string;
  role?: 'own' | 'competitor' | 'other';
  platform?: string;
  region?: string;
  limit?: number;
  cursor?: string;
}

export interface ShoppingCardRow {
  id: string;
  prompt_result_id: string;
  brand_id: string;
  position: number;
  product_title: string | null;
  product_brand: string | null;
  price_amount: number | null;
  price_currency: string | null;
  image_url: string | null;
  merchant_url: string | null;
  merchant_domain: string | null;
  rating: number | null;
  review_count: number | null;
  raw: Record<string, unknown>;
  matched_brand_id: string | null;
  matched_brand_role: string;
  platform: string;
  region: string | null;
  created_at: string;
}

export interface ListShoppingCardsOutput {
  cards: ShoppingCardRow[];
  next_cursor: string | null;
}

/** The brand's shopping cards: NOT_IN_PLAN on a plan without shopping analytics (Starter). */
export async function listShoppingCards(
  auth: McpAuthContext,
  params: ListShoppingCardsParams,
): Promise<ListShoppingCardsOutput | typeof NOT_IN_PLAN | null> {
  if (!auth.organizationId) return null;

  // Brand ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;
  if (!(await planIncludes(auth.organizationId, 'shopping_analytics'))) return NOT_IN_PLAN;

  const finalLimit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  let cursorData: { created_at: string; id: string } | null = null;
  if (params.cursor) {
    try {
      cursorData = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf8'));
    } catch {
      // Ignore invalid cursor
    }
  }

  let query = supabaseAdmin
    .from('prompt_result_shopping_cards')
    .select('*')
    .eq('brand_id', params.brandId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(finalLimit + 1);

  if (params.role) {
    query = query.eq('matched_brand_role', params.role);
  }
  if (params.platform) {
    query = query.eq('platform', params.platform);
  }
  if (params.region) {
    query = query.eq('region', params.region);
  }

  if (cursorData) {
    query = query.or(
      `created_at.lt.${cursorData.created_at},and(created_at.eq.${cursorData.created_at},id.lt.${cursorData.id})`,
    );
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const cards = (rows ?? []) as ShoppingCardRow[];
  const hasNextPage = cards.length > finalLimit;
  const slicedCards = hasNextPage ? cards.slice(0, finalLimit) : cards;

  let nextCursor: string | null = null;
  if (hasNextPage && slicedCards.length > 0) {
    const lastItem = slicedCards[slicedCards.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ created_at: lastItem.created_at, id: lastItem.id }),
    ).toString('base64');
  }

  return {
    cards: slicedCards,
    next_cursor: nextCursor,
  };
}

export interface ProductVisibilityOutput {
  product_title: string;
  total_appearances: number;
  by_platform: Array<{ platform: string; count: number }>;
  by_region: Array<{ region: string; count: number }>;
  by_date: Array<{ date: string; count: number }>;
  latest_appearance: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  merchant_domains: Array<{ domain: string; count: number }>;
}

/** One product's visibility: NOT_IN_PLAN on a plan without shopping analytics (Starter). */
export async function getProductVisibility(
  auth: McpAuthContext,
  params: { brandId: string; productTitle: string },
): Promise<ProductVisibilityOutput | typeof NOT_IN_PLAN | null> {
  if (!auth.organizationId) return null;

  // Brand ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;
  if (!(await planIncludes(auth.organizationId, 'shopping_analytics'))) return NOT_IN_PLAN;

  const { data: cards, error } = await supabaseAdmin
    .from('prompt_result_shopping_cards')
    .select(
      'platform, region, created_at, price_amount, price_currency, rating, review_count, merchant_domain',
    )
    .eq('brand_id', params.brandId)
    .eq('product_title', params.productTitle)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!cards || cards.length === 0) return null;

  const total_appearances = cards.length;

  const platformMap = new Map<string, number>();
  const regionMap = new Map<string, number>();
  const dateMap = new Map<string, number>();
  const domainMap = new Map<string, number>();

  let ratingSum = 0;
  let ratingCount = 0;
  let totalReviews: number | null = null;

  for (const card of cards) {
    const platform = card.platform || 'unknown';
    platformMap.set(platform, (platformMap.get(platform) ?? 0) + 1);

    const region = card.region || 'unknown';
    regionMap.set(region, (regionMap.get(region) ?? 0) + 1);

    const date = card.created_at ? card.created_at.slice(0, 10) : 'unknown';
    dateMap.set(date, (dateMap.get(date) ?? 0) + 1);

    if (card.merchant_domain) {
      domainMap.set(card.merchant_domain, (domainMap.get(card.merchant_domain) ?? 0) + 1);
    }

    if (card.rating !== null && card.rating !== undefined) {
      ratingSum += Number(card.rating);
      ratingCount += 1;
    }

    if (card.review_count !== null && card.review_count !== undefined) {
      if (totalReviews === null) totalReviews = 0;
      totalReviews += card.review_count;
    }
  }

  const by_platform = Array.from(platformMap.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);

  const by_region = Array.from(regionMap.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  const by_date = Array.from(dateMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date)); // Sort chronologically descending

  const merchant_domains = Array.from(domainMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  const average_rating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
  const latest_appearance = cards[0]?.created_at || null;

  return {
    product_title: params.productTitle,
    total_appearances,
    by_platform,
    by_region,
    by_date,
    latest_appearance,
    average_rating,
    total_reviews: totalReviews,
    merchant_domains,
  };
}

// ── Prompt Performance ────────────────────────────────────────────────────────

export interface PromptPerformanceParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  topicId?: string;
  sortBy?: 'visibility' | 'mentions' | 'citations' | 'appearances';
  order?: 'desc' | 'asc';
  limit?: number;
  model?: string;
  region?: string;
}

export interface PromptPerformanceOutput {
  brand: { id: string; name: string };
  window: { dateFrom: string | null; dateTo: string | null };
  prompts: Array<{
    prompt_id: string;
    prompt_text: string;
    topic_name: string | null;
    result_count: number;
    avg_visibility: number;
    total_mentions: number;
    total_citations: number;
    avg_competitor_score: number;
  }>;
}

interface PromptPerformanceRpcResult {
  prompt_id: string;
  prompt_text: string;
  topic_name: string | null;
  result_count: number;
  sum_visibility: number;
  total_mentions: number;
  total_citations: number;
  comp_sum_visibility: number;
  comp_count: number;
}

/**
 * Aggregates prompt-level performance over the given window.
 * Enforces organization ownership.
 */
export async function getPromptPerformanceFor(
  auth: McpAuthContext,
  params: PromptPerformanceParams,
): Promise<PromptPerformanceOutput | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const { data, error } = await supabaseAdmin.rpc('prompt_performance_aggregates', {
    p_brand_id: params.brandId,
    p_models: p_models && p_models.length > 0 ? p_models : null,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    p_topic_id: params.topicId ?? null,
  });

  if (error) throw new Error(error.message);

  const raw = (data as unknown as PromptPerformanceRpcResult[]) ?? [];

  let prompts = raw.map((item) => {
    const result_count = Number(item.result_count);
    const avg_visibility =
      result_count > 0 ? Math.round(Number(item.sum_visibility) / result_count) : 0;
    const avg_competitor_score =
      Number(item.comp_count) > 0
        ? Math.round(Number(item.comp_sum_visibility) / Number(item.comp_count))
        : 0;

    return {
      prompt_id: item.prompt_id,
      prompt_text: item.prompt_text,
      topic_name: item.topic_name,
      result_count,
      avg_visibility,
      total_mentions: Number(item.total_mentions),
      total_citations: Number(item.total_citations),
      avg_competitor_score,
    };
  });

  // Sorting
  const sortBy = params.sortBy ?? 'visibility';
  const order = params.order ?? 'desc';
  const isAsc = order === 'asc';

  prompts.sort((a, b) => {
    let valA = 0;
    let valB = 0;
    if (sortBy === 'visibility') {
      valA = a.avg_visibility;
      valB = b.avg_visibility;
    } else if (sortBy === 'mentions') {
      valA = a.total_mentions;
      valB = b.total_mentions;
    } else if (sortBy === 'citations') {
      valA = a.total_citations;
      valB = b.total_citations;
    } else if (sortBy === 'appearances') {
      valA = a.result_count;
      valB = b.result_count;
    }

    if (valA !== valB) {
      return isAsc ? valA - valB : valB - valA;
    }
    // Stable fallback sorting
    return a.prompt_id.localeCompare(b.prompt_id);
  });

  // Limiting
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
  prompts = prompts.slice(0, limit);

  return {
    brand: {
      id: brand.id,
      name: brand.name,
    },
    window: {
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
    },
    prompts,
  };
}

// ── Action Center ────────────────────────────────────────────────────────────
//
// The engine's output: detected signals, the actions consolidated from them,
// each action's task plan and, once closed, its measured result. Read with the
// same field names as `lib/actions/actionCenter.ts`, but through the API-key
// context rather than the signed-in user. `kind` stays an opaque string: the
// server's definition registry grows on its own release cycle.

/** Task statuses an MCP client may set. Approval and its states stay with the
 *  dashboard, and nothing here lets an agent execute a task — only report on it. */
export const MCP_TASK_STATUSES = ['in_progress', 'completed', 'skipped', 'failed'] as const;
export type McpTaskStatus = (typeof MCP_TASK_STATUSES)[number];

/** Skipped and failed tasks are not outstanding work, so they leave the
 *  progress denominator — same rule as the dashboard. */
const UNCOUNTED_TASK_STATUSES = ['skipped', 'failed'];

const MCP_SIGNAL_COLUMNS =
  'id, category, kind, impact, status, source, detected_at, last_detected_at, resolved_at, previous_value, current_value, change_value, payload, kpi_keys, action_id';

/**
 * Whether the person a key or a call acts for may use a brand now
 * (BRAND-ACCESS §5.3): one of their organization's that their access
 * reaches (All brands, the brands shared with them, the demo brand). An API
 * key carries its owner's access, since keys belong to people. A brand they
 * may not use answers as another organization's does: not found.
 */
export async function brandAllowed(auth: McpAuthContext, brandId: string): Promise<boolean> {
  if (!auth.organizationId) return false;
  const [{ data }, access] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id')
      .eq('id', brandId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
    brandAccessFor(auth),
  ]);
  return Boolean(data) && hasBrandAccess(access, brandId);
}

/**
 * Whether the person's access reaches a brand already found in their
 * organization: a brand read by id and organization, or the brand of a row
 * read through `brands!inner(organization_id)`. All brands reach every one.
 */
export async function mayUseBrand(
  auth: McpAuthContext,
  brandId: string | null | undefined,
): Promise<boolean> {
  const access = await brandAccessFor(auth);
  return access === 'all' || (Boolean(brandId) && hasBrandAccess(access, brandId as string));
}

async function assigneeNames(ids: (string | null)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));
}

export interface ActionListRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  assignee: { id: string; full_name: string | null } | null;
  due_date: string | null;
  task_progress: { completed: number; total: number };
  priority: ActionPriorityForMcp | null;
  /** New for 30 days or more with no one's event (00432); never set on another status. */
  stale: boolean;
  stale_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * An action's priority (AC-006): its 0–100 score, its level, and the facts
 * the score rests on (change, subject, demand, commercial intent, whether the
 * ground was held before, days since the evidence, and each factor 0–1).
 * Null until the server has scored the action.
 */
export interface ActionPriorityForMcp {
  score: number;
  level: string | null;
  reason: Record<string, unknown> | null;
  /**
   * How sure the score is of what it rests on, as a level (`reason.factors.
   * confidence` is the raw factor), and why: "one kind of finding from one
   * source". Null from a scorer before it was kept.
   */
  confidence: ConfidenceLevel | null;
  confidence_note: string | null;
  /** The raw 0–1 factor, as `reason.factors.confidence`. */
  confidence_score: number | null;
}

function priorityFor(row: {
  priority_score?: number | null;
  priority_level?: string | null;
  priority_reason?: unknown;
}): ActionPriorityForMcp | null {
  if (row.priority_score === null || row.priority_score === undefined) return null;
  const confidence = parsePriorityReason(row.priority_reason)?.confidence ?? null;
  return {
    score: Number(row.priority_score),
    level: row.priority_level ?? null,
    reason:
      row.priority_reason && typeof row.priority_reason === 'object'
        ? (row.priority_reason as Record<string, unknown>)
        : null,
    confidence: confidence?.level ?? null,
    confidence_note: confidence ? confidenceNote(confidence) : null,
    confidence_score: confidence?.score ?? null,
  };
}

/** Stale (00432) only while New: the stamp waits for the nightly pass to clear it. */
function staleFor(row: { status?: string | null; stale_at?: string | null }) {
  const stale = row.status === 'new' && Boolean(row.stale_at);
  return { stale, stale_at: stale ? (row.stale_at ?? null) : null };
}

export interface ListActionsParams {
  brandId: string;
  status?: string;
  category?: string;
  limit?: number;
  /**
   * `priority` (default): highest priority score first, unscored last — the
   * order the app lists them in; `updated`: most recently updated first.
   */
  sort?: 'updated' | 'priority';
}

export async function listActionsFor(
  auth: McpAuthContext,
  params: ListActionsParams,
): Promise<ActionListRow[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  let query = supabaseAdmin
    .from('actions')
    .select(
      'id, action_no, category, kind, impact, status, outcome, assignee_id, due_date, created_at, updated_at, priority_score, priority_level, priority_reason, stale_at, target_entity:payload->>targetEntity, target_count:payload->targetCount',
    )
    .eq('brand_id', params.brandId)
    // A deleted action (00168) is gone for everyone but the nightly generator.
    .is('deleted_at', null);
  query =
    params.sort === 'updated'
      ? query.order('updated_at', { ascending: false })
      : query
          .order('priority_score', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false });
  query = query.limit(limit);
  if (params.status) query = query.eq('status', params.status);
  if (params.category) query = query.eq('category', params.category);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: tasks, error: taskError } = await supabaseAdmin
    .from('action_tasks')
    .select('action_id, status')
    .in(
      'action_id',
      rows.map((r) => r.id),
    );
  if (taskError) throw new Error(taskError.message);

  const progress = new Map<string, { completed: number; total: number }>();
  for (const task of tasks ?? []) {
    if (UNCOUNTED_TASK_STATUSES.includes(task.status)) continue;
    const acc = progress.get(task.action_id) ?? { completed: 0, total: 0 };
    acc.total += 1;
    if (task.status === 'completed') acc.completed += 1;
    progress.set(task.action_id, acc);
  }
  const [names, entityCounts] = await Promise.all([
    assigneeNames(rows.map((r) => r.assignee_id)),
    // Each action's list (AC-009): its reason names the count left, as get_action's does.
    readEntityCounts(
      supabaseAdmin,
      rows.map((r) => r.id),
    ),
  ]);

  return rows.map((r) => ({
    id: r.id,
    action_no: Number(r.action_no),
    category: r.category,
    kind: r.kind,
    impact: r.impact,
    status: r.status,
    outcome: r.outcome ?? null,
    assignee: r.assignee_id
      ? { id: r.assignee_id, full_name: names.get(r.assignee_id) ?? null }
      : null,
    due_date: r.due_date ?? null,
    task_progress: progress.get(r.id) ?? { completed: 0, total: 0 },
    priority: priorityFor({
      ...r,
      priority_reason: currentPriorityReason(
        r.priority_reason,
        withEntityCounts(
          { targetEntity: r.target_entity, targetCount: r.target_count },
          entityCounts.get(r.id),
        ),
      ),
    }),
    ...staleFor(r),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export interface ActionDetailForMcp {
  id: string;
  action_no: number;
  brand_id: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  /** Its change net of the brand's prompts it didn't touch (learning B2); null when not netted. */
  net_of_control: McpNetOfControl | null;
  /** Why it was dismissed, as the person said (learning A5); null otherwise. */
  dismiss_reason: ActionDismissReason | null;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  assignee: { id: string; full_name: string | null } | null;
  due_date: string | null;
  priority: ActionPriorityForMcp | null;
  /** As on list_actions. */
  stale: boolean;
  stale_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  tasks: Array<{
    id: string;
    position: number;
    task_key: string | null;
    title: string | null;
    title_params: Record<string, unknown>;
    status: string;
    skip_reason: string | null;
    mode: string | null;
    permission: string | null;
    depends_on: string[];
    details: ReturnType<typeof mcpTaskDetails>;
  }>;
  signals: Record<string, unknown>[];
  events: Array<{ event: string; data: Record<string, unknown>; created_at: string }>;
}

/** A library task's Done when from its template (AC-010), in English as the rest of the output. */
const doneWhenT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.taskDoneWhen' as never,
});
const templateDoneWhen = (taskKey: string) =>
  doneWhenT.has(taskKey as never) ? doneWhenT(taskKey as never) : null;

/** A task's details in the snake_case the rest of the MCP output uses. */
export function mcpTaskDetails(raw: unknown, taskKey: string | null = null) {
  const d = withTemplateCheck(
    withTemplateDoneWhen(parseTaskDetails(raw), taskKey, templateDoneWhen),
    taskKey,
  );
  if (!d) return null;
  return {
    // The exact page, the change to make there and how we check it (AC-010).
    url: d.url,
    where: d.where,
    why: d.why,
    change: d.change,
    how: d.how,
    done_when: d.doneWhen,
    check: d.check,
    type: d.type,
    effort: d.effort,
    role: d.role,
    body: d.body,
    platform: d.platform,
    platform_label: d.platformLabel,
    sources: d.sources,
    // Where it was sent (AC-004).
    sent_to_content: d.sent.content
      ? { opportunity_id: d.sent.content.opportunityId, at: d.sent.content.at }
      : null,
    sent_to_webhook: d.sent.webhook ? { at: d.sent.webhook.at } : null,
  };
}

/** An action as get_action reads it; dismiss_reason is absent on a database without 00366. */
interface ActionDetailRow {
  id: string;
  action_no: number;
  brand_id: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  validation: unknown;
  dismiss_reason?: string | null;
  payload: unknown;
  kpi_keys: string[] | null;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  priority_score: number | null;
  priority_level: string | null;
  priority_reason: unknown;
}

const ACTION_DETAIL_COLUMNS =
  'id, action_no, brand_id, category, kind, impact, status, outcome, validation, payload, kpi_keys, assignee_id, due_date, created_at, updated_at, completed_at, priority_score, priority_level, priority_reason, stale_at, brands!inner(organization_id)';

export async function getActionFor(
  auth: McpAuthContext,
  actionId: string,
): Promise<ActionDetailForMcp | null> {
  const organizationId = auth.organizationId;
  if (!organizationId) return null;

  const read = (columns: string) =>
    supabaseAdmin
      .from('actions')
      .select(columns)
      .eq('id', actionId)
      .eq('brands.organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle();
  let { data, error } = await read(`${ACTION_DETAIL_COLUMNS}, dismiss_reason`);
  // A database without 00366 has no dismiss_reason (42703): the rest is read, no reason given.
  if (missingDismissReason(error)) ({ data, error } = await read(ACTION_DETAIL_COLUMNS));
  if (error) throw new Error(error.message);
  const action = data as unknown as ActionDetailRow | null;
  if (!action || !(await mayUseBrand(auth, action.brand_id))) return null;

  const [tasksRes, signalsRes, eventsRes, names, entityCounts] = await Promise.all([
    supabaseAdmin
      .from('action_tasks')
      .select(
        'id, position, task_key, title, title_params, status, skip_reason, mode, permission, depends_on, details',
      )
      .eq('action_id', actionId)
      .order('position'),
    // Every signal the action has taken as evidence (AC-007), kept after a
    // signal moves on to a later cycle.
    supabaseAdmin
      .from('signals')
      .select(`${MCP_SIGNAL_COLUMNS}, action_signals!inner(action_id)`)
      .eq('brand_id', action.brand_id)
      .eq('action_signals.action_id', actionId)
      .order('detected_at', { ascending: false }),
    supabaseAdmin
      .from('action_events')
      .select('event, data, created_at')
      .eq('action_id', actionId)
      .order('created_at'),
    assigneeNames([action.assignee_id]),
    // Its list (AC-009): the count left, and what was removed since.
    readEntityCounts(supabaseAdmin, [actionId]),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  const payload = withEntityCounts(
    (action.payload ?? {}) as Record<string, unknown>,
    entityCounts.get(actionId),
  );

  return {
    id: action.id,
    action_no: Number(action.action_no),
    brand_id: action.brand_id,
    category: action.category,
    kind: action.kind,
    impact: action.impact,
    status: action.status,
    outcome: action.outcome ?? null,
    net_of_control: netOfControl(action.validation),
    // Only while it is dismissed: another status leaves an earlier reason in place.
    dismiss_reason: action.status === 'dismissed' ? dismissReasonOf(action.dismiss_reason) : null,
    payload,
    kpi_keys: action.kpi_keys ?? [],
    assignee: action.assignee_id
      ? { id: action.assignee_id, full_name: names.get(action.assignee_id) ?? null }
      : null,
    due_date: action.due_date ?? null,
    priority: priorityFor({
      ...action,
      priority_reason: currentPriorityReason(action.priority_reason, payload),
    }),
    ...staleFor(action),
    created_at: action.created_at,
    updated_at: action.updated_at,
    completed_at: action.completed_at ?? null,
    tasks: (tasksRes.data ?? []).map((t) => ({
      id: t.id,
      position: t.position,
      task_key: t.task_key ?? null,
      title: t.title ?? null,
      title_params: (currentTaskParams(
        (t.title_params ?? {}) as Record<string, string | number>,
        payload,
      ) ?? {}) as Record<string, unknown>,
      status: t.status,
      skip_reason: t.skip_reason ?? null,
      mode: t.mode ?? null,
      permission: t.permission ?? null,
      depends_on: (t.depends_on ?? []) as string[],
      // Where, why, how and done-when (AC-004), the exact page, the change and how
      // it's checked (AC-010); an Improve task's body and evidence.
      details: mcpTaskDetails(t.details, t.task_key ?? null),
    })),
    // The join that found them is not part of a signal.
    signals: ((signalsRes.data ?? []) as Record<string, unknown>[]).map((row) =>
      withoutTargetIds(
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'action_signals')),
      ),
    ),
    events: (eventsRes.data ?? []).map((e) => ({
      event: e.event,
      data: (e.data ?? {}) as Record<string, unknown>,
      created_at: e.created_at,
    })),
  };
}

export interface ListSignalsParams {
  brandId: string;
  status?: string;
  kind?: string;
  limit?: number;
}

/** Signal ids per action_signals read: 100 UUIDs keep the request line well under 8KB. */
const SIGNAL_LINK_CHUNK = 100;

type LinkedAction = { id: string; action_no: number; kind: string; status: string };

/**
 * The actions each signal has been used by, through action_signals (AC-007):
 * its current action and the earlier ones, closed ones included, the latest
 * link first. They only add used_by_actions, so a failed read is logged and
 * leaves every signal's list empty rather than taking the signals down.
 */
async function signalActionRefs(
  brandId: string,
  signalIds: string[],
): Promise<Map<string, SignalActionRef[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < signalIds.length; i += SIGNAL_LINK_CHUNK) {
    chunks.push(signalIds.slice(i, i + SIGNAL_LINK_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((ids) =>
      supabaseAdmin
        .from('action_signals')
        .select('signal_id, actions!inner(id, action_no, kind, status)')
        .in('signal_id', ids)
        .eq('actions.brand_id', brandId)
        .is('actions.deleted_at', null)
        .order('linked_at', { ascending: false }),
    ),
  );
  const bySignal = new Map<string, SignalActionRef[]>();
  for (const { data, error } of results) {
    if (error) {
      console.error('[mcp] signal actions read failed:', error.message);
      return new Map();
    }
    // The untyped admin client models the action_signals→actions FK as an
    // array; it is a single action, so peel it off.
    const links =
      (data as unknown as Array<{
        signal_id: string;
        actions: LinkedAction[] | LinkedAction | null;
      }> | null) ?? [];
    for (const link of links) {
      const a = Array.isArray(link.actions) ? (link.actions[0] ?? null) : link.actions;
      if (!a) continue;
      bySignal.set(link.signal_id, [
        ...(bySignal.get(link.signal_id) ?? []),
        { id: a.id, action_no: Number(a.action_no), kind: a.kind, status: a.status },
      ]);
    }
  }
  return bySignal;
}

export async function listSignalsFor(
  auth: McpAuthContext,
  params: ListSignalsParams,
): Promise<Record<string, unknown>[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  let query = supabaseAdmin
    .from('signals')
    .select(MCP_SIGNAL_COLUMNS)
    .eq('brand_id', params.brandId)
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (params.status) query = query.eq('status', params.status);
  if (params.kind) query = query.eq('kind', params.kind);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SignalRow[];

  // Each signal also says where it happened, what changed with units and
  // period, what it rests on, and which actions use it (AC-001), the same
  // way the dashboard's signal drawer does. A signal is linked to an action
  // only by becoming its current one, so those without one have no links.
  const [prompts, actions] = await Promise.all([
    readPromptPlaces(supabaseAdmin, params.brandId),
    signalActionRefs(
      params.brandId,
      rows.filter((row) => row.action_id).map((row) => row.id),
    ),
  ]);
  const known = new Map(mapSignalRows(rows, prompts).map((signal) => [signal.id, signal]));

  return rows.map((row) => {
    const used = currentActionFirst(actions.get(row.id) ?? [], row.action_id);
    const signal = known.get(row.id);
    const lean = withoutTargetIds(row as unknown as Record<string, unknown>);
    // A kind this build has no detail for still comes back, as it always did.
    return signal
      ? { ...lean, ...signalDetailForApi(signal, used) }
      : { ...lean, used_by_actions: used };
  });
}

export interface ActionHistoryRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  created_at: string;
  completed_at: string | null;
  /** Before/after pairs the validation sweep measured; empty until it runs. */
  results: Array<{ metric: string; unit: string; before: number; after: number }>;
  /**
   * Whether `outcome` is the result rather than a reading so far (learning
   * B1): the day-30 reading is in, or it was measured once, before readings.
   */
  final: boolean;
  /** The day after closing its latest reading was taken on; null before one. */
  reading_day: number | null;
  /** Its change net of the brand's prompts it didn't touch (learning B2); null when not netted. */
  net_of_control: McpNetOfControl | null;
  /** Why it was dismissed, as the person said (learning A5); null otherwise. */
  dismiss_reason: ActionDismissReason | null;
}

/** An action's change net of a control basket's (learning B2). */
export interface McpNetOfControl {
  /** The control: the prompts of the same topics, or the brand's others. */
  basis: 'topics' | 'brand';
  control_prompts: number;
  /** Per metric: a rate's move in points, a count's in percent, minus the control's. */
  metrics: { metric: string; net: number; unit: 'points' | 'percent' }[];
}

/** The net result the validation sweep kept, if it could net one. */
function netOfControl(validation: unknown): McpNetOfControl | null {
  const control = controlNetOf(validation as Parameters<typeof controlNetOf>[0]);
  return control
    ? { basis: control.basis, control_prompts: control.prompts, metrics: control.net }
    : null;
}

interface ValidationMetric {
  metric: string;
  unit: string;
  before: number | null;
  after: number | null;
}

interface ValidationSnapshot {
  metrics?: ValidationMetric[];
  /** Its readings a week, two weeks and a month after it closed (learning B1). */
  readings?: { day?: unknown }[];
  final?: boolean;
}

/** A closed action as list_action_history reads it; dismiss_reason is absent without 00366. */
interface ActionHistoryDbRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  validation: unknown;
  dismiss_reason?: string | null;
  created_at: string;
  completed_at: string | null;
}

const ACTION_HISTORY_COLUMNS =
  'id, action_no, category, kind, impact, status, outcome, validation, created_at, completed_at';

export async function listActionHistoryFor(
  auth: McpAuthContext,
  params: { brandId: string; limit?: number },
): Promise<ActionHistoryRow[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const read = (columns: string) =>
    supabaseAdmin
      .from('actions')
      .select(columns)
      .eq('brand_id', params.brandId)
      .in('status', ['completed', 'dismissed'])
      .is('deleted_at', null)
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(limit);
  let { data, error } = await read(`${ACTION_HISTORY_COLUMNS}, dismiss_reason`);
  // A database without 00366 has no dismiss_reason (42703): the rest is read, no reason given.
  if (missingDismissReason(error)) ({ data, error } = await read(ACTION_HISTORY_COLUMNS));
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as ActionHistoryDbRow[]).map((r) => {
    const validation = r.validation as ValidationSnapshot | null;
    const metrics = validation?.metrics ?? [];
    const days = (Array.isArray(validation?.readings) ? validation.readings : [])
      .map((reading) => reading?.day)
      .filter((day): day is number => Number.isInteger(day));
    const outcome = r.outcome ?? null;
    return {
      id: r.id,
      action_no: Number(r.action_no),
      category: r.category,
      kind: r.kind,
      impact: r.impact,
      status: r.status,
      outcome,
      created_at: r.created_at,
      completed_at: r.completed_at ?? null,
      // A metric missing either half was not measured; dropped, as on the dashboard.
      results: metrics
        .filter((m) => m.before != null && m.after != null)
        .map((m) => ({
          metric: m.metric,
          unit: m.unit,
          before: m.before as number,
          after: m.after as number,
        })),
      // A reading so far until the day-30 one; one measured once before the
      // readings came keeps its result, as History reads it.
      final:
        validation?.final === true ||
        (days.length === 0 && outcome != null && outcome !== 'pending_measurement'),
      reading_day: days.length ? Math.max(...days) : null,
      net_of_control: netOfControl(validation),
      // Only while it is dismissed: another status leaves an earlier reason in place.
      dismiss_reason: r.status === 'dismissed' ? dismissReasonOf(r.dismiss_reason) : null,
    };
  });
}

export interface UpdatedTaskStatus {
  id: string;
  action_id: string;
  status: McpTaskStatus;
  skip_reason: string | null;
  updated_at: string;
}

/**
 * Move one task of an action — the MCP counterpart of the drawer's task menu.
 *
 * Ownership first: a task outside the caller's org returns null before any
 * write. Then the same rules and trail as the dashboard: a skip must say why,
 * the change is logged as a `task_status` event under the key's user, and the
 * action's updated stamp moves.
 */
export async function updateTaskStatusFor(
  auth: McpAuthContext,
  taskId: string,
  status: McpTaskStatus,
  skipReason?: string,
): Promise<UpdatedTaskStatus | null> {
  if (!auth.organizationId) return null;

  const reason = status === 'skipped' ? (skipReason ?? '').trim().slice(0, 200) : null;
  if (status === 'skipped' && !reason) throw new Error('A skipped task needs a skip_reason');

  const { data: owned } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, actions!inner(brand_id, brands!inner(organization_id))')
    .eq('id', taskId)
    .eq('actions.brands.organization_id', auth.organizationId)
    .is('actions.deleted_at', null)
    .maybeSingle();
  if (!owned) return null;
  const ownedAction = Array.isArray(owned.actions) ? (owned.actions[0] ?? null) : owned.actions;
  if (!(await mayUseBrand(auth, ownedAction?.brand_id))) return null;

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('action_tasks')
    .update({ status, skip_reason: reason, updated_at: updatedAt })
    .eq('id', taskId)
    .select('id, action_id, status, skip_reason, updated_at')
    .single();
  if (error) throw new Error(error.message);

  // Best-effort, as on the dashboard: a missing trail entry must not fail the
  // change it records.
  await supabaseAdmin.from('action_events').insert({
    action_id: owned.action_id,
    event: 'task_status',
    data: { taskId, to: status, ...(reason ? { reason } : {}) },
    actor_id: auth.userId,
  });
  await supabaseAdmin.from('actions').update({ updated_at: updatedAt }).eq('id', owned.action_id);

  return {
    id: data.id,
    action_id: data.action_id,
    status: data.status as McpTaskStatus,
    skip_reason: data.skip_reason ?? null,
    updated_at: data.updated_at ?? updatedAt,
  };
}

export const IMPROVE_PRESETS = ['24h', '7d', '30d', '90d', 'custom'] as const;
export const IMPROVE_SOURCE_TYPES = [
  'fanout',
  'domain',
  'answer',
  'competitor_url',
  'brand_page',
] as const;

export interface CreateImproveActionInput {
  promptId: string;
  range: {
    preset: (typeof IMPROVE_PRESETS)[number];
    from: string;
    to?: string;
    region?: string;
  };
  idempotencyKey: string;
  suggestions: Array<{
    id: string;
    platform: string;
    title: string;
    body?: string;
    sources?: Array<{ type: (typeof IMPROVE_SOURCE_TYPES)[number]; ref: string }>;
  }>;
}

export interface CreatedImproveAction {
  actionId: string;
  actionNo: number;
  created: boolean;
  taskCount: number;
}

/**
 * Create a `prompt_improve` Action Center action from Improve suggestions —
 * the MCP counterpart of the Improve tab's "Send Actions".
 *
 * Org-ownership of the prompt is verified *first* via supabaseAdmin — a
 * wrong-org or missing id returns `null` (→ 404 upstream) with no outbound
 * call. Only then do we call the internal endpoint at
 * `${API_BASE_URL}/api/internal/prompts/:id/improve/action` with
 * `Authorization: Bearer ${CRON_SECRET}` and the key's user — same pattern as
 * `generateBriefFor`. The server checks the prompt_improve plan feature for
 * that user and dedupes on the idempotency key, so a retried call returns the
 * action the first one created (`created: false`).
 */
export async function createImproveActionFor(
  auth: McpAuthContext,
  input: CreateImproveActionInput,
): Promise<CreatedImproveAction | null> {
  if (!auth.organizationId) return null;
  // Improve costs AI: an admin's or a manager's, as in the dashboard.
  requireManager(auth);

  const { data: ownership } = await supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id))')
    .eq('id', input.promptId)
    .eq('prompt_sets.brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership) return null;
  const promptSet = Array.isArray(ownership.prompt_sets)
    ? (ownership.prompt_sets[0] ?? null)
    : ownership.prompt_sets;
  if (!(await mayUseBrand(auth, promptSet?.brand_id))) return null;
  // No Improve action (an LLM call) on the demo brand, nor for a read-only workspace, whoever asks.
  // Only GetCito Cloud has demo brands: self-hosted reads nothing for it.
  if (
    await callOnDemoBrand('create_improve_action', auth.organizationId, {
      prompt_id: input.promptId,
    })
  ) {
    throw new DemoBrandError();
  }
  await assertSubscriptionActive(auth.organizationId);

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP Improve actions');
  }

  const res = await fetch(`${API_BASE_URL}/api/internal/prompts/${input.promptId}/improve/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({
      userId: auth.userId,
      preset: input.range.preset,
      from: input.range.from,
      to: input.range.to,
      region: input.range.region ?? '',
      idempotencyKey: input.idempotencyKey,
      suggestions: input.suggestions,
    }),
  });

  if (!res.ok) {
    // Surface the server's message (plan without Improve, no suggestions for
    // this range yet, invalid suggestion) so the agent can relay it.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal Improve endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as CreatedImproveAction;
  return {
    actionId: body.actionId,
    actionNo: body.actionNo,
    created: body.created,
    taskCount: body.taskCount,
  };
}

// ── Read-only competitor and report tools (#918) ────────────────────────────

export interface McpCompetitorRow {
  id: string;
  name: string;
  domain: string;
}

/**
 * List a brand's competitors only after confirming the brand belongs to the
 * authenticated organization. The joined ownership predicate on the data
 * query prevents a brand reassignment between the check and the read.
 */
export async function listCompetitorsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<McpCompetitorRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data, error } = await supabaseAdmin
    .from('competitors')
    .select('id, name, domain, brands!inner(organization_id)')
    .eq('brand_id', brandId)
    .eq('brands.organization_id', auth.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    domain: (row.domain as string | null) ?? '',
  }));
}

export interface McpReportListItem {
  id: string;
  brand_id: string;
  title: string;
  template: string;
  date_from: string;
  date_to: string;
  created_at: string;
}

/**
 * List saved immutable report snapshots for an organization-owned brand.
 * The database query repeats the ownership predicate to avoid a TOCTOU leak.
 */
export async function listReportsFor(
  auth: McpAuthContext,
  brandId: string,
  requestedLimit = 50,
): Promise<McpReportListItem[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
    : 50;
  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(
      'id, brand_id, title, template, date_from, date_to, created_at, brands!inner(organization_id)',
    )
    .eq('brand_id', brandId)
    .eq('brands.organization_id', auth.organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    brand_id: row.brand_id as string,
    title: row.title as string,
    template: row.template as string,
    date_from: row.date_from as string,
    date_to: row.date_to as string,
    created_at: row.created_at as string,
  }));
}

export interface McpReportDetail extends McpReportListItem {
  payload: unknown;
}

/**
 * Read a saved report only if its parent brand belongs to the authenticated
 * organization. The joined ownership predicate is applied in the database.
 */
export async function getReportFor(
  auth: McpAuthContext,
  reportId: string,
): Promise<McpReportDetail | null> {
  if (!auth.organizationId) return null;

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(
      'id, brand_id, title, template, date_from, date_to, created_at, payload, brands!inner(organization_id)',
    )
    .eq('id', reportId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !(await mayUseBrand(auth, data.brand_id as string))) return null;

  return {
    id: data.id as string,
    brand_id: data.brand_id as string,
    title: data.title as string,
    template: data.template as string,
    date_from: data.date_from as string,
    date_to: data.date_to as string,
    created_at: data.created_at as string,
    payload: data.payload,
  };
}
