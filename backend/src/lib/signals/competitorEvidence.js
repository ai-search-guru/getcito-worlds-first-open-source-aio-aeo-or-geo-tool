/**
 * Where a competitor beats the brand (AC-001): per prompt and platform, the
 * competitor's position against the brand's, this week and last, and the
 * sources cited in the answers that name the competitor and not the brand.
 *
 * A competitor signal ("is gaining fast", "is mentioned far more than you",
 * "cited far more often") was recorded with the competitor's name and one
 * number. The positions come from the daily rollups through
 * ae_competitor_positions (00142); the sources from the newest answers on the
 * prompts where the competitor leads, read back for those prompts only; and
 * what happened to its pages lately (learning C3, competitor_page_events,
 * 00376): the days one was first cited in the brand's answers, and the days
 * one changed, with the Site Audit checks it gained and lost.
 */

import supabaseAdmin from '../../config/supabase.js';
import { chunkIds } from '../chunkedIn.js';
import { extractHostname, ownDomainMatcher } from '../responseParser.js';

const DAY_MS = 86_400_000;

/** Prompt rows per competitor: the panel shows a few, not every prompt. */
const POSITIONS_PER_COMPETITOR = 5;

/** Sources listed, and the newest answers read to find them. */
const MAX_SOURCES = 3;
const ANSWERS_READ = 60;

/**
 * A competitor's page events read, newest first, and how far back: a page
 * change shows in AI answers over weeks, so four of them, not only the
 * window the signal measured.
 */
const PAGE_EVENTS_PER_COMPETITOR = 5;
const PAGE_EVENT_DAYS = 28;

function isoDay(now, daysAgo) {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The domains most cited in the answers a competitor wins: it is named, the
 * brand is not. The brand's own domains never count; the competitor's do,
 * since its own pages are part of why it wins.
 */
export function winningSources(answers, competitorId, isOwn) {
  const won = answers.filter((answer) => {
    const entry = (answer.competitor_mentions ?? []).find(
      (m) => String(m?.competitor_id) === String(competitorId),
    );
    return (entry?.mention_count ?? 0) > 0 && (answer.mention_count ?? 0) === 0;
  });
  const counts = new Map();
  for (const answer of won) {
    const domains = new Set(
      (answer.citations ?? [])
        .map((cite) => (cite?.url && !isOwn(cite.url) ? extractHostname(cite.url) : null))
        .filter(Boolean),
    );
    for (const domain of domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, MAX_SOURCES)
    .map(([domain, count]) => ({ domain, answers: count, answersRead: won.length }));
}

/**
 * Page events as a signal keeps them: the table's rows without their ids,
 * the detail cut to what the drawer and the task writer read.
 */
export function pageEventsOf(rows) {
  return (rows ?? []).map((row) => {
    const detail = row.detail ?? {};
    return {
      kind: row.kind,
      at: row.at,
      url: row.url,
      domain: row.domain,
      detail:
        row.kind === 'changed'
          ? { gained: detail.gained ?? [], lost: detail.lost ?? [] }
          : { answers: detail.answers ?? null },
    };
  });
}

/** One position row, named for the panel. */
export function toPosition(row, texts) {
  return {
    promptId: row.prompt_id,
    promptText: texts.get(row.prompt_id) ?? '',
    platform: row.platform,
    competitor: { now: row.competitor_now, before: row.competitor_before },
    you: { now: row.brand_now, before: row.brand_before },
  };
}

/**
 * The evidence for each competitor, by competitor id: its positions against
 * the brand's on the prompts where it leads most, the sources behind its
 * wins there, and its pages' newest events. Five reads: the positions, the
 * prompts' texts, the brand's domains, and per competitor the newest
 * answers and page events.
 */
export async function competitorEvidence(brandId, competitorIds, { now, windowDays }) {
  const evidence = new Map();
  if (competitorIds.length === 0) return evidence;

  const { data: rows, error } = await supabaseAdmin.rpc('ae_competitor_positions', {
    p_brand_id: brandId,
    p_competitor_ids: competitorIds,
    p_cur_from: isoDay(now, windowDays - 1),
    p_cur_to: isoDay(now, 0),
    p_prev_from: isoDay(now, 2 * windowDays - 1),
    p_prev_to: isoDay(now, windowDays),
    p_limit: POSITIONS_PER_COMPETITOR,
  });
  if (error) throw new Error(`competitor positions read failed: ${error.message}`);

  const byCompetitor = new Map();
  for (const row of rows ?? []) {
    const list = byCompetitor.get(row.competitor_id);
    if (list) list.push(row);
    else byCompetitor.set(row.competitor_id, [row]);
  }
  const promptIds = [...new Set((rows ?? []).map((row) => row.prompt_id))];

  const [texts, domainsRes] = await Promise.all([
    promptTexts(promptIds),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
  ]);
  if (domainsRes.error) throw new Error(domainsRes.error.message);
  const isOwn = ownDomainMatcher((domainsRes.data ?? []).map((r) => r.domain));
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
  const eventsSince = new Date(now.getTime() - PAGE_EVENT_DAYS * DAY_MS).toISOString();

  // Only answers that leave the brand out can be the competitor's wins, so
  // only those are read, the newest first, for every competitor at once.
  await Promise.all(
    [...byCompetitor].map(async ([competitorId, list]) => {
      const [answersRes, eventsRes] = await Promise.all([
        supabaseAdmin
          .from('prompt_results')
          .select('mention_count, competitor_mentions, citations')
          .eq('brand_id', brandId)
          .neq('platform', 'chatgpt-shopping')
          .eq('mention_count', 0)
          .in('prompt_id', [...new Set(list.map((row) => row.prompt_id))])
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(ANSWERS_READ),
        supabaseAdmin
          .from('competitor_page_events')
          .select('kind, at, url, domain, detail')
          .eq('brand_id', brandId)
          .eq('competitor_id', competitorId)
          .gte('at', eventsSince)
          .order('at', { ascending: false })
          .limit(PAGE_EVENTS_PER_COMPETITOR),
      ]);
      if (answersRes.error) {
        throw new Error(`competitor answers read failed: ${answersRes.error.message}`);
      }
      if (eventsRes.error) {
        throw new Error(`competitor page events read failed: ${eventsRes.error.message}`);
      }
      evidence.set(competitorId, {
        positions: list.map((row) => toPosition(row, texts)),
        winningSources: winningSources(answersRes.data ?? [], competitorId, isOwn),
        pageEvents: pageEventsOf(eventsRes.data),
        pageEventDays: PAGE_EVENT_DAYS,
      });
    }),
  );
  return evidence;
}

async function promptTexts(ids) {
  const texts = new Map();
  for (const chunk of chunkIds(ids)) {
    const { data, error } = await supabaseAdmin.from('prompts').select('id, text').in('id', chunk);
    if (error) throw new Error(`prompt texts read failed: ${error.message}`);
    for (const row of data ?? []) texts.set(row.id, String(row.text ?? '').slice(0, 160));
  }
  return texts;
}
