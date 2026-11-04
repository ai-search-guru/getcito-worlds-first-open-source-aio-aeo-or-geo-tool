'use server';

import { createClient } from '@/lib/supabase/server';
import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import { API_BASE_URL } from '@/config/api';
import type { Topic } from '@/types';
import { DAY_MS, topicTrendDays, type TopicsWindow } from '@/lib/topicTrend';
import { assertWritable } from '@/lib/subscriptionGuard';
import { MANAGER_ROLES } from '@/lib/mcp/roleGate';
import { isManager } from '@/lib/sessionRole';
import { TOPIC_NAME_CHARS, topicNameFits } from '@/lib/topicNames';

export type { TopicsWindow } from '@/lib/topicTrend';

function mapTopicRow(row: Record<string, unknown>): Topic {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    name: row.name as string,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
  };
}

/** Refuses a topic name past TOPIC_NAME_CHARS, before anything is written. */
function assertTopicNames(names: string[]) {
  if (!names.every(topicNameFits)) {
    throw new Error(`Topic names are ${TOPIC_NAME_CHARS} characters at most.`);
  }
}

export async function createTopics(brandId: string, names: string[]): Promise<Topic[]> {
  await assertWritable({ onboarding: true, brandId });
  assertTopicNames(names);
  const supabase = await createClient();

  // Remove existing topics for this brand to avoid duplicates
  // (e.g. user navigated back and re-submitted)
  await supabase.from('topics').delete().eq('brand_id', brandId);

  const rows = names.map((name) => ({
    brand_id: brandId,
    name: name.trim(),
  }));

  const { data, error } = await supabase.from('topics').insert(rows).select();

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapTopicRow(r as Record<string, unknown>));
}

export async function getTopics(brandId: string): Promise<Topic[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapTopicRow(r as Record<string, unknown>));
}

/**
 * Fetch a single active topic by id, scoped to the brand. Returns null when the
 * topic doesn't exist, isn't this brand's, or is inactive — the detail page
 * renders "not found". The `is_active = true` filter mirrors getTopics(), which
 * the page used before (via .find() over the active list), so inactive topics
 * stay hidden. Cheaper than fetching the whole list just to read one name.
 */
export async function getTopicById(brandId: string, topicId: string): Promise<Topic | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .select('id, brand_id, name, is_active, created_at')
    .eq('brand_id', brandId)
    .eq('id', topicId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapTopicRow(data as Record<string, unknown>) : null;
}

