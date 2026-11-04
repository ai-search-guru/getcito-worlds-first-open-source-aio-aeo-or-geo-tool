'use server';

import { dbClient } from '@/lib/supabase/scoped';
import { getOrgPlan } from '@/lib/guards/planGuard';
import { effectivePlanForBrand } from '@/lib/demo/demoBrand';
import type { PlanId } from '@/config/plans';
import {
  POSITION_PLATFORMS,
  brandCitationPosition,
  brandCitedPage,
  platformAccess,
  summarizePositions,
  type CitedPage,
  type PlatformPositions,
  type PositionAnswer,
  type PositionsSummary,
} from '@/lib/promptPositions';
import { isTimeZone } from '@/lib/timeZone';
import type { Sentiment } from '@/types';
import { pickImprovingAction, type ImprovingAction } from '@/lib/improveOutcome';

export interface PromptPositionsData {
  prompt: { id: string; text: string; topicName: string | null; isActive: boolean };
  planId: PlanId;
  window: { from: string; to: string };
  summary: PositionsSummary;
  platforms: PlatformPositions[];
  /** An Improve action sent for this prompt that is still tracked (PROMPT-008). */
  improving: ImprovingAction | null;
  /** The brand's page AI engines cite most for this prompt in the window: the one to optimize. */
  citedPage: CitedPage | null;
}

/** 90 days × 8 engines × a few locations, with room to spare. */
const MAX_ANSWERS = 5000;
const PAGE_SIZE = 1000;
/** Ids per `in` filter: keeps the request URL well under PostgREST's limit. */
const ID_CHUNK = 100;

const SENTIMENTS: readonly string[] = ['positive', 'neutral', 'negative'];

/**
 * One prompt's per-engine positions over the Prompts table's window and
 * location, for the Positions panel.
 *
 * Reads through the caller's RLS-scoped client, so a prompt outside the
 * caller's organisations comes back as null. Engines the brand's plan (the
 * org's, Growth's on the demo brand) doesn't include are never queried:
 * their rows carry only the upgrade state.
 * Answer text and source lists stay on the server; the panel gets the
 * folded numbers. Answers are filed under the viewer's days (`timeZone`, an
 * IANA zone from the browser; UTC when missing or unknown).
 */
export async function getPromptPositions(
  promptId: string,
  opts: { from: string; to?: string; region?: string; timeZone?: string },
): Promise<PromptPositionsData | null> {
  if (!Number.isFinite(Date.parse(opts.from))) throw new Error('Invalid date range');
  if (opts.to && !Number.isFinite(Date.parse(opts.to))) throw new Error('Invalid date range');
  const to = opts.to ?? new Date().toISOString();

  const supabase = await dbClient();

  const { data: prompt } = await supabase
    .from('prompts')
    .select('id, text, topic_id, category, is_active, prompt_set_id')
    .eq('id', promptId)
    .maybeSingle();
  if (!prompt) return null;

  const { data: promptSet } = await supabase
    .from('prompt_sets')
    .select('brand_id')
    .eq('id', prompt.prompt_set_id)
    .maybeSingle();
  const brandId = promptSet?.brand_id as string | undefined;
  if (!brandId) return null;

  const [{ data: brand }, { data: domainRows }, { data: topic }, { data: improveRows }] =
    await Promise.all([
      supabase.from('brands').select('organization_id, is_demo').eq('id', brandId).maybeSingle(),
      supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
      prompt.topic_id
        ? supabase.from('topics').select('name').eq('id', prompt.topic_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('actions')
        .select('id, action_no, status, position_outcome')
        .eq('brand_id', brandId)
        .eq('kind', 'prompt_improve')
        .eq('payload->>promptId', promptId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
  if (!brand?.organization_id) return null;

  const plan = effectivePlanForBrand(
    await getOrgPlan(brand.organization_id as string),
    brand.is_demo === true,
  );
  const platforms = POSITION_PLATFORMS.map((p) => ({ ...p, access: platformAccess(plan, p.id) }));
  const includedIds = platforms.filter((p) => p.access.state === 'included').map((p) => p.id);
  const brandDomains = (domainRows ?? []).map((r) => r.domain as string);

  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ANSWERS; offset += PAGE_SIZE) {
    let query = supabase
      .from('prompt_results')
      .select(
        'id, platform, created_at, region, mention_count, mention_position, mentioned_entity_count, sentiment, citation_count',
      )
      .eq('prompt_id', promptId)
      .eq('brand_id', brandId)
      .in('platform', includedIds)
      .gte('created_at', opts.from)
      .lte('created_at', to);
    if (opts.region) query = query.eq('region', opts.region);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  // Source lists are the heavy column and only cited answers need theirs, so
  // they are fetched for those answers alone.
  const citedIds = rows.filter((r) => Number(r.citation_count ?? 0) > 0).map((r) => r.id as string);
  const sourcesById = new Map<string, unknown>();
  const chunks = Array.from({ length: Math.ceil(citedIds.length / ID_CHUNK) }, (_, i) =>
    citedIds.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK),
  );
  await Promise.all(
    chunks.map(async (ids) => {
      const { data, error } = await supabase
        .from('prompt_results')
        .select('id, citations')
        .in('id', ids);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) sourcesById.set(r.id as string, r.citations);
    }),
  );

  const answers: PositionAnswer[] = rows.map((row) => {
    const mentioned = Number(row.mention_count ?? 0) > 0;
    const cited = Number(row.citation_count ?? 0) > 0;
    const sentiment = row.sentiment as string | null;
    return {
      platform: row.platform as string,
      createdAt: row.created_at as string,
      region: (row.region as string | null) ?? null,
      mentioned,
      mentions: Number(row.mention_count ?? 0),
      mentionPosition: (row.mention_position as number | null) ?? null,
      mentionTotal: (row.mentioned_entity_count as number | null) ?? null,
      sentiment: sentiment && SENTIMENTS.includes(sentiment) ? (sentiment as Sentiment) : null,
      cited,
      citations: Number(row.citation_count ?? 0),
      citation: cited
        ? brandCitationPosition(sourcesById.get(row.id as string), brandDomains)
        : null,
    };
  });

  const window = { from: opts.from, to };
  const { summary, platforms: rowsByPlatform } = summarizePositions(
    answers,
    platforms,
    window,
    isTimeZone(opts.timeZone) ? opts.timeZone : 'UTC',
  );

  return {
    prompt: {
      id: prompt.id as string,
      text: prompt.text as string,
      topicName: (topic?.name as string | undefined) ?? (prompt.category as string | null) ?? null,
      isActive: Boolean(prompt.is_active),
    },
    planId: plan.id,
    window,
    summary,
    platforms: rowsByPlatform,
    improving: pickImprovingAction(improveRows ?? []),
    // Newest answer first, so a tie goes to the page cited most recently.
    citedPage: brandCitedPage(
      citedIds.map((id) => sourcesById.get(id)),
      brandDomains,
    ),
  };
}
