/**
 * The V1 library's detectors, run for one brand (#818).
 *
 * Ten families, one per read. Each asks Postgres for a compact summary
 * through an `ae_*` function (00091), hands it to the pure classifiers in
 * classify.js, and turns what they decide into signal candidates the
 * recorder writes like any other.
 *
 * Every family is isolated. A read that fails — a timeout on a large brand,
 * a source that errors — costs that family's signals for the night and
 * nothing else. That is the lesson of #829 and #834, where one call site's
 * timeout threw the whole pass. And a family that failed reports its kinds as
 * unread, so the recorder does not take its silence for recovery and close
 * every open signal of those kinds.
 *
 * Families whose source the brand lacks do not run at all. Search Console
 * detectors for a brand without Search Console would read nothing and cost a
 * round trip; worse, they would report their kinds as read and resolve
 * nothing — which is right — but only by accident.
 */

import { MAX_TARGET_IDS } from '../../targetIds.js';
import supabaseAdmin from '../../../config/supabase.js';
import { logger } from '../../logger.js';
import { resolve } from '../../../config/actionEngine.js';
import { resolveBrandSources } from '../../action-center/sources.js';
import * as c from './classify.js';
import { isTransientDbError } from '../../pulse/metrics.js';
import { describeSignal } from '../../audit/rubric.js';
import { TRAFFIC_WINDOW_DAYS } from '../trafficEvidence.js';

const { library: t } = resolve();
const DAY_MS = 86_400_000;

const AI = ['ai_results'];
const GSC = ['gsc'];
const GA = ['ga4'];
const AUDIT = ['site_audit'];

/** Midnight UTC `daysAgo` days before today's: whole days, so a pass early in
 *  the morning compares full weeks rather than a few hours of today. */
function utcMidnight(now, daysAgo) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - daysAgo * DAY_MS).toISOString();
}

/**
 * The second before `iso`. ai_traffic_merged keeps Analytics rows through
 * p_to's day (00176), so a window ending at midnight is read up to the
 * second before with p_to_inclusive: an exclusive midnight would put that
 * day's Analytics in both weeks.
 */
function lastSecond(iso) {
  return new Date(Date.parse(iso) - 1000).toISOString();
}

/** The last seven whole days and the seven before, each up to its last second. */
export function weeklyWindows(now) {
  return {
    cur: { from: utcMidnight(now, 7), to: lastSecond(utcMidnight(now, 0)) },
    prev: { from: utcMidnight(now, 14), to: lastSecond(utcMidnight(now, 7)) },
  };
}

