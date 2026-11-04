'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { focusPicks } from '@/lib/chat/focus';
import type { FocusFill, RivalMove } from '@/lib/chat/focusHome';
import { parseLocation, regionLabel } from '@/lib/region';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import { pageKey } from '@/lib/content/sources';
import { menuOfProfile, readRoleHidden, type MenuProfile } from '@/lib/menuAccess';
import { OPEN_SIGNAL_STATUSES } from '@/lib/signals/registry';
import { sinceMoves, sincePeriods, type SinceYouLeft } from '@/lib/chat/since';
import { LEFT_OUT_PLATFORMS } from '@/lib/mcp/why';

/**
 * "For you now" on Chat Home (CHAT-08 v2, mockup #s-home `.scut`; CHAT-09
 * item 3): the counts its chips carry, for the active brand.
 *   - Complete tasks: the brand's open Action Center actions due by the end
 *     of this week, overdue ones included.
 *   - Win back citations: the pages the brand's open lost-citation signals
 *     name (their AC-001 evidence; one without evidence names none).
 *   - Ready to publish: the brand's drafts marked ready, not archived.
 * A job whose menu section an Admin took off the person's menu (Menu access,
 * 00374) isn't counted: its chip doesn't show. Read as the person, once,
 * then the counts together. Behind CHAT_AGENTIC; never throws (#1777):
 * counts that can't be read hide the chips.
 */

export type HomeShortcuts =
  { ok: true; dueTasks: number; lostPages: number; readyDrafts: number } | { ok: false };

/** The Action Center statuses still open. */
const OPEN_ACTIONS = ['new', 'in_progress', 'on_hold'];

/** The menu section each job belongs to: an Admin hiding it hides the job. */
const JOB_SECTIONS = {
  dueTasks: 'action-center',
  lostPages: 'citations',
  readyDrafts: 'content',
} as const;

/** Signals read a page at a time; a brand has one per prompt at most. */
const SIGNAL_PAGE = 1000;
const MAX_SIGNAL_PAGES = 20;