export async function createTopic(brandId: string, name: string): Promise<Topic> {
  await assertWritable({ brandId });
  assertTopicNames([name]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .insert({ brand_id: brandId, name: name.trim() })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapTopicRow(data as Record<string, unknown>);
}

export type BrandTopicResult =
  | { ok: true; topic: Topic }
  | {
      ok: false;
      reason: 'forbidden_role' | 'not_found' | 'duplicate' | 'invalid' | 'failed';
      message: string;
    };

/** A topic name as two are compared: case and spacing aside (the natural key, CHAT-20 §11c). */
const topicKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** A name a topic may take: 1 to TOPIC_NAME_CHARS characters, trimmed; else the refusal. */
function topicNameOf(name: string): { name: string } | BrandTopicResult {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed && topicNameFits(trimmed)
    ? { name: trimmed }
    : {
        ok: false,
        reason: 'invalid',
        message: `Topic names are 1 to ${TOPIC_NAME_CHARS} characters.`,
      };
}

/** The brand's active topic by that name, but `except`; null when it has none. */
async function sameNamedTopic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  name: string,
  except?: string,
): Promise<{ name: string } | null> {
  const { data, error } = await supabase
    .from('topics')
    .select('id, name')
    .eq('brand_id', brandId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  const same = (data ?? []).find(
    (row) => row.id !== except && topicKey(row.name as string) === topicKey(name),
  );
  return same ? { name: same.name as string } : null;
}

const forbidden = (what: string): BrandTopicResult => ({
  ok: false,
  reason: 'forbidden_role',
  message: `Only an admin or a manager can ${what} topics.`,
});

/**
 * Add a topic to a brand unless it has an active one by that name, case and
 * spacing aside: Chat's add_topic (CHAT-20 §9 row 25, its natural key).
 * Admins and Managers, checked here as the policy does (00382). Through
 * createTopic, as the Topics tab adds one. Errors come back as values (#427).
 */
export async function addBrandTopic(brandId: string, name: string): Promise<BrandTopicResult> {
  try {
    await assertWritable({ brandId });
    return await addOneTopic(brandId, name);
  } catch (err) {
    console.error('Failed to add a topic from Chat:', err);
    return { ok: false, reason: 'failed', message: 'The topic couldn’t be added. Try again.' };
  }
}

async function addOneTopic(brandId: string, name: string): Promise<BrandTopicResult> {
  const supabase = await createClient();
  if (!(await isManager(supabase))) return forbidden('add');
  const named = topicNameOf(name);
  if (!('name' in named)) return named;
  try {
    const same = await sameNamedTopic(supabase, brandId, named.name);
    if (same) {
      return {
        ok: false,
        reason: 'duplicate',
        message: `The brand already has the topic “${same.name}”.`,
      };
    }
    return { ok: true, topic: await createTopic(brandId, named.name) };
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Rename one of a brand's active topics: Chat's rename_topic (CHAT-20 §9
 * row 25). Admins and Managers, checked here; a name another of the brand's
 * active topics has is refused, as is its own name. Through updateTopic, as
 * the Topics tab renames one. Errors come back as values (#427).
 */
export async function renameBrandTopic(topicId: string, name: string): Promise<BrandTopicResult> {
  try {
    await assertWritable();
    return await renameOneTopic(topicId, name);
  } catch (err) {
    console.error('Failed to rename a topic from Chat:', err);
    return { ok: false, reason: 'failed', message: 'The topic couldn’t be renamed. Try again.' };
  }
}

async function renameOneTopic(topicId: string, name: string): Promise<BrandTopicResult> {
  const supabase = await createClient();
  if (!(await isManager(supabase))) return forbidden('rename');
  const named = topicNameOf(name);
  if (!('name' in named)) return named;
  try {
    const { data: topic, error } = await supabase
      .from('topics')
      .select('id, brand_id, name')
      .eq('id', topicId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!topic) {
      return { ok: false, reason: 'not_found', message: "That topic isn't one of this brand's." };
    }
    if (topic.name === named.name) {
      return {
        ok: false,
        reason: 'invalid',
        message: `The topic is already called “${named.name}”.`,
      };
    }
    const same = await sameNamedTopic(supabase, topic.brand_id as string, named.name, topicId);
    if (same) {
      return {
        ok: false,
        reason: 'duplicate',
        message: `The brand already has the topic “${same.name}”.`,
      };
    }
    return { ok: true, topic: await updateTopic(topicId, named.name) };
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateTopic(topicId: string, name: string): Promise<Topic> {
  await assertWritable();
  assertTopicNames([name]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .update({ name: name.trim() })
    .eq('id', topicId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapTopicRow(data as Record<string, unknown>);
}

export async function getPromptCountByTopic(brandId: string, topicId: string): Promise<number> {
  const supabase = await createClient();

  const { data: sets } = await supabase.from('prompt_sets').select('id').eq('brand_id', brandId);

  if (!sets || sets.length === 0) return 0;

  const setIds = sets.map((s) => s.id as string);
  const { count, error } = await supabase
    .from('prompts')
    .select('id', { count: 'exact', head: true })
    .in('prompt_set_id', setIds)
    .eq('topic_id', topicId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ─── Topic Analytics ────────────────────────────────────────────────────────

export interface TopicOverviewRow {
  id: string;
  name: string;
  promptCount: number;
  /** % of the topic's prompts with results where the brand appeared at least once (#490 semantics). */
  visibilityRate: number;
  /** Distinct prompts with ≥1 mention/citation in the window (rate numerator). */
  visiblePrompts: number;
  /** Distinct prompts that produced results in the window (rate denominator). */
  activePrompts: number;
  /**
   * Score difference in points: the window against the window of the same
   * length just before it. Without a window, the last 7 days against the 7
   * before.
   */
  visibilityChange: number | null;
  totalMentions: number;
  totalCitations: number;
  shareOfVoice: number;
  topCompetitor: { name: string; sov: number } | null;
  lastRunAt: string | null;
  /** A point per day of `TopicOverviewSummary.trendDays`; empty when it is. */
  trendSparkline: number[];
}

export interface TopicOverviewSummary {
  topics: TopicOverviewRow[];
  unassignedPromptCount: number;
  /**
   * The UTC days the trend covers, oldest first: the window's whole days
   * counted back from its end, none for a window under two days (one day has
   * no line to draw). Without a window, the last 14 days.
   */
  trendDays: string[];
}

interface AnswerCounts {
  answers: number;
  mentionAnswers: number;
  citationAnswers: number;
  posSum: number;
  posN: number;
}

/** One topic's figures, whichever function read them. */
interface TopicAgg {
  /** The table's window. */
  window: AnswerCounts;
  /** The change compares these two. */
  current: AnswerCounts;
  previous: AnswerCounts;
  totalMentions: number;
  totalCitations: number;
  compMentions: number;
  activePrompts: number;
  visiblePrompts: number;
  lastRunAt: string | null;
  competitors: Record<string, { name: string; sov: number }>;
  daily: Record<string, { visible: number; count: number }>;
}

const num = (v: unknown) => Number(v ?? 0);
const counts = (r: Record<string, unknown>, prefix: string): AnswerCounts => ({
  answers: num(r[`${prefix}answers`]),
  mentionAnswers: num(r[`${prefix}mention_answers`]),
  citationAnswers: num(r[`${prefix}citation_answers`]),
  posSum: num(r[`${prefix}pos_sum`]),
  posN: num(r[`${prefix}pos_n`]),
});
const shared = (r: Record<string, unknown>) => ({
  totalMentions: num(r.total_mentions),
  totalCitations: num(r.total_citations),
  compMentions: num(r.comp_mentions),
  activePrompts: num(r.active_prompts),
  visiblePrompts: num(r.visible_prompts),
  lastRunAt: (r.last_run_at as string | null) ?? null,
  competitors: (r.competitors as TopicAgg['competitors'] | null) ?? {},
  daily: (r.daily as TopicAgg['daily'] | null) ?? {},
});

/**
 * The window's figures from topics_overview_window (00156); null when the
 * database doesn't have it yet (PostgREST's PGRST202), for a web build
 * deployed before the migration, which then reads the fixed overview.
 */
async function readWindowAggregates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  window: TopicsWindow,
): Promise<Map<string, TopicAgg> | null> {
  const { data, error } = await supabase.rpc('topics_overview_window', {
    p_brand_id: brandId,
    p_date_from: window.from,
    p_date_to: window.to ?? undefined,
  });
  if (error?.code === 'PGRST202') return null;
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => [
      r.topic_id as string,
      { window: counts(r, ''), current: counts(r, ''), previous: counts(r, 'prev_'), ...shared(r) },
    ]),
  );
}

/** The fixed overview (00057, 00098): 30 days, and 7 days against the 7 before. */
async function readFixedAggregates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<Map<string, TopicAgg>> {
  const { data, error } = await supabase.rpc('topics_overview_aggregates', {
    p_brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => [
      r.topic_id as string,
      {
        window: counts(r, ''),
        current: counts(r, 'cur_'),
        previous: counts(r, 'prev_'),
        ...shared(r),
      },
    ]),
  );
}

/**
 * Aggregate per-topic analytics for a brand over a window (the page's date
 * range), or the last 30 days without one: visibility, mentions, citations,
 * SoV, top competitor and a trend per topic. Visibility is the AI Visibility
 * Score over the topic's answers, the Insights headline's blend (#493).
 * chatgpt-shopping rows are excluded (#155).
 */
/**
 * The roster read still pages: PostgREST silently caps an un-paginated select
 * at 1000 rows, and a brand can hold more prompts than that (#464).
 *
 * The result window no longer has a ceiling. It used to stop at 50,000 rows —
 * the largest brand was already at 32,607, and crossing it would have
 * truncated the scan silently, understating every figure on the page (#721).
 * Aggregating in Postgres removes the cliff rather than raising it.
 */
const TOPIC_RESULTS_PAGE_SIZE = 1000;
const TOPIC_PROMPTS_MAX_ROWS = 10_000;

export async function getTopicsOverview(
  brandId: string,
  window?: TopicsWindow,
): Promise<TopicOverviewSummary> {
  const supabase = await createClient();

  // Only the sparkline's day keys are built here now; every window boundary
  // is resolved inside the aggregate, from the database's clock.
  const now = Date.now();

  // The aggregate needs only the brand, so it runs while the roster pages in.
  // One aggregate per brand instead of downloading the window (#721); only the
  // AI Visibility Score is computed here, over ~20 rows, so this page and the
  // Insights headline keep one implementation.
  const aggregates = (async () => {
    const windowed = window ? await readWindowAggregates(supabase, brandId, window) : null;
    return { windowed, aggByTopic: windowed ?? (await readFixedAggregates(supabase, brandId)) };
  })();
  // Settled here so a roster failure doesn't leave it rejecting unobserved.
  aggregates.catch(() => {});

  const [topicsRes, setsRes] = await Promise.all([
    supabase
      .from('topics')
      .select('id, name, created_at')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.from('prompt_sets').select('id').eq('brand_id', brandId),
  ]);

  if (topicsRes.error) throw new Error(topicsRes.error.message);
  if (setsRes.error) throw new Error(setsRes.error.message);

  const topics = (topicsRes.data ?? []) as {
    id: string;
    name: string;
    created_at: string;
  }[];
  const brandSetIds = ((setsRes.data ?? []) as { id: string }[]).map((s) => s.id);

  // Brand-scoped at the DB level (the old version fetched every org prompt and
  // filtered client-side — the same silent-1000-cap trap for large orgs).
  const prompts: { id: string; topic_id: string | null }[] = [];
  if (brandSetIds.length > 0) {
    for (let from = 0; from < TOPIC_PROMPTS_MAX_ROWS; from += TOPIC_RESULTS_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('prompts')
        .select('id, topic_id')
        .in('prompt_set_id', brandSetIds)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + TOPIC_RESULTS_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as { id: string; topic_id: string | null }[];
      prompts.push(...batch);
      if (batch.length < TOPIC_RESULTS_PAGE_SIZE) break;
    }
  }

  let unassignedPromptCount = 0;
  const promptCountByTopic = new Map<string, number>();
  for (const p of prompts) {
    if (!p.topic_id) {
      unassignedPromptCount += 1;
      continue;
    }
    promptCountByTopic.set(p.topic_id, (promptCountByTopic.get(p.topic_id) ?? 0) + 1);
  }

  const { windowed, aggByTopic } = await aggregates;
  const trendDays =
    window && windowed
      ? topicTrendDays(window, now)
      : Array.from({ length: 14 }, (_, i) =>
          new Date(now - (13 - i) * DAY_MS).toISOString().slice(0, 10),
        );

  const scoreOf = (c: AnswerCounts) =>
    computeAiVisibilityScore({
      answers: c.answers,
      mentionAnswers: c.mentionAnswers,
      citationAnswers: c.citationAnswers,
      positionFactor: c.posN > 0 ? c.posSum / c.posN : null,
    }) ?? 0;

  const rows: TopicOverviewRow[] = topics.map((t) => {
    const agg = aggByTopic.get(t.id);
    const promptCount = promptCountByTopic.get(t.id) ?? 0;

    if (!agg) {
      // A topic with prompts but no answers in the window still belongs in the
      // table — dropping it would make the roster disagree with itself.
      return {
        id: t.id,
        name: t.name,
        promptCount,
        visibilityRate: 0,
        visiblePrompts: 0,
        activePrompts: 0,
        visibilityChange: null,
        totalMentions: 0,
        totalCitations: 0,
        shareOfVoice: 0,
        topCompetitor: null,
        lastRunAt: null,
        trendSparkline: trendDays.map(() => 0),
      };
    }

    // Visibility Rate IS the AI Visibility Score over the topic's answers —
    // same blend as the Insights headline (see lib/visibility-score).
    const visibilityRate = scoreOf(agg.window);
    const change =
      agg.current.answers > 0 && agg.previous.answers > 0
        ? Math.round((scoreOf(agg.current) - scoreOf(agg.previous)) * 10) / 10
        : null;

    // The brand's own mentions are the same total the table shows.
    const totalForSov = agg.totalMentions + agg.compMentions;
    const shareOfVoice =
      totalForSov > 0 ? Math.round((agg.totalMentions / totalForSov) * 1000) / 10 : 0;

    let topCompetitor: TopicOverviewRow['topCompetitor'] = null;
    if (totalForSov > 0) {
      let best: { name: string; sov: number } | null = null;
      for (const c of Object.values(agg.competitors)) {
        const pct = Math.round((c.sov / totalForSov) * 1000) / 10;
        if (!best || pct > best.sov) best = { name: c.name, sov: pct };
      }
      topCompetitor = best;
    }

    // Daily visible-answer share (result-level) — a trend proxy for the
    // headline rate; sparklines have no axis, only shape matters.
    const sparklineDays = trendDays.map((key) => {
      const bucket = agg.daily[key];
      return bucket && bucket.count > 0 ? Math.round((bucket.visible / bucket.count) * 100) : 0;
    });

    return {
      id: t.id,
      name: t.name,
      promptCount,
      visibilityRate,
      visiblePrompts: agg.visiblePrompts,
      activePrompts: agg.activePrompts,
      visibilityChange: change,
      totalMentions: agg.totalMentions,
      totalCitations: agg.totalCitations,
      shareOfVoice,
      topCompetitor,
      lastRunAt: agg.lastRunAt,
      trendSparkline: sparklineDays,
    };
  });

  return { topics: rows, unassignedPromptCount, trendDays };
}

/**
 * Deletes a topic for an admin or a manager. Its prompts stay, with their
 * results: prompts.topic_id is ON DELETE SET NULL, so they become prompts
 * without a topic. The topics table's row rules let every member write, so
 * the role is checked here.
 */
export async function deleteTopic(topicId: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr) throw new Error(profileErr.message);
  if (!MANAGER_ROLES.some((role) => role === profile?.role)) {
    throw new Error('Only an admin or a manager can delete topics.');
  }

  // Fetch topic to get name and brand_id
  const { data: topic, error: fetchErr } = await supabase
    .from('topics')
    .select('name, brand_id')
    .eq('id', topicId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  // Clear category on prompts that belong to this brand and use this topic name
  const { data: sets } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', topic.brand_id as string);

  if (sets && sets.length > 0) {
    const setIds = sets.map((s) => s.id as string);
    await supabase
      .from('prompts')
      .update({ category: null })
      .in('prompt_set_id', setIds)
      .eq('category', topic.name as string);
  }

  // Delete the topic
  const { error } = await supabase.from('topics').delete().eq('id', topicId);
  if (error) throw new Error(error.message);
}

/**
 * "Send action" on an Insights Opportunities topic (VIS-011): a Growth
 * action to capture the demand of the topic's suggested prompts. The server
 * reads the suggestions again; the same topic sent again returns the open
 * action.
 */
export async function sendTopicOpportunityToActionCenter(
  topicId: string,
  suggestionIds: string[],
): Promise<
  | { actionId: string; actionNo: number; created: boolean }
  // 'stale': none of the suggestions is still open in the topic (409).
  | { error: string; code?: 'stale' }
> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${API_BASE_URL}/api/topics/${topicId}/opportunity-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ suggestionIds }),
  });

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = body.details || body.error || `Server error: ${res.status}`;
    return res.status === 409 ? { error, code: 'stale' } : { error };
  }
  return res.json();
}
