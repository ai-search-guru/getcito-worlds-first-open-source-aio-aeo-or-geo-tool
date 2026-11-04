import { Router } from 'express';
import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole } from '../lib/access.js';
import { resolveModel } from '../lib/aiProvider.js';
import { decide, isDeciderConfigured } from '../lib/decider.js';
import { classifyQueryIntents, normalizeIntentQuery } from '../lib/intentExtraction.js';
import { promptsFromTopicsSchema } from '../lib/brandSetupInput.js';
import { getLanguageName } from '../lib/languages.js';
import {
  PlanLimitError,
  enforceFeature,
  getImproveQuotaStatus,
  requireFeature,
  reserveAiBudget,
  reserveRelevanceAllowance,
  settleRelevanceUsage,
} from '../lib/planGuard.js';
import { withRetry } from '../lib/retry.js';
import { getGscSuggestionCandidates } from '../lib/gscSuggestions.js';
import { getGaSuggestionCandidates } from '../lib/gaSuggestions.js';
import { getCatalogSuggestionCandidates } from '../lib/catalogSuggestions.js';
import { suggestPromptsForPage } from '../lib/pagePromptSuggestions.js';
import { UNTRACKED_QUERY_SCAN, untrackedGoogleQueries } from '../lib/untrackedQueries.js';
import { RELEVANCE_SCALE, ratingCostUsd, toRelevance } from '../lib/suggestionRelevance.js';
import {
  ACTIONABLE_STATES,
  IMPROVE_PLATFORM_LABELS,
  SOURCE_TYPES,
  buildImprovePrompt,
  classifyPlatform,
  collectEvidence,
  improveRangeKey,
  improveSchema,
  sanitizeSuggestions,
  withPageChecks,
} from '../lib/promptImprove.js';
import { storedFeatures } from '../lib/action-center/competitorPages.js';
import {
  liveImproveSends,
  loadImproveRounds,
  sendImproveToActionCenter,
} from '../lib/action-center/fromPromptImprove.js';
import { brandPromptKeys, demandResponse } from '../lib/promptDemand.js';
import { yearRule } from '../lib/currentYear.js';

const router = Router();

/** The brand's fields Improve reads, with its access check (lib/access.js). */
const BRAND_COLUMNS = { columns: 'name, description, language' };

async function loadSuggestionContext(brandId) {
  const [
    { data: brand },
    { data: existingPrompts },
    { data: existingTopics },
    { data: recentResults },
  ] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('name, description, language, region')
      .eq('id', brandId)
      .single(),
    supabaseAdmin
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id), prompt_volumes(est_ai_volume, intent)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .limit(80),
    supabaseAdmin
      .from('topics')
      .select('name')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .limit(40),
    supabaseAdmin
      .from('prompt_results')
      .select('competitor_mentions')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const competitorCount = new Map();
  for (const row of recentResults || []) {
    const mentions = row.competitor_mentions;
    if (!mentions) continue;
    if (Array.isArray(mentions)) {
      for (const m of mentions) {
        const name = typeof m === 'string' ? m : m?.name;
        if (name) competitorCount.set(name, (competitorCount.get(name) || 0) + 1);
      }
    } else if (typeof mentions === 'object') {
      for (const [name, val] of Object.entries(mentions)) {
        const n = typeof val === 'number' ? val : 1;
        competitorCount.set(name, (competitorCount.get(name) || 0) + n);
      }
    }
  }
  const topCompetitors = [...competitorCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name);

  const promptVolumeSamples = [];
  let volumeSum = 0;
  let volumeCount = 0;
  let highVolumeMax = 0;
  for (const p of existingPrompts || []) {
    const pv = p.prompt_volumes;
    const vol = Array.isArray(pv) ? pv[0]?.est_ai_volume : pv?.est_ai_volume;
    const intent = Array.isArray(pv) ? pv[0]?.intent : pv?.intent;
    if (typeof vol === 'number' && vol > 0) {
      volumeSum += vol;
      volumeCount += 1;
      if (vol > highVolumeMax) highVolumeMax = vol;
      promptVolumeSamples.push({ text: p.text, volume: vol, intent });
    }
  }
  const avgVolume = volumeCount > 0 ? Math.round(volumeSum / volumeCount) : 0;
  promptVolumeSamples.sort((a, b) => b.volume - a.volume);
  const topByVolume = promptVolumeSamples.slice(0, 6);
  const bottomByVolume = promptVolumeSamples.slice(-4).reverse();

  return {
    brand: brand || {},
    existingPromptTexts: (existingPrompts || []).map((p) => p.text),
    existingTopicNames: (existingTopics || []).map((t) => t.name),
    topCompetitors,
    volume: {
      avg: avgVolume,
      max: highVolumeMax,
      coveredCount: volumeCount,
      totalPrompts: (existingPrompts || []).length,
      topByVolume,
      bottomByVolume,
    },
  };
}

/**
 * Suggestions generated per refresh. The schema floor sits well below it: a
 * model that returns a few short of the target should still produce a list,
 * not fail the whole refresh on validation.
 */
const SUGGESTIONS_PER_REFRESH = 25;
const MIN_SUGGESTIONS = 15;
// Floors for suggestions drawn from the brand's own data, when it has any —
// about two in five from Search Console and one in four from Analytics, and
// a few shopping questions from its catalog (ECOM-003).
const MIN_FROM_SEARCH_CONSOLE = 10;
const MIN_FROM_ANALYTICS = 6;
const MIN_FROM_CATALOG = 5;

const newSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z
          .string()
          .min(20)
          .max(120)
          .describe('A short, generic search query without any brand names'),
        topic: z
          .string()
          .min(3)
          .max(60)
          .describe(
            'A 2-4 word topic label that groups this prompt (e.g. "EV Range", "Reliability", "Pricing")',
          ),
        reason: z
          .string()
          .min(20)
          .max(220)
          .describe(
            'One sentence explaining why this prompt matters for the brand (gap, trend, competitor coverage)',
          ),
        // No .max() ceiling: the prompt tells the model to calibrate volumes
        // against the brand's real tracked volumes, so on high-volume brands
        // it legitimately estimates six figures — a hard schema cap then
        // rejects the WHOLE batch deterministically ("No object generated"),
        // and retrying can't help. Out-of-range protection is a clamp at the
        // insert site instead.
        estVolume: z.number().int().min(0).describe('Estimated monthly AI search volume (rough)'),
        sourceQuery: z
          .string()
          .max(200)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided Search Console queries: the EXACT original query string, verbatim. Omit for all other suggestions.',
          ),
        sourcePage: z
          .string()
          .max(500)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided Analytics pages: the EXACT landing page path, verbatim. Omit for all other suggestions.',
          ),
        sourceCategory: z
          .string()
          .max(750)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided catalog categories: the EXACT category name, verbatim. Omit for all other suggestions.',
          ),
      }),
    )
    .min(MIN_SUGGESTIONS)
    .max(SUGGESTIONS_PER_REFRESH),
});

