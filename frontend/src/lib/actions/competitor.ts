'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Competitor } from '@/types';
import { assertWritable } from '@/lib/subscriptionGuard';
import { isManager } from '@/lib/sessionRole';
import { z } from 'zod';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import {
  parseTimelineEvents,
  timelineSince,
  weeklyMentions,
  type CompetitorTimeline,
} from '@/lib/competitorTimeline';

/** A competitor's page events the timeline reads at most. */
const TIMELINE_EVENTS = 50;

function mapRow(row: Record<string, unknown>): Competitor {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    name: row.name as string,
    domain: (row.domain as string) ?? '',
  };
}

export async function getCompetitors(brandId: string): Promise<Competitor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function addCompetitor(
  brandId: string,
  input: { name: string; domain: string },
): Promise<Competitor> {
  await assertWritable({ onboarding: true, brandId });
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .insert({
      brand_id: brandId,
      name: input.name.trim(),
      domain: input.domain
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, ''),
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to add competitor');

  revalidatePath('/dashboard/brands');
  return mapRow(data as Record<string, unknown>);
}

/** A competitor's domain as two are compared: scheme, www, case and trailing slash aside. */
const domainKey = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

export type AddCompetitorsResult =
  | {
      ok: true;
      /** partial: some weren't added (CHAT-20 §11a), each with why. */
      code: 'ok' | 'partial';
      added: Competitor[];
      skipped: { name: string; domain: string; reason: 'duplicate' | 'failed' }[];
    }
  | { ok: false; reason: 'forbidden_role' | 'duplicate' | 'failed'; message: string };

/**
 * Add competitors to a brand: Chat's add_competitors (CHAT-20 §9 row 30).
 * Admins and Managers, checked here (as the table's policy does). A domain
 * (or, without one, a name) the brand already has is skipped (the natural
 * key, §11c); each of the rest through addCompetitor, as the Competitors page
 * adds one. Errors come back as values (#427).
 */
export async function addCompetitors(
  brandId: string,
  items: { name: string; domain: string }[],
): Promise<AddCompetitorsResult> {
  try {
    await assertWritable({ brandId });
    return await addSomeCompetitors(brandId, items);
  } catch (err) {
    console.error('Failed to add competitors from Chat:', err);
    return {
      ok: false,
      reason: 'failed',
      message: 'The competitors couldn’t be added. Try again.',
    };
  }
}

async function addSomeCompetitors(
  brandId: string,
  items: { name: string; domain: string }[],
): Promise<AddCompetitorsResult> {
  if (!(await isManager(await createClient()))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can add competitors.',
    };
  }
  let existing: Competitor[];
  try {
    existing = await getCompetitors(brandId);
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const keyOf = (c: { name: string; domain: string }) =>
    c.domain.trim() ? `d:${domainKey(c.domain)}` : `n:${c.name.trim().toLowerCase()}`;
  const known = new Set(existing.map(keyOf));
  const added: Competitor[] = [];
  const skipped: Extract<AddCompetitorsResult, { ok: true }>['skipped'] = [];
  for (const item of items) {
    if (known.has(keyOf(item))) {
      skipped.push({ ...item, reason: 'duplicate' });
      continue;
    }
    known.add(keyOf(item));
    try {
      added.push(await addCompetitor(brandId, item));
    } catch {
      skipped.push({ ...item, reason: 'failed' });
    }
  }
  if (added.length === 0) {
    return skipped.every((s) => s.reason === 'duplicate')
      ? { ok: false, reason: 'duplicate', message: 'The brand already has these competitors.' }
      : { ok: false, reason: 'failed', message: "The competitors couldn't be added." };
  }
  return { ok: true, code: skipped.length > 0 ? 'partial' : 'ok', added, skipped };
}

export type RemoveBrandCompetitorResult =
  | { ok: true; removed: Competitor }
  | { ok: false; reason: 'forbidden_role' | 'not_found' | 'failed'; message: string };

/**
 * Remove one of a brand's competitors: Chat's remove_competitor (CHAT-20 §9
 * row 32). Admins and Managers, checked here. Only the brand's own, then
 * through deleteCompetitor, as the Competitors page removes one: its page
 * events and timeline scans go with it, and its actions' links are marked
 * deleted (00244). Errors come back as values (#427).
 */
export async function removeBrandCompetitor(
  brandId: string,
  competitorId: string,
): Promise<RemoveBrandCompetitorResult> {
  try {
    await assertWritable({ brandId });
    return await removeOneCompetitor(brandId, competitorId);
  } catch (err) {
    console.error('Failed to remove a competitor from Chat:', err);
    return {
      ok: false,
      reason: 'failed',
      message: 'The competitor couldn’t be removed. Try again.',
    };
  }
}

async function removeOneCompetitor(
  brandId: string,
  competitorId: string,
): Promise<RemoveBrandCompetitorResult> {
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can remove competitors.',
    };
  }
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('id', competitorId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', message: error.message };
  if (!data) {
    return {
      ok: false,
      reason: 'not_found',
      message: "That competitor isn't one of this brand's.",
    };
  }
  try {
    await deleteCompetitor(competitorId);
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, removed: mapRow(data as Record<string, unknown>) };
}

export async function deleteCompetitor(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  // A delete the row rules don't allow removes nothing rather than failing:
  // say so instead of reporting it removed.
  const { data, error } = await supabase.from('competitors').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("The competitor couldn't be removed.");

  revalidatePath('/dashboard/brands');
}

/**
 * A competitor's pages over time (learning C3) for the Competitors page: the
 * brand's and the competitor's mentioning answers per week over the chart's
 * weeks (the daily rollups, every row read), and the competitor's page
 * events, newest first. RLS keeps both to the caller's organization.
 */
export async function getCompetitorTimeline(
  brandId: string,
  competitorId: string,
): Promise<CompetitorTimeline> {
  if (!z.guid().safeParse(brandId).success || !z.guid().safeParse(competitorId).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const now = new Date();
  const since = timelineSince(now);
  type DayRow = { day: string; mention_answers: number | null };
  const daily = (table: 'insights_brand_daily' | 'insights_competitor_daily') =>
    readAllRpcRows<DayRow>((from, to) => {
      let query = supabase
        .from(table)
        .select('day, mention_answers')
        .eq('brand_id', brandId)
        .gte('day', since);
      if (table === 'insights_competitor_daily') query = query.eq('competitor_id', competitorId);
      return query
        .order('day')
        .order('platform')
        .order('model_used')
        .order('region')
        .range(from, to) as unknown as PromiseLike<{
        data: DayRow[] | null;
        error: { message: string } | null;
      }>;
    });
  const [brandRows, competitorRows, events] = await Promise.all([
    daily('insights_brand_daily'),
    daily('insights_competitor_daily'),
    supabase
      .from('competitor_page_events')
      .select('kind, at, url, domain, detail')
      .eq('brand_id', brandId)
      .eq('competitor_id', competitorId)
      .order('at', { ascending: false })
      .limit(TIMELINE_EVENTS),
  ]);
  if (events.error) throw new Error(events.error.message);
  return {
    weeks: weeklyMentions(brandRows, competitorRows, now),
    events: parseTimelineEvents(events.data ?? []),
  };
}