const input = z.object({
  // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
  brandId: z.guid(),
  /** The week's last day, YYYY-MM-DD, in the person's own time zone. */
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** A page as the lost-citation evidence keys it (server signals/lostCitationEvidence.js). */
const pageOf = (url: string) => pageKey(/^[a-z]+:\/\//i.test(url) ? url : `https://${url.trim()}`);

type Client = Awaited<ReturnType<typeof createClient>>;

/** The pages the brand's open lost-citation signals name, a page of signals at a time. */
async function countLostPages(supabase: Client, brandId: string): Promise<number> {
  const pages = new Set<string>();
  for (let page = 0; page < MAX_SIGNAL_PAGES; page++) {
    const { data, error } = await supabase
      .from('signals')
      .select('lostUrls:payload->lostUrls')
      .eq('brand_id', brandId)
      .eq('kind', 'lost_citations')
      .in('status', [...OPEN_SIGNAL_STATUSES])
      .order('id')
      .range(page * SIGNAL_PAGE, (page + 1) * SIGNAL_PAGE - 1);
    if (error) throw new Error(`signals: ${error.message}`);
    const rows = (data ?? []) as { lostUrls: unknown }[];
    for (const { lostUrls } of rows) {
      for (const lost of Array.isArray(lostUrls) ? lostUrls : []) {
        const url = (lost as { url?: unknown } | null)?.url;
        const key = typeof url === 'string' && url.trim() ? pageOf(url) : null;
        if (key) pages.add(key);
      }
    }
    if (rows.length < SIGNAL_PAGE) break;
  }
  return pages.size;
}

async function countOf(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  what: string,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return count ?? 0;
}

export async function readHomeShortcuts(brandId: string, through: string): Promise<HomeShortcuts> {
  try {
    const parsed = input.safeParse({ brandId, through });
    if (!parsed.success) return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select(
        'organization_id, role, work_areas, work_areas_asked_at, menu_shown, menu_hidden, can_manage_menus',
      )
      .eq('id', user.id)
      .maybeSingle();
    const orgId = (profile?.organization_id as string | null | undefined) ?? null;
    if (!profile || !orgId || !chatAgenticEnabled(orgId)) return { ok: false };
    const menuProfile = profile as unknown as MenuProfile;
    const roleHidden = await readRoleHidden(supabase, orgId, menuProfile.role);
    const hidden = new Set(menuOfProfile(menuProfile, roleHidden).hiddenByAdmin);
    const shown = (job: keyof typeof JOB_SECTIONS) => !hidden.has(JOB_SECTIONS[job]);

    const { brandId: brand, through: weekEnd } = parsed.data;
    const [dueTasks, lostPages, readyDrafts] = await Promise.all([
      shown('dueTasks')
        ? countOf(
            supabase
              .from('actions')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brand)
              .in('status', OPEN_ACTIONS)
              .lte('due_date', weekEnd),
            'actions',
          )
        : 0,
      shown('lostPages') ? countLostPages(supabase, brand) : 0,
      shown('readyDrafts')
        ? countOf(
            supabase
              .from('content_drafts')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brand)
              .eq('status', 'ready')
              .is('archived_at', null),
            'content_drafts',
          )
        : 0,
    ]);
    return { ok: true, dueTasks, lostPages, readyDrafts };
  } catch (error) {
    console.error('[chat-home] could not count the shortcuts:', error);
    return { ok: false };
  }
}

/**
 * Chat Home's "Since you left" (CHAT-22 §1, mockup #s-home `.since`): the
 * brand's biggest citation drop and one win by engine, from the day the
 * person last left Home (chat_user_prefs.home_seen_at, 00420) to yesterday,
 * against as many days before. The counts come from chat_why_cells (00423)
 * as the service role, once the brand is checked to be the person's
 * workspace's, as Why did it move reads them. `since` is null before the
 * first leave, within a day of it, or with no move beyond normal swing.
 * Behind CHAT_AGENTIC; never throws (#1777): a strip that can't be read
 * isn't shown.
 */

export type SinceResult = { ok: true; since: SinceYouLeft | null } | { ok: false };

interface SinceRpcCell {
  prompt_id: string;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  period: 'a' | 'b';
  runs: number;
  answers: number;
  citation_answers: number;
}

export async function readSinceYouLeft(brandId: string): Promise<SinceResult> {
  try {
    const parsed = z.guid().safeParse(brandId);
    if (!parsed.success) return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    const orgId = profile?.organization_id ?? null;
    if (!orgId || !chatAgenticEnabled(orgId)) return { ok: false };
    const [prefs, brand] = await Promise.all([
      supabase.from('chat_user_prefs').select('home_seen_at').eq('user_id', user.id).maybeSingle(),
      supabase
        .from('brands')
        .select('id')
        .eq('id', parsed.data)
        .eq('organization_id', orgId)
        .maybeSingle(),
    ]);
    const failed = prefs.error ?? brand.error;
    if (failed) {
      console.error('[chat-home] could not read Since you left:', failed.message);
      return { ok: false };
    }
    if (!brand.data) return { ok: false };
    const seenAt = prefs.data?.home_seen_at ?? null;
    const periods = seenAt ? sincePeriods(seenAt, Date.now()) : null;
    if (!seenAt || !periods) return { ok: true, since: null };
    const { data, error } = await supabaseAdmin.rpc('chat_why_cells', {
      p_brand_id: parsed.data,
      p_a_from: periods.a.from,
      p_a_to: periods.a.to,
      p_b_from: periods.b.from,
      p_b_to: periods.b.to,
      // Its day series isn't used here: the shortest, one day.
      p_series_from: periods.b.to,
    });
    if (error) {
      console.error('[chat-home] could not read Since you left:', error.message);
      return { ok: false };
    }
    const cells = ((data ?? {}) as { cells?: SinceRpcCell[] }).cells ?? [];
    const moves = sinceMoves(
      cells
        .filter((cell) => !LEFT_OUT_PLATFORMS.has(cell.platform ?? ''))
        .map((cell) => ({
          key: [cell.prompt_id, cell.platform ?? '', cell.model_used ?? '', cell.region ?? ''].join(
            '|',
          ),
          engine: cell.model_used ?? cell.platform ?? 'unknown',
          period: cell.period,
          runs: Number(cell.runs) || 0,
          answers: Number(cell.answers) || 0,
          citationAnswers: Number(cell.citation_answers) || 0,
        })),
    );
    if (!moves.drop && !moves.win) return { ok: true, since: null };
    return { ok: true, since: { from: periods.b.from, seenAt, ...moves } };
  } catch (error) {
    console.error('[chat-home] could not read Since you left:', error);
    return { ok: false };
  }
}

/**
 * The workspace's own words Chat Home's focus fills its starter questions
 * and greeting line with (CHAT-24 §4), for the active brand, read as the
 * person and only for the picked areas that use them:
 *   - the competitor mentioned in the most answers over the last 14 days,
 *     and the one whose mention rate rose most this week against the week
 *     before (Competitors' line);
 *   - the active topic with the most active prompts;
 *   - a second country, when the brand's prompts track more than one (with
 *     one, questions about markets take their general wording).
 * Behind CHAT_AGENTIC; never throws (#1777): what can't be read is unknown.
 */

export type FocusFillResult =
  { ok: true; fill: FocusFill; rivalMove: RivalMove | null } | { ok: false };

/** Areas whose questions or line name a competitor, a topic or a market. */
const RIVAL_AREAS = new Set(['comp', 'seo', 'pd']);
const TOPIC_AREAS = new Set(['content', 'pd']);
const MARKET_AREAS = new Set(['bd']);

/** Answers a week needs before a competitor's mention rate in it counts. */
const MIN_WEEK_ANSWERS = 10;

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface RivalDay {
  competitor_id: string;
  day: string;
  answer_count: number | null;
  mention_answers: number | null;
}

/** The most mentioned competitor, and the one whose mention rate rose most this week. */
async function readRivals(
  supabase: Client,
  brandId: string,
  now: number,
): Promise<{ rival: string | null; rivalMove: RivalMove | null }> {
  const since = dayOf(now - 13 * DAY_MS);
  const weekStart = dayOf(now - 6 * DAY_MS);
  const [rows, competitors] = await Promise.all([
    readAllRpcRows<RivalDay>(
      (from, to) =>
        supabase
          .from('insights_competitor_daily')
          .select('competitor_id, day, answer_count, mention_answers')
          .eq('brand_id', brandId)
          .gte('day', since)
          .order('day')
          .order('competitor_id')
          .order('platform')
          .order('model_used')
          .order('region')
          .range(from, to) as unknown as PromiseLike<{
          data: RivalDay[] | null;
          error: { message: string } | null;
        }>,
    ),
    supabase.from('competitors').select('id, name').eq('brand_id', brandId),
  ]);
  if (competitors.error) throw new Error(`competitors: ${competitors.error.message}`);
  const names = new Map((competitors.data ?? []).map((c) => [c.id, c.name]));
  type Weeks = {
    mentions: number;
    thisAnswers: number;
    thisMentions: number;
    lastAnswers: number;
    lastMentions: number;
  };
  const byRival = new Map<string, Weeks>();
  for (const row of rows) {
    if (!names.has(row.competitor_id)) continue;
    const weeks = byRival.get(row.competitor_id) ?? {
      mentions: 0,
      thisAnswers: 0,
      thisMentions: 0,
      lastAnswers: 0,
      lastMentions: 0,
    };
    const answers = Number(row.answer_count) || 0;
    const mentions = Number(row.mention_answers) || 0;
    weeks.mentions += mentions;
    if (row.day >= weekStart) {
      weeks.thisAnswers += answers;
      weeks.thisMentions += mentions;
    } else {
      weeks.lastAnswers += answers;
      weeks.lastMentions += mentions;
    }
    byRival.set(row.competitor_id, weeks);
  }
  let rival: { name: string; mentions: number } | null = null;
  let rivalMove: RivalMove | null = null;
  for (const [id, weeks] of byRival) {
    const name = names.get(id) ?? '';
    if (weeks.mentions > 0 && (!rival || weeks.mentions > rival.mentions)) {
      rival = { name, mentions: weeks.mentions };
    }
    if (weeks.thisAnswers < MIN_WEEK_ANSWERS || weeks.lastAnswers < MIN_WEEK_ANSWERS) continue;
    const points = Math.round(
      (100 * weeks.thisMentions) / weeks.thisAnswers -
        (100 * weeks.lastMentions) / weeks.lastAnswers,
    );
    if (points > 0 && (!rivalMove || points > rivalMove.points)) rivalMove = { name, points };
  }
  return { rival: rival?.name ?? null, rivalMove };
}

interface PromptPlace {
  topic_id: string | null;
  regions: string[] | null;
}

/** The active topic with the most active prompts, and a second tracked country. */
async function readTopicAndMarket(
  supabase: Client,
  brandId: string,
): Promise<{ topic: string | null; market: string | null }> {
  const [prompts, topics] = await Promise.all([
    readAllRpcRows<PromptPlace>(
      (from, to) =>
        supabase
          .from('prompts')
          .select('topic_id, regions, prompt_sets!inner(brand_id)')
          .eq('prompt_sets.brand_id', brandId)
          .eq('is_active', true)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: PromptPlace[] | null;
          error: { message: string } | null;
        }>,
    ),
    supabase.from('topics').select('id, name, is_active').eq('brand_id', brandId),
  ]);
  if (topics.error) throw new Error(`topics: ${topics.error.message}`);
  const topicNames = new Map(
    (topics.data ?? []).filter((t) => t.is_active !== false).map((t) => [t.id, t.name]),
  );
  const perTopic = new Map<string, number>();
  const perCountry = new Map<string, number>();
  for (const prompt of prompts) {
    if (prompt.topic_id && topicNames.has(prompt.topic_id)) {
      perTopic.set(prompt.topic_id, (perTopic.get(prompt.topic_id) ?? 0) + 1);
    }
    const countries = new Set(
      (prompt.regions ?? []).map((code) => parseLocation(code)?.country).filter(Boolean),
    );
    for (const country of countries) {
      perCountry.set(country as string, (perCountry.get(country as string) ?? 0) + 1);
    }
  }
  const most = (counts: Map<string, number>) =>
    [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  const topTopic = most(perTopic)[0];
  // The second most tracked country: the first is most often the home market.
  const second = most(perCountry)[1];
  return {
    topic: topTopic ? (topicNames.get(topTopic) ?? null) : null,
    market: second ? regionLabel(second) : null,
  };
}

export async function readFocusFill(brandId: string, focus: unknown): Promise<FocusFillResult> {
  try {
    const parsedBrand = z.guid().safeParse(brandId);
    const parsedFocus = focusPicks.safeParse(focus);
    if (!parsedBrand.success || !parsedFocus.success) return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    const orgId = profile?.organization_id ?? null;
    if (!orgId || !chatAgenticEnabled(orgId)) return { ok: false };
    const areas = parsedFocus.data;
    const brand = parsedBrand.data;
    const needs = (set: Set<string>) => areas.some((area) => set.has(area));
    const [rivals, places] = await Promise.all([
      needs(RIVAL_AREAS) ? readRivals(supabase, brand, Date.now()) : null,
      needs(TOPIC_AREAS) || needs(MARKET_AREAS) ? readTopicAndMarket(supabase, brand) : null,
    ]);
    return {
      ok: true,
      fill: {
        rival: rivals?.rival ?? null,
        topic: needs(TOPIC_AREAS) ? (places?.topic ?? null) : null,
        market: needs(MARKET_AREAS) ? (places?.market ?? null) : null,
      },
      rivalMove: areas.includes('comp') ? (rivals?.rivalMove ?? null) : null,
    };
  } catch (error) {
    console.error('[chat-home] could not read the focus words:', error);
    return { ok: false };
  }
}