// Relevance (VIS-011), asked for while the org's monthly allowance covers it.
// No bounds, for the same reason as estVolume: toRelevance clamps at the insert.
const ratedSuggestionSchema = z.object({
  suggestions: z
    .array(
      newSuggestionSchema.shape.suggestions.element.extend({
        relevance: z
          .number()
          .describe(
            `How closely this prompt fits what the brand offers and who it serves, 0-${RELEVANCE_SCALE}`,
          ),
      }),
    )
    .min(MIN_SUGGESTIONS)
    .max(SUGGESTIONS_PER_REFRESH),
});

const SUGGESTION_TTL_HOURS = 48;

/** Model calls one refresh may make (withRetry's attempts). */
const REFRESH_ATTEMPTS = 3;

/**
 * Reserves rating for this refresh (VIS-011): its worst case, every retry,
 * against the org's monthly allowance. Null when that doesn't fit or the
 * allowance can't be read: the refresh then leaves relevance out rather than
 * risk the budget.
 */
async function reserveRating(orgId, brandId, modelId, log) {
  try {
    const reservation = await reserveRelevanceAllowance(orgId, {
      brandId,
      modelId,
      costUsd: ratingCostUsd(modelId, {
        suggestions: SUGGESTIONS_PER_REFRESH,
        attempts: REFRESH_ATTEMPTS,
      }),
    });
    return reservation.unlimited || reservation.id ? reservation : null;
  } catch (err) {
    log.error({ err }, 'suggestion relevance allowance error');
    return null;
  }
}

/**
 * Lowers the reservation to what rating added to the attempts made, failed
 * ones included. A failure is logged, not thrown: the suggestions the user
 * asked for still go out, and the worst case stays charged.
 */
async function settleRating(log, reservation, { modelId, attempts, usage }) {
  if (!reservation.id) return;
  try {
    await settleRelevanceUsage(reservation.id, {
      attempts,
      usage,
      costUsd: ratingCostUsd(modelId, { suggestions: SUGGESTIONS_PER_REFRESH, attempts }),
    });
  } catch (err) {
    log.error({ err }, 'suggestion relevance usage settle error');
  }
}

async function generateSuggestions(brandId, { orgId, log }) {
  const ctx = await loadSuggestionContext(brandId);
  const langName = getLanguageName(ctx.brand.language);

  // Real Search Console demand (#648) — [] for brands without GSC, which
  // keeps every prompt block below byte-identical to the pre-GSC behavior.
  const gscCandidates = await getGscSuggestionCandidates(
    brandId,
    ctx.brand,
    ctx.existingPromptTexts,
  );

  // The brand's own analytics (#705) — [] without a mapped GA4 property or
  // synced traffic, which keeps every prompt block below unchanged for
  // brands that have neither.
  const gaCandidates = await getGaSuggestionCandidates(brandId, ctx.existingPromptTexts);

  // What the brand sells (ECOM-003): its catalog's categories and price bands
  // — [] without a catalog, which keeps every prompt block below unchanged.
  const catalogCandidates = await getCatalogSuggestionCandidates(brandId);

  const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
  const aiModel = resolveModel(promptModel);
  const reservation = await reserveRating(orgId, brandId, promptModel, log);
  const rate = reservation !== null;

  const system = `You are an AEO (Answer Engine Optimization) strategist. You suggest NEW search prompts a brand should track in AI engines (ChatGPT, Perplexity, Gemini, Claude).

RULES:
- Suggest ${SUGGESTIONS_PER_REFRESH} prompts that are NOT already tracked by this brand.
${yearRule()}
- Every suggestion must be distinct: no two may be rephrasings of the same question.
- Each prompt: 30-100 chars, generic, no brand names, written in ${langName}.
- Group each prompt under a short topic label (2-4 words). Reuse existing topic labels when they fit; otherwise create a clean new one.
- Pick prompts where the brand could realistically appear AND where its competitors are already getting cited.
- Volume bias: prioritize prompt ideas that resemble (in topic and intent) the HIGH-volume prompts already tracked. Avoid suggesting prompts close in topic to LOW-volume ones unless there is a strong competitor gap.
- estVolume must be a realistic monthly AI search volume; calibrate it against the volume samples shown — do not output flat round numbers like 1000 for everything.
- Reasons must be concrete: cite the gap, the trend, or the competitor activity. Avoid generic platitudes.${
    rate
      ? `
- relevance: a whole number 0-${RELEVANCE_SCALE}. ${RELEVANCE_SCALE} = the brand's core offering, 6 = adjacent but a realistic fit, below 6 = off its business. Be strict.`
      : ''
  }
- Diversity: mix comparison, how-to, best-of, recommendation, and problem-solving intents.${
    gscCandidates.length
      ? `
- REAL SEARCH DEMAND: a list of actual Google Search Console queries for this brand is provided — proven demand the brand does not track yet. Derive at least ${Math.min(MIN_FROM_SEARCH_CONSOLE, gscCandidates.length)} suggestions from those queries: rephrase each raw query as a natural question a user would ask an AI assistant, preserving its intent exactly (never invent a different topic). For each such suggestion set sourceQuery to the EXACT original query string, verbatim. Never set sourceQuery on suggestions that did not come from that list.`
      : ''
  }${
    gaCandidates.length
      ? `
- THE BRAND'S OWN ANALYTICS: a list of pages from this brand's Google Analytics is provided, each with what the page itself says it is about. Derive at least ${Math.min(MIN_FROM_ANALYTICS, gaCandidates.length)} suggestions from those pages. Write the prompt at the level of the need the page serves, NOT the page's product name or URL — a model number nobody types into an AI assistant becomes the category question that leads to it ("best noise-cancelling headphones", not "ANS-2400 Pro Black"). For each such suggestion set sourcePage to the EXACT landing page path, verbatim. Never set sourcePage on suggestions that did not come from that list, and never set both sourceQuery and sourcePage on the same suggestion.`
      : ''
  }${
    catalogCandidates.length
      ? `
- WHAT THE BRAND SELLS: a list of its product catalog's categories is provided, each with how many products it sells and their price band. Derive at least ${Math.min(MIN_FROM_CATALOG, catalogCandidates.length)} shopping suggestions from those categories: the questions a shopper asks an AI assistant before buying in the category — best-of, under a budget (use the category's price band and currency, written as a shopper writes it), for a use or a person, or which type to choose. Use the category's own words, not the brand's or a product's name. For each such suggestion set sourceCategory to the EXACT category name, verbatim. Never set sourceCategory on suggestions that did not come from that list, and never set it together with sourceQuery or sourcePage.`
      : ''
  }`;

  const v = ctx.volume;
  const volumeBlock =
    v && v.coveredCount > 0
      ? `Volume signal (from prompt_volumes for tracked prompts):
- Coverage: ${v.coveredCount}/${v.totalPrompts} tracked prompts have estimated AI volume
- Average AI volume: ~${v.avg.toLocaleString('en-US')}/mo
- Highest tracked: ~${v.max.toLocaleString('en-US')}/mo
- Top-volume tracked prompts (for topic/intent inspiration, do NOT duplicate):
${v.topByVolume.map((p) => `  • [~${p.volume.toLocaleString('en-US')}/mo${p.intent ? `, ${p.intent}` : ''}] ${p.text}`).join('\n')}
- Lowest-volume tracked prompts (avoid suggesting similar ones):
${v.bottomByVolume.map((p) => `  • [~${p.volume.toLocaleString('en-US')}/mo${p.intent ? `, ${p.intent}` : ''}] ${p.text}`).join('\n')}`
      : 'Volume signal: no AI volume data analyzed yet for tracked prompts.';

  const userPrompt = `Brand: ${ctx.brand.name}