function isoDay(now, daysAgo) {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

const RPC_RETRIES = 2;
const RPC_RETRY_DELAY_MS = 3_000;

/**
 * One read, retried on a transient timeout.
 *
 * The largest brand's citation read runs in under two seconds alone and timed
 * out under load on the first end-to-end run. A timeout is transient by
 * nature; the pulse has retried its reads since #687, and these did not.
 */
async function rpc(name, params, attempt = 0) {
  const { data, error } = await supabaseAdmin.rpc(name, params);
  if (error) {
    if (attempt < RPC_RETRIES && isTransientDbError(error.message)) {
      await new Promise((resolve) => setTimeout(resolve, RPC_RETRY_DELAY_MS * (attempt + 1)));
      return rpc(name, params, attempt + 1);
    }
    throw new Error(`${name}: ${error.message}`);
  }
  return data;
}

/** Pages through a select, because PostgREST caps a response at 1000 rows
 *  and a silent cap is how a detector ends up judging part of the data. */
async function selectAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

/**
 * A finding about a group — prompts, pages, queries — as one signal. It
 * names its first 50 targets; a bigger group lists every target's id too
 * (`targetIds`), so the action it starts counts and keeps the whole group
 * (AC-009: one count everywhere).
 */
export function group(kind, entity, rows, toTarget, source, extra = {}) {
  const ids =
    rows.length > 50
      ? {
          targetIds: rows.slice(0, MAX_TARGET_IDS).map((row) => {
            const target = toTarget(row);
            return String(target.id ?? target.label ?? '');
          }),
        }
      : {};
  return {
    kind,
    dedupKey: kind,
    source,
    payload: { entity, targets: rows.slice(0, 50).map(toTarget), ...ids, ...extra },
    previousValue: null,
    currentValue: rows.length,
    changeValue: null,
  };
}

/** A finding about one thing — a topic, a platform, a source, a competitor. */
export function single(kind, key, entity, target, source, values = {}, extra = {}) {
  return {
    kind,
    dedupKey: `${kind}:${key}`,
    source,
    payload: { entity, targets: [target], ...extra },
    previousValue: values.previous ?? null,
    currentValue: values.current ?? null,
    changeValue: values.change ?? null,
  };
}

/**
 * Keeps a kind's signals to the configured maximum, strongest first.
 *
 * The rest are marked, not dropped: they were still detected, and the pass
 * needs to know that. A finding that slips from fifth to sixth has not ended,
 * and closing it would tell the user a problem was solved when it only moved
 * down a list.
 */
export function cap(candidates, score) {
  const byKind = new Map();
  for (const candidate of candidates) {
    byKind.set(candidate.kind, [...(byKind.get(candidate.kind) ?? []), candidate]);
  }
  return [...byKind.values()].flatMap((list) => {
    const kept = new Set(c.strongest(list, score, t.maxSignalsPerKind));
    return list.map((candidate) =>
      kept.has(candidate) ? candidate : { ...candidate, overflow: true },
    );
  });
}

/**
 * Lazily-loaded, memoised reads shared between families, so the prompt
 * summary two families need is fetched once.
 */
function context(brandId, now, sources) {
  const memo = new Map();
  const once = (key, load) => {
    if (!memo.has(key)) memo.set(key, load());
    return memo.get(key);
  };
  const week = {
    p_brand_id: brandId,
    p_cur_from: isoDay(now, t.windowDays - 1),
    p_cur_to: isoDay(now, 0),
    p_prev_from: isoDay(now, 2 * t.windowDays - 1),
    p_prev_to: isoDay(now, t.windowDays),
  };

  return {
    brandId,
    now,
    sources,
    week,
    prompts: () => once('prompts', () => rpc('ae_prompt_stats', week)),
    dimensions: () => once('dimensions', () => rpc('ae_dimension_stats', week)),
    promptTexts: () =>
      once('promptTexts', async () => {
        const sets = await selectAll(() =>
          supabaseAdmin.from('prompt_sets').select('id').eq('brand_id', brandId),
        );
        if (sets.length === 0) return new Map();
        const rows = await selectAll(() =>
          supabaseAdmin
            .from('prompts')
            .select('id, text')
            .in(
              'prompt_set_id',
              sets.map((s) => s.id),
            ),
        );
        return new Map(rows.map((r) => [r.id, r.text]));
      }),
    topicNames: () =>
      once('topicNames', async () => {
        const rows = await selectAll(() =>
          supabaseAdmin.from('topics').select('id, name').eq('brand_id', brandId),
        );
        return new Map(rows.map((r) => [r.id, r.name]));
      }),
    traffic: () =>
      once('traffic', () =>
        rpc('ae_ai_traffic_pages', {
          p_brand_id: brandId,
          p_cur_from: isoDay(now, TRAFFIC_WINDOW_DAYS - 1),
          p_cur_to: isoDay(now, 0),
          p_prev_from: isoDay(now, TRAFFIC_WINDOW_DAYS * 2 - 1),
          p_prev_to: isoDay(now, TRAFFIC_WINDOW_DAYS),
        }),
      ),
    // AI visits as the AI Traffic page counts them (00176: the snippet on the
    // days it ran, Analytics on the rest), over the last seven whole days
    // and the seven before (AT-013).
    weeklyVisits: () =>
      once('weeklyVisits', async () => {
        const read = ({ from, to }) =>
          rpc('ai_traffic_merged', {
            p_brand_id: brandId,
            p_from: from,
            p_to: to,
            p_to_inclusive: true,
            p_analytics: true,
          });
        const windows = weeklyWindows(now);
        const [cur, prev] = await Promise.all([read(windows.cur), read(windows.prev)]);
        return { cur: cur ?? {}, prev: prev ?? {} };
      }),
    // The pages AI visitors landed on that don't exist, over the last seven
    // days (AT-012, 00186).
    brokenLinks: () =>
      once('brokenLinks', () =>
        rpc('ai_traffic_broken_links', {
          p_brand_id: brandId,
          p_from: utcMidnight(now, 7),
          p_to: now.toISOString(),
          p_limit: 50,
          p_offset: 0,
        }),
      ),
    // The AI bot report's alert: cited pages no search bot read in the last
    // 30 days (AT-011, 00185). Its window is its own, whatever days are asked.
    botReport: () =>
      once('botReport', () =>
        rpc('ai_bot_report', {
          p_brand_id: brandId,
          p_since: isoDay(now, 0),
          p_until: isoDay(now, 0),
          p_limit: 0,
        }),
      ),
    gsc: () =>
      once('gsc', () =>
        rpc('ae_gsc_queries', {
          p_brand_id: brandId,
          p_cur_from: isoDay(now, 27),
          p_cur_to: isoDay(now, 0),
          p_prev_from: isoDay(now, 55),
          p_prev_to: isoDay(now, 28),
        }),
      ),
  };
}

/** A rate to three places: what the drawer shows. */
const rounded = (value) => Math.round(value * 1000) / 1000;

/**
 * A page of AI traffic as the drawer shows it (AC-001): its sessions, and
 * from Analytics what its AI visitors did, the engagement and key events the
 * classification compares with the site's. The snippet counts visits only.
 */
function trafficTarget(p) {
  const target = {
    id: p.page,
    label: p.page,
    before: p.prev_sessions ?? 0,
    now: p.cur_sessions ?? 0,
  };
  if (p.source !== 'analytics') return target;
  const sessions = p.cur_sessions ?? 0;
  const share = (part) => (sessions > 0 ? rounded((part ?? 0) / sessions) : null);
  return {
    ...target,
    engagedRate: share(p.cur_engaged),
    keyEvents: p.cur_key_events ?? 0,
    keyEventsBefore: p.prev_key_events ?? 0,
    // Key events per session, as the classification compares them: can pass 1.
    keyRate: share(p.cur_key_events),
  };
}

export const promptTarget = (texts) => (p) => ({
  id: p.prompt_id,
  label: String(texts.get(p.prompt_id) ?? '').slice(0, 160),
  volume: p.volume ?? 0,
});

// ─── The families ───────────────────────────────────────────────────────────

const FAMILIES = [
  {
    name: 'prompts',
    requires: ['tracking'],
    kinds: [
      'prompt_visibility_gap',
      'high_demand_gap',
      'uncovered_demand',
      'prompt_unmapped',
      'content_underperforming',
      'lost_mentions',
      'high_value_prompt_lost',
      'citation_at_risk',
    ],
    async run(ctx) {
      const [prompts, texts] = await Promise.all([ctx.prompts(), ctx.promptTexts()]);
      const groups = c.groupPrompts(prompts, t);
      return Object.entries(groups).map(([kind, rows]) => {
        const ordered = [...rows].sort(
          (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || b.prev_mention_days - a.prev_mention_days,
        );
        return group(kind, 'prompts', ordered, promptTarget(texts), AI);
      });
    },
  },

  {
    name: 'topics',
    requires: ['tracking', 'topics'],
    kinds: ['topic_gap', 'topic_uncovered', 'topic_slipping', 'topic_drop'],
    async run(ctx) {
      const [prompts, names] = await Promise.all([ctx.prompts(), ctx.topicNames()]);
      const found = [];
      for (const topic of c.topicCoverage(prompts, t)) {
        const kind = c.classifyTopic(topic, t);
        if (!kind) continue;
        const coverage = Math.round((topic.visible / Math.max(topic.tracked, 1)) * 100);
        const previous = Math.round((topic.prevVisible / Math.max(topic.prevTracked, 1)) * 100);
        found.push(
          single(
            kind,
            topic.topicId,
            'topics',
            { id: topic.topicId, label: names.get(topic.topicId) ?? '' },
            AI,
            { previous, current: coverage, change: coverage - previous },
            { topicName: names.get(topic.topicId) ?? '', prompts: topic.tracked },
          ),
        );
      }
      return cap(found, (x) => x.payload.prompts);
    },
  },

  {
    name: 'dimensions',
    requires: ['tracking'],
    kinds: ['platform_slipping', 'platform_drop', 'country_gap'],
    async run(ctx) {
      const dims = await ctx.dimensions();
      const found = [];
      for (const row of dims.platforms ?? []) {
        const kind = c.classifyRateFall(row, t, {
          slip: 'platform_slipping',
          drop: 'platform_drop',
        });
        if (!kind) continue;
        const prev = Math.round((row.prev_mentions / row.prev_answers) * 1000) / 10;
        const cur = Math.round((row.cur_mentions / row.cur_answers) * 1000) / 10;
        found.push(
          single(
            kind,
            row.key,
            'platforms',
            { id: row.key, label: row.key },
            AI,
            {
              previous: prev,
              current: cur,
              change: Math.round((cur - prev) * 10) / 10,
            },
            { platform: row.key },
          ),
        );
      }
      const gap = c.classifyCountryGap(dims.regions ?? [], t);
      if (gap) {
        found.push(
          single(
            'country_gap',
            gap.worst.key,
            'regions',
            { id: gap.worst.key, label: gap.worst.key },
            AI,
            {
              previous: Math.round(gap.best.rate * 1000) / 10,
              current: Math.round(gap.worst.rate * 1000) / 10,
              change: -gap.points,
            },
            { region: gap.worst.key, bestRegion: gap.best.key },
          ),
        );
      }
      return found;
    },
  },

  {
    name: 'competitors',
    requires: ['tracking', 'competitors'],
    kinds: ['competitor_leads', 'competitor_momentum'],
    async run(ctx) {
      const dims = await ctx.dimensions();
      const brandMentions = (dims.platforms ?? []).reduce((s, p) => s + (p.cur_mentions ?? 0), 0);
      const found = [];
      for (const competitor of dims.competitors ?? []) {
        for (const kind of c.classifyCompetitor(competitor, brandMentions, t)) {
          found.push(
            single(
              kind,
              competitor.key,
              'competitors',
              { id: competitor.key, label: competitor.name ?? '' },
              AI,
              {
                previous: kind === 'competitor_leads' ? brandMentions : competitor.prev_mentions,
                current: competitor.cur_mentions,
                change:
                  competitor.cur_mentions -
                  (kind === 'competitor_leads' ? brandMentions : competitor.prev_mentions),
              },
              { competitorName: competitor.name ?? '', competitorId: competitor.key },
            ),
          );
        }
      }
      return cap(found, (x) => x.currentValue ?? 0);
    },
  },

  {
    name: 'competitorPrompts',
    requires: ['tracking', 'competitors'],
    kinds: ['competitor_high_value_lead', 'competitor_topic_lead', 'competitor_uncovered_topic'],
    async run(ctx) {
      const [prompts, compRows, texts, dims] = await Promise.all([
        ctx.prompts(),
        rpc('ae_competitor_prompt_stats', ctx.week),
        ctx.promptTexts(),
        ctx.dimensions(),
      ]);
      const names = new Map((dims.competitors ?? []).map((x) => [x.key, x.name]));
      const leader = new Map();
      for (const row of compRows) {
        if (
          row.cur_days < t.competitorPromptMinDays &&
          (row.cur_answers ?? 0) < t.promptMinAnswers
        ) {
          continue;
        }
        const current = leader.get(row.prompt_id);
        // Most days, then most answers — a new brand's rows are all one day.
        const ahead =
          !current ||
          row.cur_days > current.cur_days ||
          (row.cur_days === current.cur_days &&
            (row.cur_answers ?? 0) > (current.cur_answers ?? 0));
        if (ahead) leader.set(row.prompt_id, row);
      }
      const present = new Set(leader.keys());
      const found = [];

      if (ctx.sources.has('volumes')) {
        const contested = prompts.filter(
          (p) =>
            (p.volume ?? 0) >= t.highDemandVolume &&
            c.isTracked(p, t) &&
            p.cur_mention_days === 0 &&
            present.has(p.prompt_id),
        );
        if (contested.length > 0) {
          const target = promptTarget(texts);
          found.push(
            group(
              'competitor_high_value_lead',
              'prompts',
              contested,
              (p) => ({
                ...target(p),
                competitor: names.get(leader.get(p.prompt_id)?.competitor_id) ?? '',
              }),
              AI,
            ),
          );
        }
      }

      if (ctx.sources.has('topics')) {
        const topicNames = await ctx.topicNames();
        for (const topic of c.topicCoverage(prompts, t)) {
          const kind = c.classifyCompetitorTopic(topic, present, t);
          if (!kind) continue;
          found.push(
            single(
              kind,
              topic.topicId,
              'topics',
              {
                id: topic.topicId,
                label: topicNames.get(topic.topicId) ?? '',
              },
              AI,
              { current: topic.tracked },
              { topicName: topicNames.get(topic.topicId) ?? '' },
            ),
          );
        }
      }
      return cap(found, (x) => x.currentValue ?? 0);
    },
  },

  {
    name: 'sources',
    requires: ['tracking'],
    kinds: [
      'authority_citation_gap',
      'third_party_citation_gap',
      'third_party_presence_gap',
      'competitor_cited_source',
      'competitor_winning_source',
    ],
    async run(ctx) {
      const domains = await rpc('ae_citation_sources', {
        p_brand_id: ctx.brandId,
        p_from: new Date(ctx.now.getTime() - t.windowDays * DAY_MS).toISOString(),
      });
      const found = [];
      for (const d of domains) {
        const kind = c.classifySource(d, t);
        if (!kind) continue;
        found.push(
          single(
            kind,
            d.domain,
            'sources',
            { id: d.domain, label: d.domain },
            AI,
            {
              current: d.results,
              previous: d.with_brand,
              change: d.competitor_only,
            },
            { domain: d.domain, prompts: d.prompts, results: d.results },
          ),
        );
      }
      return cap(found, (x) => x.currentValue ?? 0);
    },
  },

  {
    name: 'ownedPages',
    requires: ['tracking'],
    kinds: ['page_citation_slipping', 'owned_page_citation_lost'],
    async run(ctx) {
      const urls = await rpc('ae_owned_citations', {
        p_brand_id: ctx.brandId,
        p_cur_from: new Date(ctx.now.getTime() - t.windowDays * DAY_MS).toISOString(),
        p_prev_from: new Date(ctx.now.getTime() - 2 * t.windowDays * DAY_MS).toISOString(),
      });
      const groups = {};
      for (const u of urls) {
        const kind = c.classifyOwnedPage(u, t);
        if (kind) (groups[kind] ??= []).push(u);
      }
      return Object.entries(groups).map(([kind, rows]) =>
        group(
          kind,
          'pages',
          rows,
          (u) => ({
            id: u.url,
            label: u.url,
            before: u.prev_citations,
            now: u.cur_citations,
          }),
          AI,
        ),
      );
    },
  },

  {
    name: 'fanouts',
    requires: ['tracking'],
    kinds: ['fanout_gap', 'competitor_fanout_gap'],
    async run(ctx) {
      const queries = await rpc('ae_fanout_gaps', {
        p_brand_id: ctx.brandId,
        p_from: new Date(ctx.now.getTime() - t.windowDays * DAY_MS).toISOString(),
      });
      const groups = {};
      for (const q of queries) {
        const kind = c.classifyFanout(q, t);
        if (kind) (groups[kind] ??= []).push(q);
      }
      return Object.entries(groups)
        .filter(([, rows]) => rows.length >= t.fanoutGroupMin)
        .map(([kind, rows]) =>
          group(
            kind,
            'queries',
            rows,
            (q) => ({ id: q.query, label: q.query, prompts: q.prompts }),
            AI,
          ),
        );
    },
  },

  {
    name: 'searchConsole',
    requires: ['tracking', 'search_console'],
    kinds: ['gsc_demand_gap', 'search_ai_misalignment', 'gsc_low_ctr', 'gsc_risk', 'gsc_decline'],
    async run(ctx) {
      const [queries, prompts, texts] = await Promise.all([
        ctx.gsc(),
        ctx.prompts(),
        ctx.promptTexts(),
      ]);
      const byId = new Map(prompts.map((p) => [p.prompt_id, p]));
      const promptTokens = new Map([...texts].map(([id, text]) => [id, c.tokens(text)]));
      const groups = {};
      for (const q of queries) {
        const match = c.matchPrompt(c.tokens(q.query), promptTokens, t);
        const prompt = match ? byId.get(match.id) : null;
        for (const kind of c.classifyGscQuery(q, prompt, t)) {
          (groups[kind] ??= []).push({ q, promptId: match?.id });
        }
      }
      return Object.entries(groups).map(([kind, rows]) =>
        group(
          kind,
          'queries',
          rows,
          ({ q, promptId }) => ({
            id: q.query,
            label: q.query,
            impressions: q.cur_impressions,
            clicks: q.cur_clicks,
            prompt: String(texts.get(promptId) ?? '').slice(0, 160),
          }),
          GSC,
        ),
      );
    },
  },

  {
    name: 'aiTraffic',
    requires: ['ai_traffic'],
    kinds: [
      'ai_traffic_slipping',
      'ai_traffic_drop',
      'ai_landing_page_winner',
      'ai_landing_underperforming',
      'converting_page_slipping',
    ],
    async run(ctx) {
      const pages = c.mergeTrafficPages(await ctx.traffic());
      const site = c.siteTrafficRates(pages);
      const source = pages.some((p) => p.source === 'analytics') ? GA : AI;
      // The site's rates the pages were compared with, from Analytics only.
      const siteRates =
        source === GA
          ? { siteEngagedRate: rounded(site.engagedRate), siteKeyRate: rounded(site.keyRate) }
          : {};
      const groups = {};
      for (const page of pages) {
        for (const kind of c.classifyTrafficPage(page, site, t)) (groups[kind] ??= []).push(page);
      }
      const found = Object.entries(groups).map(([kind, rows]) =>
        group(kind, 'pages', rows, trafficTarget, source, siteRates),
      );
      if (
        site.prev >= t.aiTrafficMinSessions * 3 &&
        c.relativeFall(site.prev, site.cur) >= t.aiTrafficDropRatio
      ) {
        const falling = pages.filter((p) => (p.prev_sessions ?? 0) > (p.cur_sessions ?? 0));
        found.push({
          // Its value is the site's sessions, so the falling pages are counted
          // apart: only the first 50 are kept as targets.
          ...group('ai_traffic_drop', 'pages', falling, trafficTarget, source, {
            ...siteRates,
            pageCount: falling.length,
          }),
          previousValue: site.prev,
          currentValue: site.cur,
          changeValue: site.cur - site.prev,
        });
      }
      return found;
    },
  },

  // AI Traffic Analytics' alerts (AT-013, spec §3.8). A new platform sending
  // visits is good news with no work behind it, so it is a recorder kind of
  // its own (signals/trafficPlatforms.js), not a library one.
  {
    name: 'aiTrafficAlerts',
    requires: ['ai_traffic'],
    kinds: ['ai_visits_weekly_drop', 'broken_citation_target'],
    async run(ctx) {
      const found = [];
      const { cur, prev } = await ctx.weeklyVisits();
      const before = Number(prev.visits) || 0;
      const after = Number(cur.visits) || 0;
      if (
        before >= t.aiVisitsWeeklyMinVisits &&
        c.relativeFall(before, after) >= t.aiVisitsWeeklyDropRatio
      ) {
        const falling = c.fallingPages(prev.pages, cur.pages);
        const analytics =
          c.analyticsDayCount(prev.analytics_days) + c.analyticsDayCount(cur.analytics_days);
        found.push({
          // Its value is the site's visits; the pages that fell are its targets.
          ...group(
            'ai_visits_weekly_drop',
            'pages',
            falling,
            (p) => ({ id: p.page, label: p.page, before: p.before, now: p.now }),
            analytics > 0 ? GA : AI,
            { pageCount: falling.length },
          ),
          previousValue: before,
          currentValue: after,
          changeValue: after - before,
        });
      }

      // Each missing page with what AI visitors got and the working page to
      // redirect it to; the snippet is the only source (§3.8b). A page AI
      // answers cite counts from its first visit; any other needs
      // brokenLinkMinVisits, so a single 404 visit from the public beacon,
      // stray or made up, raises no high-impact signal.
      const broken = await ctx.brokenLinks();
      const listed = Array.isArray(broken?.rows) ? broken.rows : [];
      const rows = listed.filter(
        (r) => (Number(r.citations) || 0) > 0 || (Number(r.visits) || 0) >= t.brokenLinkMinVisits,
      );
      if (rows.length > 0) {
        found.push({
          ...group(
            'broken_citation_target',
            'pages',
            rows,
            (r) => ({
              id: r.page,
              label: r.page,
              visits: Number(r.visits) || 0,
              status: r.status,
              citations: Number(r.citations) || 0,
              redirectTo: r.target ?? null,
            }),
            AI,
          ),
          // The function's count covers every page past its row limit; once
          // the filter drops some, the pages kept are the count.
          currentValue:
            rows.length === listed.length ? Number(broken.count) || rows.length : rows.length,
        });
      }
      return found;
    },
  },

  {
    name: 'aiBots',
    // Any brand can connect its Cloudflare or Vercel; the report says
    // whether it did.
    requires: ['tracking'],
    kinds: ['cited_page_uncrawled'],
    async run(ctx) {
      const report = await ctx.botReport();
      // Only while the bot data is whole (00185's alert_state 'on'). With a
      // sender stopped, revoked or past its cap ('stale'), the pages search
      // bots read drain and every cited page would read as uncrawled; the
      // kind is unread tonight, not recovered, so open signals and their
      // tasks stay open until data returns. Under 30 days ('waiting') there
      // is nothing to say yet.
      if (report?.alert_state === 'stale') throw new DataNotWhole('bot data is stale');
      if (report?.alert_state !== 'on') return [];
      const uncrawled = Array.isArray(report?.uncrawled) ? report.uncrawled : [];
      if (uncrawled.length === 0) return [];
      return [
        {
          ...group(
            'cited_page_uncrawled',
            'pages',
            uncrawled,
            (u) => ({ id: u.page, label: u.page, citations: Number(u.citations) || 0 }),
            AI,
          ),
          // The report names the ten most cited; the count is all of them.
          currentValue: Number(report.uncrawled_count) || uncrawled.length,
        },
      ];
    },
  },

  {
    name: 'crossChannel',
    requires: ['ai_traffic'],
    kinds: ['cross_channel_risk', 'visibility_traffic_loss'],
    async run(ctx) {
      const pages = c.mergeTrafficPages(await ctx.traffic());
      const site = c.siteTrafficRates(pages);
      const trafficFall = c.relativeFall(site.prev, site.cur);
      const found = [];
      if (site.prev < t.aiTrafficMinSessions * 3) return found;

      const dims = await ctx.dimensions();
      const prevMentions = (dims.platforms ?? []).reduce((s, p) => s + (p.prev_mentions ?? 0), 0);
      const curMentions = (dims.platforms ?? []).reduce((s, p) => s + (p.cur_mentions ?? 0), 0);
      // Correlation, not cause: both fell in the same window. The definition's
      // copy says so, per the specification.
      if (trafficFall >= 0.2 && c.relativeFall(prevMentions, curMentions) >= 0.2) {
        found.push(
          single(
            'visibility_traffic_loss',
            'site',
            'pages',
            { id: 'site', label: '' },
            GA,
            {
              previous: site.prev,
              current: site.cur,
              change: site.cur - site.prev,
            },
            { mentionsBefore: prevMentions, mentionsNow: curMentions },
          ),
        );
      }

      if (ctx.sources.has('analytics') && ctx.sources.has('search_console')) {
        const queries = await ctx.gsc();
        const prevClicks = queries.reduce((s, q) => s + (q.prev_clicks ?? 0), 0);
        const curClicks = queries.reduce((s, q) => s + (q.cur_clicks ?? 0), 0);
        if (
          trafficFall >= t.aiTrafficSlipRatio &&
          c.relativeFall(prevClicks, curClicks) >= t.aiTrafficSlipRatio
        ) {
          found.push(
            single(
              'cross_channel_risk',
              'site',
              'pages',
              { id: 'site', label: '' },
              [...GA, ...GSC],
              {
                previous: site.prev,
                current: site.cur,
                change: site.cur - site.prev,
              },
              { clicksBefore: prevClicks, clicksNow: curClicks },
            ),
          );
        }
      }
      return found;
    },
  },

  {
    name: 'audits',
    requires: ['site_audits'],
    kinds: [
      'crawler_blocked',
      'structured_data_issue',
      'outdated_content',
      'weak_entity',
      'weak_internal_links',
      'content_gap',
    ],
    async run(ctx) {
      const since = new Date(ctx.now.getTime() - 90 * DAY_MS).toISOString();
      const audits = await selectAll(() =>
        supabaseAdmin
          .from('site_audits')
          .select('id, url, final_url, completed_at')
          .eq('brand_id', ctx.brandId)
          .eq('status', 'completed')
          .gte('completed_at', since)
          .order('completed_at', { ascending: false }),
      );
      // The latest audit per page: an issue fixed and re-audited is fixed.
      const latest = new Map();
      for (const a of audits) {
        const page = a.final_url || a.url;
        if (!latest.has(page)) latest.set(page, a);
      }
      if (latest.size === 0) return [];

      const ids = [...latest.values()].map((a) => a.id);
      const failures = await selectAll(() =>
        supabaseAdmin
          .from('audit_signal_results')
          .select('audit_id, signal_key, evidence')
          .in('audit_id', ids)
          .eq('status', 'fail'),
      );
      const pageOf = new Map([...latest].map(([page, a]) => [a.id, page]));
      const groups = {};
      for (const f of failures) {
        const kind = c.AUDIT_SIGNAL_KINDS[f.signal_key];
        if (!kind) continue;
        const page = pageOf.get(f.audit_id);
        const set = (groups[kind] ??= new Map());
        const entry = set.get(page) ?? { page, checks: [], issues: [] };
        entry.checks.push(f.signal_key);
        // What the check found, named as the audit names it (AC-001): the
        // drawer shows it as the issue's evidence.
        entry.issues.push({
          check: f.signal_key,
          label: describeSignal(f.signal_key)?.label ?? f.signal_key,
          evidence: f.evidence ?? {},
        });
        set.set(page, entry);
      }
      return Object.entries(groups).map(([kind, pages]) =>
        group(
          kind,
          'pages',
          [...pages.values()],
          (e) => ({ id: e.page, label: e.page, checks: e.checks, issues: e.issues }),
          AUDIT,
        ),
      );
    },
  },
];

/** Every kind a library family can emit — what the registry checks against. */
export const LIBRARY_EMITTED_KINDS = Object.freeze(FAMILIES.flatMap((f) => f.kinds));

/**
 * Thrown by a family whose data is there but not whole tonight — a bot
 * sender stopped, say. Its kinds are reported unread, as a failed read's are,
 * so open signals stay open until the data is whole again; it isn't an error.
 */
export class DataNotWhole extends Error {}

/**
 * Run every family the brand has the data for.
 *
 * `overflow` holds findings still detected but past their kind's cap. They
 * are not written as new signals; they keep open ones open.
 *
 * @returns {Promise<{ candidates: object[], overflow: object[], unreadKinds: Set<string> }>}
 */
export async function libraryCandidates(brandId, { now = new Date(), sources } = {}) {
  const available = sources ?? (await resolveBrandSources(brandId));
  const ctx = context(brandId, now, available);
  const candidates = [];
  const overflow = [];
  const unreadKinds = new Set();

  for (const family of FAMILIES) {
    if (!family.requires.every((s) => available.has(s))) continue;
    try {
      for (const found of await family.run(ctx)) {
        if (found.overflow) {
          const { overflow: _, ...candidate } = found;
          overflow.push(candidate);
        } else {
          candidates.push(found);
        }
      }
    } catch (err) {
      // One family's read failing costs that family's night, not the pass.
      for (const kind of family.kinds) unreadKinds.add(kind);
      if (err instanceof DataNotWhole) {
        logger.info(
          { brandId, family: family.name, reason: err.message },
          '[signals] library family data not whole',
        );
      } else {
        logger.error({ err, brandId, family: family.name }, '[signals] library family failed');
      }
    }
  }
  return { candidates, overflow, unreadKinds };
}

export { FAMILIES as LIBRARY_FAMILIES };