Description: ${ctx.brand.description || '(none)'}

Existing tracked prompts (DO NOT duplicate these):
${ctx.existingPromptTexts.length ? ctx.existingPromptTexts.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(none yet)'}

Existing topics for this brand (prefer reusing):
${ctx.existingTopicNames.length ? ctx.existingTopicNames.join(', ') : '(none)'}

Top competitors currently cited in this brand's tracked AI responses:
${ctx.topCompetitors.length ? ctx.topCompetitors.join(', ') : '(no data yet)'}

${volumeBlock}${
    gscCandidates.length
      ? `

Real Google Search Console queries for this brand (last 28 days, NOT tracked yet — proven demand):
${gscCandidates
  .map(
    (c) =>
      `  • "${c.query}" — ${c.impressions.toLocaleString('en-US')} impressions, ${c.clicks.toLocaleString('en-US')} clicks${c.avgPosition != null ? `, avg position ${c.avgPosition}` : ''}`,
  )
  .join('\n')}`
      : ''
  }${
    gaCandidates.length
      ? `

Pages from this brand's own Google Analytics (last 28 days, none covered by a tracked prompt):
${gaCandidates
  .map((c) => {
    const evidence =
      c.kind === 'revenue_blind_spot'
        ? `#${c.rank} by ${c.revenue > 0 ? 'revenue' : 'conversions'} (${c.revenue > 0 ? `${c.revenue.toLocaleString('en-US')} revenue, ` : ''}${c.transactions || c.keyEvents} conversions, ${c.sessions.toLocaleString('en-US')} sessions)`
        : `${c.aiSessions.toLocaleString('en-US')} AI-referred sessions${c.aiPlatforms.length ? ` from ${c.aiPlatforms.join(', ')}` : ''}`;
    return `  • ${c.landingPage} — ${evidence}\n    the page says: ${c.pageText.slice(0, 300)}`;
  })
  .join('\n')}`
      : ''
  }

${
  catalogCandidates.length
    ? `

The brand's product catalog categories (live products, price band):
${catalogCandidates
  .map(
    (c) =>
      `  • "${c.category}" — ${c.products.toLocaleString('en-US')} products${c.currency ? `, ${c.priceLow}–${c.priceHigh} ${c.currency} (most under ${c.priceUnder} ${c.currency})` : ''}`,
  )
  .join('\n')}`
    : ''
}

Suggest the next ${SUGGESTIONS_PER_REFRESH} prompts this brand should start tracking, with topic, reason and a calibrated monthly AI search volume (estVolume).`;

  // #379 pattern — bounded retry: generateObject throws "No object generated:
  // response did not match schema" when the model misses a constraint (short
  // reason, <6 items, non-integer estVolume, …); a fresh sample usually
  // passes, so one miss must not fail the whole refresh.
  let attempts = 0;
  let usage;
  try {
    const { object, usage: callUsage } = await withRetry(
      () => {
        attempts += 1;
        return generateObject({
          model: aiModel,
          schema: rate ? ratedSuggestionSchema : newSuggestionSchema,
          system,
          prompt: userPrompt,
        });
      },
      { attempts: REFRESH_ATTEMPTS, baseDelayMs: 500, label: 'suggestion-refresh' },
    );
    usage = callUsage;
    return { suggestions: object.suggestions, gscCandidates, gaCandidates, catalogCandidates };
  } finally {
    if (rate) await settleRating(log, reservation, { modelId: promptModel, attempts, usage });
  }
}

async function findOrCreateTopic(brandId, topicName) {
  if (!topicName) return null;
  const { data: existing } = await supabaseAdmin
    .from('topics')
    .select('id')
    .eq('brand_id', brandId)
    .ilike('name', topicName)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await supabaseAdmin
    .from('topics')
    .insert({ brand_id: brandId, name: topicName, is_active: true })
    .select('id')
    .single();
  if (error) return null;
  return created?.id ?? null;
}

/**
 * Puts a refreshed batch in place of the brand's undecided suggestions
 * (status 'new'), in the batch's order. The new rows go in first and the old
 * ones are removed only then: a failed insert (a database without 00362
 * turning down source 'catalog', say) leaves the list as it was rather than
 * empty. A text the old batch already has is refreshed in its row, since a
 * brand keeps one undecided suggestion per text
 * (idx_prompt_suggestions_brand_text_active).
 */
async function replaceNewSuggestions(brandId, rows, log) {
  const { data: current, error: currentError } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('*')
    .eq('brand_id', brandId)
    .eq('status', 'new');
  if (currentError) throw currentError;
  const textKey = (text) => text.toLowerCase();
  const currentByText = new Map((current ?? []).map((row) => [textKey(row.suggested_text), row]));

  const fresh = rows.filter((row) => !currentByText.has(textKey(row.suggested_text)));
  let inserted = [];
  if (fresh.length) {
    const { data, error } = await supabaseAdmin.from('prompt_suggestions').insert(fresh).select();
    if (error) throw error;
    inserted = data ?? [];
  }
  const byText = new Map(inserted.map((row) => [textKey(row.suggested_text), row]));

  // A repeated text takes the new reason, volume and expiry; its old row
  // stays as it was if that update fails, and is left out once decided.
  const generatedAt = new Date().toISOString();
  for (const row of rows) {
    const old = currentByText.get(textKey(row.suggested_text));
    if (!old || byText.has(textKey(row.suggested_text))) continue;
    const { data, error } = await supabaseAdmin
      .from('prompt_suggestions')
      .update({ ...row, generated_at: generatedAt })
      .eq('id', old.id)
      .eq('status', 'new')
      .select()
      .maybeSingle();
    if (error) log.warn({ err: error, id: old.id }, 'prompt-suggestions refresh: kept an old row');
    const refreshed = error ? old : data;
    if (refreshed) byText.set(textKey(row.suggested_text), refreshed);
  }

  // Only then the rest of the old batch goes; one decided meanwhile stays.
  const kept = new Set([...byText.values()].map((row) => row.id));
  const stale = (current ?? []).filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (stale.length) {
    const { error } = await supabaseAdmin
      .from('prompt_suggestions')
      .delete()
      .in('id', stale)
      .eq('status', 'new');
    if (error) log.warn({ err: error }, 'prompt-suggestions refresh: old batch not removed');
  }

  return [...new Set(rows.map((row) => byText.get(textKey(row.suggested_text))).filter(Boolean))];
}

/** Generating suggestions and Improve sets costs AI: admins and managers start it (2026-10-29). */
const SUGGEST_PROMPTS_REFUSAL = 'Only admins and managers can generate prompt suggestions.';
const IMPROVE_REFUSAL = 'Only admins and managers can use Improve.';

/**
 * Prompts are grouped under topics, so suggesting prompts for a brand with no
 * topic yet is refused before anything is generated: the person adds a topic
 * first. 409 with `no_topics`, which the web reads as its own failure.
 */
const NO_TOPICS_REFUSAL = 'Add a topic first: prompts are grouped under topics.';

/** Whether the brand has an active topic, as the dashboard's topic lists read them. */
async function brandHasTopics(brandId) {
  const { data, error } = await supabaseAdmin
    .from('topics')
    .select('id')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

function refuseNoTopics(res) {
  return res.status(409).json({ error: NO_TOPICS_REFUSAL, code: 'no_topics' });
}

router.post(
  '/suggestions/:brandId/refresh',
  requireFeature('prompt_suggestions'),
  async (req, res) => {
    try {
      const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
      await assertRole(req.user.id, MANAGER_ROLES, SUGGEST_PROMPTS_REFUSAL);
      if (!(await brandHasTopics(req.params.brandId))) return refuseNoTopics(res);
      const { suggestions, gscCandidates, gaCandidates, catalogCandidates } =
        await generateSuggestions(req.params.brandId, {
          orgId: brand.organization_id,
          log: req.log,
        });

      const expiresAt = new Date(Date.now() + SUGGESTION_TTL_HOURS * 60 * 60 * 1000).toISOString();

      // Provenance: a suggestion is 'gsc' only when its sourceQuery matches a
      // provided candidate — a hallucinated sourceQuery degrades to a plain
      // 'llm' row instead of carrying fabricated metrics. Matching is
      // case/whitespace-normalized so a cosmetic LLM rewrite doesn't silently
      // drop real provenance.
      const normalizeQuery = (q) => q.trim().toLowerCase();
      const candidateByQuery = new Map(gscCandidates.map((c) => [normalizeQuery(c.query), c]));
      const candidateByPage = new Map(gaCandidates.map((c) => [normalizeQuery(c.landingPage), c]));
      const candidateByCategory = new Map(
        catalogCandidates.map((c) => [normalizeQuery(c.category), c]),
      );

      const rows = [];
      for (const s of suggestions) {
        const topicId = await findOrCreateTopic(req.params.brandId, s.topic);
        const candidate = s.sourceQuery
          ? candidateByQuery.get(normalizeQuery(s.sourceQuery))
          : undefined;
        // Search Console wins a tie: it is proven demand for a phrasing, while
        // the page is an inference about what would lead there. A suggestion
        // claiming both is claiming something the generators never offered.
        const gaCandidate =
          !candidate && s.sourcePage
            ? candidateByPage.get(normalizeQuery(s.sourcePage))
            : undefined;
        // A category only when neither Google source claims it: both are
        // measured demand, the catalog is what the brand sells.
        const catalogCandidate =
          !candidate && !gaCandidate && s.sourceCategory
            ? candidateByCategory.get(normalizeQuery(s.sourceCategory))
            : undefined;
        rows.push({
          brand_id: req.params.brandId,
          suggested_text: s.text,
          topic_name: s.topic,
          topic_id: topicId,
          reason: s.reason,
          // Sanity clamp replacing the removed schema ceiling — one absurd
          // estimate must cap out, not reject the whole generated batch.
          est_volume: Math.min(s.estVolume, 10_000_000),
          relevance: toRelevance(s.relevance),
          source: candidate ? 'gsc' : gaCandidate ? 'ga' : catalogCandidate ? 'catalog' : 'llm',
          source_data: candidate
            ? {
                query: candidate.query,
                impressions: candidate.impressions,
                clicks: candidate.clicks,
                avgPosition: candidate.avgPosition,
                badge: candidate.badge,
                competitionIndex: candidate.competitionIndex ?? null,
              }
            : gaCandidate
              ? {
                  landingPage: gaCandidate.landingPage,
                  kind: gaCandidate.kind,
                  rank: gaCandidate.rank,
                  sessions: gaCandidate.sessions,
                  keyEvents: gaCandidate.keyEvents,
                  transactions: gaCandidate.transactions,
                  revenue: gaCandidate.revenue,
                  aiSessions: gaCandidate.aiSessions,
                  aiPlatforms: gaCandidate.aiPlatforms,
                  pageTitle: gaCandidate.page?.title ?? null,
                }
              : catalogCandidate
                ? {
                    category: catalogCandidate.category,
                    products: catalogCandidate.products,
                    priceLow: catalogCandidate.priceLow,
                    priceHigh: catalogCandidate.priceHigh,
                    priceUnder: catalogCandidate.priceUnder,
                    currency: catalogCandidate.currency,
                  }
                : null,
          status: 'new',
          expires_at: expiresAt,
        });
      }

      const suggestionsNow = await replaceNewSuggestions(req.params.brandId, rows, req.log);
      return res.json({ suggestions: suggestionsNow });
    } catch (error) {
      const status = error.status || 500;
      req.log.error({ err: error }, 'prompt-suggestions refresh error');
      return res
        .status(status)
        .json({ error: error.message || 'Failed to generate suggestions', code: error.code });
    }
  },
);

const pageSuggestionsSchema = z.object({
  // A path, as the AI Traffic page's Pages section lists it.
  page: z.string().min(1).max(2048).startsWith('/'),
  // The page's range, as its loaders take it: a timestamp, or a day from a
  // custom range; absent for all time.
  from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
  to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

/**
 * POST /api/prompts/suggestions/:brandId/page
 * Body: { page, from?, to? }
 *
 * Prompts suggested for one page of the brand's site, from the AI Traffic
 * page's Pages section (AT-006 part B2). Not stored: the person picks the
 * ones to track, which then point at the page.
 */
router.post(
  '/suggestions/:brandId/page',
  requireFeature('prompt_suggestions'),
  async (req, res) => {
    try {
      const parsed = pageSuggestionsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
      }
      await assertBrandAccess(req.params.brandId, req.user.id);
      await assertRole(req.user.id, MANAGER_ROLES, SUGGEST_PROMPTS_REFUSAL);
      if (!(await brandHasTopics(req.params.brandId))) return refuseNoTopics(res);
      const context = await loadSuggestionContext(req.params.brandId);
      const result = await suggestPromptsForPage(req.params.brandId, { ...parsed.data, context });
      return res.json(result);
    } catch (error) {
      const status = error.status || 500;
      req.log.error({ err: error }, 'page prompt suggestions error');
      return res.status(status).json({
        error: error.message || 'Failed to suggest prompts for this page',
        code: error.code,
      });
    }
  },
);

router.get('/suggestions/:brandId', async (req, res) => {
  try {
    await assertBrandAccess(req.params.brandId, req.user.id);
    const { data, error } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('*')
      .eq('brand_id', req.params.brandId)
      .eq('status', 'new')
      .order('generated_at', { ascending: false });
    if (error) throw error;

    const stale = (data || []).every((r) => new Date(r.expires_at).getTime() < Date.now());
    return res.json({
      suggestions: data || [],
      stale: data?.length === 0 || stale,
    });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'prompt-suggestions list error');
    return res
      .status(status)
      .json({ error: error.message || 'Failed to load suggestions', code: error.code });
  }
});

const untrackedQueriesSchema = z.object({
  // The days the AI Traffic page reads: the range's first (absent for all
  // time) and last; the window then ends on Google's latest reported day.
  since: z.iso.date().optional(),
  until: z.iso.date(),
  limit: z.coerce.number().int().min(0).max(UNTRACKED_QUERY_SCAN).default(10),
});

/**
 * GET /api/prompts/untracked-queries/:brandId?since=&until=&limit=
 *
 * Google queries you don't track yet (AT-009): the brand's Search Console
 * queries with clicks that no active prompt covers, most clicks first, for
 * the AI Traffic page. Read on request; tracking one adds it as a prompt.
 */
router.get('/untracked-queries/:brandId', async (req, res) => {
  try {
    const parsed = untrackedQueriesSchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    await assertBrandAccess(req.params.brandId, req.user.id);
    const { since, until, limit } = parsed.data;
    const result = await untrackedGoogleQueries(req.params.brandId, {
      since: since ?? null,
      until,
      limit,
    });
    return res.json(result);
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'untracked queries error');
    return res
      .status(status)
      .json({ error: error.message || 'Failed to read Google queries', code: error.code });
  }
});

/** Who may dismiss a prompt suggestion: every role but agency partners, as the table's update rule. */
const DISMISS_SUGGESTION_ROLES = ['admin', 'manager', 'analyst'];

router.post('/suggestions/:id/dismiss', async (req, res) => {
  try {
    const { data: suggestion } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('brand_id')
      .eq('id', req.params.id)
      .single();
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await assertBrandAccess(suggestion.brand_id, req.user.id);
    await assertRole(
      req.user.id,
      DISMISS_SUGGESTION_ROLES,
      'Only admins, managers and analysts can dismiss prompt suggestions.',
    );

    const { error } = await supabaseAdmin
      .from('prompt_suggestions')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'prompt-suggestions dismiss error');
    return res
      .status(status)
      .json({ error: error.message || 'Failed to dismiss', code: error.code });
  }
});

router.post('/suggestions/:id/accept', async (req, res) => {
  try {
    const { promptId } = req.body || {};
    if (!promptId) {
      return res.status(400).json({ error: 'promptId is required' });
    }
    const { data: suggestion } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('brand_id')
      .eq('id', req.params.id)
      .single();
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await assertBrandAccess(suggestion.brand_id, req.user.id);
    // The prompt itself is added by admins and managers only (the prompts table's rule).
    await assertRole(req.user.id, MANAGER_ROLES, 'Only admins and managers can add prompts.');

    const { error } = await supabaseAdmin
      .from('prompt_suggestions')
      .update({
        status: 'added',
        added_prompt_id: promptId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'prompt-suggestions accept error');
    return res
      .status(status)
      .json({ error: error.message || 'Failed to accept', code: error.code });
  }
});

const promptSuggestionSchema = z.object({
  prompts: z
    .array(
      z.object({
        text: z
          .string()
          .describe('A short, generic search query (30-100 characters) WITHOUT any brand names'),
        category: z
          .enum([
            'industry',
            'comparison',
            'how-to',
            'use-case',
            'recommendation',
            'alternative',
            'problem-solving',
          ])
          .describe('Category of the prompt'),
      }),
    )
    .length(10),
});

function getSystemPrompt(langName) {
  return `You are an AEO (Answer Engine Optimization) expert. Given brand information, generate exactly 10 search prompts that real users would type into AI search engines (ChatGPT, Perplexity, Gemini, Claude, etc.).

CRITICAL RULES:
- Do NOT use the brand name in prompts. These must be generic, high-volume industry queries.
${yearRule()}
- Each prompt MUST be between 30 and 100 characters long. Aim for 40-80 characters.
- The goal is to measure whether the brand appears organically in AI responses when users search for general topics.
- Think about what potential customers search BEFORE they know about any specific brand.
- Focus on high search-volume queries that are relevant to what the brand does.

Generate prompts like these (generic, no brand names):
- "Best project management tools for remote teams"
- "How to automate email marketing campaigns"
- "Top CRM software for small businesses"
- "What is the best way to manage inventory for e-commerce"
- "Free alternatives to enterprise automation platforms"

Do NOT generate prompts like these (brand-specific, low value):
- "What is [BrandName]?"
- "[BrandName] pricing"
- "[BrandName] vs [Competitor]"
- "How to use [BrandName]"

Include a diverse mix of:
- Industry best-of queries ("Best [category] tools", "Top [industry] software")
- How-to queries related to the brand's domain ("How to [solve problem the brand solves]")
- Comparison/listicle queries ("Top 10 [product category]")
- Use-case queries ("Best tool for [specific use case]")
- Problem-solving queries ("How to fix/improve [pain point]")
- Recommendation queries ("What [tool type] should I use for [scenario]")
- Alternative/options queries ("Free [product category] options", "Open source [category]")

Make prompts natural, realistic, and high search-volume — things real users actually search for.
Each prompt must have a category: industry, comparison, how-to, use-case, recommendation, alternative, or problem-solving.
IMPORTANT: All prompts MUST be written in ${langName}.`;
}

/**
 * POST /api/prompts/suggest
 * Body: { brandName, industry, description?, model? }
 * Returns: { prompts: [{ text, category }] }
 */
router.post('/suggest', requireFeature('prompt_suggestions'), async (req, res) => {
  try {
    const { brandName, industry, description, model, language } = req.body;
    const langName = getLanguageName(language);

    if (!brandName) {
      return res.status(400).json({ error: 'brandName is required' });
    }
    await assertRole(req.user.id, MANAGER_ROLES, SUGGEST_PROMPTS_REFUSAL);

    const userPrompt = `Brand context (DO NOT use the brand name "${brandName}" in any prompt):
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}
Language: ${langName} — write ALL prompts in this language.

Based on this brand's industry and context, generate 10 short, generic search prompts (each 30-100 characters, aim for 40-80) that potential customers would type into AI search engines. These prompts should be queries where this brand COULD naturally appear in AI responses — but the prompts themselves must NOT contain any brand names.`;

    const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
    const aiModel = resolveModel(model || promptModel);

    // #379 — bounded retry so one transient failure or schema miss doesn't
    // drop the whole suggestion step.
    const { object } = await withRetry(
      () =>
        generateObject({
          model: aiModel,
          schema: promptSuggestionSchema,
          system: getSystemPrompt(langName),
          prompt: userPrompt,
        }),
      { attempts: 3, baseDelayMs: 500, label: 'prompt-suggest' },
    );

    return res.json({ prompts: object.prompts });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    req.log.error({ err: error }, 'prompt suggestion error');
    return res.status(500).json({
      error: 'Failed to generate prompt suggestions',
      details: error.message,
    });
  }
});

const topicPromptSchema = z.object({
  topicPrompts: z.array(
    z.object({
      topic: z.string(),
      prompts: z.array(z.string().min(30).max(100)).length(5),
    }),
  ),
});

/**
 * POST /api/prompts/from-topics
 * Body: { brandName, industry, description?, topics: string[] }
 * Returns: { topicPrompts: [{ topic, prompts: string[] }] }
 */
router.post('/from-topics', async (req, res) => {
  try {
    const parsed = promptsFromTopicsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandName, industry, description, topics, language } = parsed.data;
    const langName = getLanguageName(language);

    const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
    const aiModel = resolveModel(promptModel);

    const topicList = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');

    // #379 — this is the onboarding prompts step's generator; a single
    // transient failure here used to strand the user with an empty step.
    const { object } = await withRetry(
      () =>
        generateObject({
          model: aiModel,
          schema: topicPromptSchema,
          system: `You are an AEO (Answer Engine Optimization) expert. Generate exactly 5 search prompts per topic that real users would type into AI search engines.

RULES:
- Keep prompts SHORT and concise — between 30 and 100 characters. Aim for 40-80 characters.
- Write them like real quick searches, e.g. "best CRM software for growing small businesses" or "top email marketing tools for startups".
${yearRule()}
- Do NOT use the brand name "${brandName}" in the prompts.
- Each prompt should be relevant to the specific topic it belongs to.
- Focus on queries where the brand could organically appear in AI-generated answers.
- Make prompts diverse: include comparisons, how-tos, best-of lists, recommendations, alternatives.
IMPORTANT: All prompts MUST be written in ${langName}.`,
          prompt: `Brand: ${brandName}
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}
Language: ${langName} — write ALL prompts in this language.

Generate 5 search prompts for each of these topics:
${topicList}

Return the exact topic names as provided above.`,
        }),
      { attempts: 3, baseDelayMs: 500, label: 'prompts-from-topics' },
    );

    return res.json({ topicPrompts: object.topicPrompts });
  } catch (error) {
    req.log.error({ err: error }, 'topic prompt generation error');
    return res.status(500).json({
      error: 'Failed to generate prompts from topics',
      details: error.message,
    });
  }
});

// POST /api/prompts/fanout-intents — classify the search intent of observed
// query fan-out sub-queries (#333). Intent is brand-independent, so it's cached
// globally per normalized query string in `fanout_query_intents`; only
// cache-misses hit the LLM. Body: { queries: string[] }.
const FANOUT_INTENT_MAX_QUERIES = 200;
// Cache-lookup batch size — keeps each `.in('query', ...)` URL well under
// PostgREST / proxy length limits even with long sub-queries.
const FANOUT_INTENT_LOOKUP_CHUNK = 40;

router.post('/fanout-intents', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.queries) ? req.body.queries : [];
    // Normalize + dedup; cap the batch so a crafted call can't fan out into
    // hundreds of LLM calls.
    const queries = [...new Set(raw.map(normalizeIntentQuery).filter(Boolean))].slice(
      0,
      FANOUT_INTENT_MAX_QUERIES,
    );
    if (queries.length === 0) return res.json({ intents: {} });

    // 1. Read the cache in bounded chunks — a single `.in('query', ...)` over
    // up to 200 text values can blow past PostgREST's URL length limit. A read
    // error must surface (500), not silently fall through to classifying every
    // query via the LLM.
    const intents = {};
    for (let i = 0; i < queries.length; i += FANOUT_INTENT_LOOKUP_CHUNK) {
      const chunk = queries.slice(i, i + FANOUT_INTENT_LOOKUP_CHUNK);
      const { data: cached, error: cacheErr } = await supabaseAdmin
        .from('fanout_query_intents')
        .select('query, intent')
        .in('query', chunk);
      if (cacheErr) throw cacheErr;
      for (const row of cached ?? []) intents[row.query] = row.intent;
    }

    // 2. Classify the misses (a decision model in batches, or the chat model
    // a query at a time; #988), then persist them.
    const misses = queries.filter((q) => !(q in intents));
    const classified = await classifyQueryIntents(misses, {
      chatModel: () => resolveModel(),
      decideFn: decide,
      deciderConfigured: isDeciderConfigured,
    });
    const fresh = Object.entries(classified).map(([query, intent]) => ({ query, intent }));
    if (fresh.length > 0) {
      Object.assign(intents, classified);
      await supabaseAdmin
        .from('fanout_query_intents')
        .upsert(fresh, { onConflict: 'query', ignoreDuplicates: true });
    }

    return res.json({ intents });
  } catch (error) {
    req.log.error({ err: error }, 'fanout intents classification error');
    return res.status(500).json({ error: error.message });
  }
});

// ─── Positions panel → Improve tab (PROMPT-003) ───────────────────────────────

const IMPROVE_PLATFORM_ORDER = Object.keys(IMPROVE_PLATFORM_LABELS);
const IMPROVE_PRESETS = ['24h', '7d', '30d', '90d', 'custom'];

/**
 * The panel's range as the request states it. `from` / `to` are the resolved
 * ISO bounds the web read the Positions numbers over; the key is what the set
 * is cached under.
 */
function parseImproveRange(input) {
  const preset = IMPROVE_PRESETS.includes(input?.preset) ? input.preset : null;
  const from =
    typeof input?.from === 'string' && !Number.isNaN(Date.parse(input.from)) ? input.from : null;
  const to = typeof input?.to === 'string' && !Number.isNaN(Date.parse(input.to)) ? input.to : null;
  if (!preset || !from) {
    const err = new Error('A valid range (preset and from) is required');
    err.status = 400;
    throw err;
  }
  const region = typeof input?.region === 'string' ? input.region.trim() : '';
  const key = improveRangeKey({
    preset,
    from: input.customFrom ?? from.slice(0, 10),
    to: input.customTo ?? to?.slice(0, 10),
  });
  return { preset, from, to, region, key };
}

async function loadImprovePrompt(promptId, userId) {
  const { data: prompt } = await supabaseAdmin
    .from('prompts')
    .select('id, text, platforms, prompt_sets!inner(brand_id)')
    .eq('id', promptId)
    .maybeSingle();
  if (!prompt) {
    const err = new Error('Prompt not found');
    err.status = 404;
    throw err;
  }
  const brandId = prompt.prompt_sets.brand_id;
  const { brand } = await assertBrandAccess(brandId, userId, BRAND_COLUMNS);
  return { prompt, brand, brandId };
}

// States read every answer in the window, as the Positions tab does; the
// heavy evidence columns come from the newest IMPROVE_EVIDENCE_ROWS only.
const IMPROVE_MAX_ROWS = 5000;
const IMPROVE_PAGE_SIZE = 1000;
const IMPROVE_EVIDENCE_ROWS = 600;
const IMPROVE_ID_CHUNK = 100;

/**
 * The light columns of every answer in the window, newest first, plus the
 * source lists of the cited ones: what classifyPlatform needs.
 */
async function loadImproveStateRows({ promptId, brandId, range }) {
  const rows = [];
  for (let offset = 0; offset < IMPROVE_MAX_ROWS; offset += IMPROVE_PAGE_SIZE) {
    const { data, error } = await improveResultsQuery(
      'id, platform, created_at, mention_count, mention_position, mentioned_entity_count, citation_count',
      { promptId, brandId, range },
    ).range(offset, offset + IMPROVE_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < IMPROVE_PAGE_SIZE) break;
  }
  const citedIds = rows.filter((r) => Number(r.citation_count ?? 0) > 0).map((r) => r.id);
  const citationsById = new Map();
  for (let i = 0; i < citedIds.length; i += IMPROVE_ID_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, citations')
      .in('id', citedIds.slice(i, i + IMPROVE_ID_CHUNK));
    if (error) throw error;
    for (const r of data ?? []) citationsById.set(r.id, r.citations);
  }
  return rows.map((r) => ({ ...r, citations: citationsById.get(r.id) ?? [] }));
}

function improveResultsQuery(columns, { promptId, brandId, range }) {
  let q = supabaseAdmin
    .from('prompt_results')
    .select(columns)
    .eq('prompt_id', promptId)
    .eq('brand_id', brandId)
    .gte('created_at', range.from);
  if (range.to) q = q.lte('created_at', range.to);
  if (range.region) q = q.eq('region', range.region);
  return q.order('created_at', { ascending: false });
}

function improveResponse(row, newestAt, sent = { latest: null, sentSuggestionIds: [] }) {
  if (!row) return null;
  return {
    sent,
    rangeKey: row.range_key,
    region: row.region,
    platforms: row.platform_states,
    suggestions: row.suggestions,
    latestResultAt: row.latest_result_at,
    generatedAt: row.generated_at,
    // Newer answers than the set was built from: the panel rebuilds it.
    stale: !!newestAt && (!row.latest_result_at || newestAt > row.latest_result_at),
  };
}

// What the panel shows: an estimate of generations left, never dollars.
function publicQuota(q) {
  if (q.unlimited) {
    return { unlimited: true, exhausted: false, generationsLeft: null, percentLeft: null };
  }
  return {
    unlimited: false,
    exhausted: q.remainingUsd <= 0,
    generationsLeft: q.generationsLeft,
    percentLeft: q.percentLeft,
    // The free trial's: more comes with starting the plan, not a bigger one.
    trial: q.trial === true,
    // No plan (read-only, 2026-10-27): nothing left until one is chosen.
    ...(q.noPlan ? { noPlan: true } : {}),
  };
}

function improveModelId() {
  return (
    process.env.IMPROVE_SUGGESTION_MODEL ||
    process.env.DEFAULT_SUGGESTION_MODEL ||
    'google/gemini-3-flash-preview'
  );
}

// Read the cached set; never generates. A workspace whose plan ended still
// reads it (readOnly).
const readImprove = requireFeature('prompt_improve', { readOnly: true });
router.get('/:promptId/improve', readImprove, async (req, res) => {
  try {
    const range = parseImproveRange(req.query);
    const { brand, brandId } = await loadImprovePrompt(req.params.promptId, req.user.id);
    const [{ data: cached }, { data: newest }, quota] = await Promise.all([
      supabaseAdmin
        .from('prompt_improve_suggestions')
        .select('*')
        .eq('prompt_id', req.params.promptId)
        .eq('range_key', range.key)
        .eq('region', range.region)
        .maybeSingle(),
      improveResultsQuery('created_at', { promptId: req.params.promptId, brandId, range }).limit(1),
      // Read-only once the plan has ended (2026-10-27): the kept set still
      // comes back, with a budget of 0.
      getImproveQuotaStatus(brand.organization_id, improveModelId(), { readOnly: true }),
    ]);
    return res.json({
      improve: improveResponse(
        cached,
        newest?.[0]?.created_at ?? null,
        cached ? await liveImproveSends(cached) : undefined,
      ),
      quota: publicQuota(quota),
    });
  } catch (error) {
    req.log.error({ err: error }, 'prompt improve read error');
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Failed to load suggestions', code: error.code });
  }
});

// The prompt's real demand (PROMPT-014): the signals the nightly sweep read
// and their level, for the Demand card, each People Also Ask question with
// whether the brand already tracks it. A read: a workspace whose plan has
// ended still sees what was read.
router.get('/:promptId/demand', async (req, res) => {
  try {
    const promptId = req.params.promptId;
    const { brandId } = await loadImprovePrompt(promptId, req.user.id);
    const [demand, volume] = await Promise.all([
      supabaseAdmin.from('prompt_demand').select('*').eq('prompt_id', promptId).maybeSingle(),
      supabaseAdmin
        .from('prompt_volumes')
        .select('google_volumes, location_code, language_code, fetched_at')
        .eq('prompt_id', promptId)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (demand.error) throw demand.error;
    if (volume.error) throw volume.error;
    const trackedKeys = demand.data?.paa?.questions?.length
      ? await brandPromptKeys(brandId)
      : undefined;
    return res.json({ demand: demandResponse(demand.data, volume.data, { trackedKeys }) });
  } catch (error) {
    req.log.error({ err: error }, 'prompt demand read error');
    return res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Failed to load demand', code: error.code });
  }
});

// Build (or rebuild) the set for the range and cache it.
router.post('/:promptId/improve', requireFeature('prompt_improve'), async (req, res) => {
  try {
    const range = parseImproveRange(req.body);
    const promptId = req.params.promptId;
    const { prompt, brand, brandId } = await loadImprovePrompt(promptId, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, IMPROVE_REFUSAL);

    const [
      rows,
      { data: evidenceRows, error: evidenceError },
      { data: domainRows },
      { data: competitors },
    ] = await Promise.all([
      loadImproveStateRows({ promptId, brandId, range }),
      improveResultsQuery(
        'id, platform, created_at, citations, search_queries, competitor_mentions',
        { promptId, brandId, range },
      ).limit(IMPROVE_EVIDENCE_ROWS),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
      supabaseAdmin.from('competitors').select('name, domain').eq('brand_id', brandId),
    ]);
    if (evidenceError) throw evidenceError;
    const brandDomains = (domainRows ?? []).map((r) => r.domain);

    const groupByPlatform = (list) => {
      const map = new Map();
      for (const r of list ?? []) {
        if (!map.has(r.platform)) map.set(r.platform, []);
        map.get(r.platform).push(r);
      }
      return map;
    };
    const byPlatform = groupByPlatform(rows);
    const evidenceByPlatform = groupByPlatform(evidenceRows);
    const platformIds = IMPROVE_PLATFORM_ORDER.filter(
      (id) => byPlatform.has(id) || (prompt.platforms ?? []).includes(id),
    );

    const states = platformIds.map((id) => ({
      id,
      label: IMPROVE_PLATFORM_LABELS[id],
      ...classifyPlatform(byPlatform.get(id) ?? [], brandDomains),
    }));
    const actionable = states.filter((p) => ACTIONABLE_STATES.includes(p.state));

    // The newest answer's text, per actionable platform, for the excerpt.
    const latestIds = actionable.map((p) => byPlatform.get(p.id)[0].id);
    const { data: responses } = latestIds.length
      ? await supabaseAdmin.from('prompt_results').select('id, response').in('id', latestIds)
      : { data: [] };
    const responseById = new Map((responses ?? []).map((r) => [r.id, r.response]));

    const collected = actionable.map((p) => ({
      ...p,
      evidence: collectEvidence(evidenceByPlatform.get(p.id) ?? [], {
        brandName: brand.name,
        brandDomains,
        competitors: competitors ?? [],
        latestResponse: responseById.get(byPlatform.get(p.id)[0].id),
      }),
    }));
    // What Site Audit's checks found on the cited pages, where Analyze
    // competitor content read them lately (learning C2). None read: as before.
    // A read that fails goes without them, said in the log.
    const stored = await storedFeatures(
      brandId,
      collected.flatMap((p) => [
        ...p.evidence.competitorUrls.map((u) => u.url),
        ...p.evidence.brandPages.map((u) => u.url),
      ]),
    ).catch((err) => {
      req.log.warn({ err, promptId }, 'prompt improve page checks read failed');
      return new Map();
    });
    const withEvidence = collected.map((p) => ({
      ...p,
      evidence: withPageChecks(p.evidence, stored),
    }));

    const modelId = improveModelId();
    let suggestions = [];
    // Only a model call is metered; a range with nothing to improve is free.
    if (withEvidence.length > 0) {
      // Held on the budget before the call, so calls at once can't pass it.
      const budget = await reserveAiBudget(brand.organization_id, {
        feature: 'improve',
        modelId,
        promptId,
      });
      try {
        // The brand's earlier Improve rounds on this prompt (learning B5).
        // Without them the suggestions are still written, as before.
        let history = [];
        try {
          history = await loadImproveRounds({ promptId, brandId, region: range.region });
        } catch (err) {
          req.log.warn({ err, promptId }, 'prompt improve earlier rounds unavailable');
        }
        const { system, prompt: userPrompt } = buildImprovePrompt({
          promptText: prompt.text,
          brand: { name: brand.name, description: brand.description, domains: brandDomains },
          platforms: withEvidence,
          history,
        });
        // Every attempt is charged at its real token cost, so the budget holds
        // for any model, including attempts withRetry repeats after a schema miss.
        const { object } = await withRetry(
          async () => {
            try {
              const result = await generateObject({
                model: resolveModel(modelId),
                schema: improveSchema,
                system,
                prompt: userPrompt,
              });
              await budget.charge(result.usage);
              return result;
            } catch (err) {
              if (NoObjectGeneratedError.isInstance(err) && err.usage) {
                await budget.charge(err.usage);
              }
              throw err;
            }
          },
          { attempts: 3, baseDelayMs: 500, label: 'prompt-improve' },
        );
        suggestions = sanitizeSuggestions(object.suggestions, withEvidence);
      } finally {
        await budget.release();
      }
    }

    // What each platform's group header shows: why it's there and which
    // inputs the suggestions could draw on.
    const evidenceById = new Map(withEvidence.map((p) => [p.id, p.evidence]));
    const platformStates = states.map((p) => {
      const ev = evidenceById.get(p.id);
      return {
        ...p,
        inputs: ev
          ? {
              fanouts: ev.fanouts.length,
              citedDomains: ev.citedDomains.length,
              competitorUrls: ev.competitorUrls.length,
              answer: !!ev.excerpt,
            }
          : null,
      };
    });

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('prompt_improve_suggestions')
      .upsert(
        {
          prompt_id: promptId,
          brand_id: brandId,
          range_key: range.key,
          region: range.region,
          platform_states: platformStates,
          suggestions,
          latest_result_at: rows?.[0]?.created_at ?? null,
          model: withEvidence.length > 0 ? modelId : null,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'prompt_id,range_key,region' },
      )
      .select('*')
      .single();
    if (saveError) throw saveError;

    const quota = await getImproveQuotaStatus(brand.organization_id, modelId);
    return res.json({
      improve: improveResponse(saved, rows?.[0]?.created_at ?? null),
      quota: publicQuota(quota),
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        error: error.statusCode === 429 ? 'quota_exceeded' : 'plan_limit',
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'prompt improve generate error');
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Failed to generate suggestions', code: error.code });
  }
});

// Send the selected suggestions, as edited, to Action Center (PROMPT-004).
const sendImproveSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  suggestions: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        platform: z.enum(Object.keys(IMPROVE_PLATFORM_LABELS)),
        title: z.string().trim().min(1).max(200),
        body: z.string().max(1000).optional().default(''),
        sources: z
          .array(z.object({ type: z.enum(SOURCE_TYPES), ref: z.string().min(1).max(300) }))
          .max(6)
          .optional()
          .default([]),
      }),
    )
    .min(1)
    .max(50),
});

function positionsPanelLink(promptId, range) {
  const params = new URLSearchParams({
    tab: 'all',
    positions: promptId,
    positionsRange: range.preset,
  });
  if (range.preset === 'custom') {
    const [, from, to] = range.key.split(':');
    if (from) params.set('positionsFrom', from);
    if (to) params.set('positionsTo', to);
  }
  return `/dashboard/prompts?${params.toString()}`;
}

/**
 * Sends the selected suggestions for `userId`, who must already have passed the
 * prompt_improve plan check. Shared by the dashboard route below and the
 * internal endpoint the web MCP layer calls (`create_improve_action`), so both
 * create the action, record the send and dedupe on the idempotency key alike.
 * Errors carry a `status` (400 bad input, 403/404 access, 404 no set yet).
 */
export async function sendImproveAction({ promptId, userId, body }) {
  const range = parseImproveRange(body);
  const parsed = sendImproveSchema.safeParse(body);
  if (!parsed.success) {
    const err = new Error('Invalid suggestions');
    err.status = 400;
    err.details = parsed.error.issues;
    throw err;
  }
  const { prompt, brandId } = await loadImprovePrompt(promptId, userId);
  // The dashboard's Send Actions and an API key's create_improve_action alike.
  await assertRole(userId, MANAGER_ROLES, IMPROVE_REFUSAL);

  const { data: set } = await supabaseAdmin
    .from('prompt_improve_suggestions')
    .select('*')
    .eq('prompt_id', promptId)
    .eq('range_key', range.key)
    .eq('region', range.region)
    .maybeSingle();
  if (!set) {
    const err = new Error('Generate suggestions for this range first');
    err.status = 404;
    throw err;
  }

  const { suggestions, idempotencyKey } = parsed.data;
  const result = await sendImproveToActionCenter({
    prompt,
    brandId,
    set,
    suggestions,
    idempotencyKey,
    panelLink: positionsPanelLink(promptId, range),
    userId,
  });

  // Record the send on the set, once, so the panel can show it after a reload.
  const sends = set.sent_actions ?? [];
  let updated = set;
  if (!sends.some((s) => s.actionId === result.actionId)) {
    const { data, error } = await supabaseAdmin
      .from('prompt_improve_suggestions')
      .update({
        sent_actions: [
          ...sends,
          {
            actionId: result.actionId,
            actionNo: result.actionNo,
            sentAt: new Date().toISOString(),
            setGeneratedAt: set.generated_at,
            suggestionIds: suggestions.map((s) => s.id),
          },
        ],
      })
      .eq('id', set.id)
      .select('*')
      .single();
    if (error) throw error;
    updated = data;
  }

  return {
    actionId: result.actionId,
    actionNo: result.actionNo,
    created: result.created,
    taskCount: suggestions.length,
    sent: await liveImproveSends(updated),
  };
}

/**
 * The same send for an MCP API key (`create_improve_action`): the key carries
 * no session, so the prompt_improve plan check that `requireFeature` runs for
 * the dashboard route happens here, against the key's user.
 */
export async function sendImproveActionForKeyUser({ promptId, userId, body }) {
  await enforceFeature(userId, 'prompt_improve');
  return sendImproveAction({ promptId, userId, body });
}

router.post('/:promptId/improve/action', requireFeature('prompt_improve'), async (req, res) => {
  try {
    return res.json(
      await sendImproveAction({
        promptId: req.params.promptId,
        userId: req.user.id,
        body: req.body,
      }),
    );
  } catch (error) {
    if (error.details) {
      return res.status(400).json({ error: error.message, details: error.details });
    }
    req.log.error({ err: error }, 'prompt improve send error');
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Failed to send to Action Center', code: error.code });
  }
});

export default router;
