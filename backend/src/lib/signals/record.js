/**
 * Signal recording (Action Center, observation layer).
 *
 * Converts what the production detectors already find into `signals` rows
 * with a lifecycle. Two inputs, one writer:
 *
 *  - the Daily Pulse metric engine's highlights and warnings (#540) — its
 *    thresholds ARE the noise control: a visibility wobble below the
 *    sharp-drop floor or a one-run citation blip never reaches this module;
 *  - open page-opportunity findings (#719), read from their table.
 *
 * Runs after every stamped daily tracking run, before and independent of the
 * pulse email's own gating — a brand with pulse emails off still gets
 * signals, because the observation layer is a product surface, not a
 * notification preference.
 *
 * Dedup: one row per ongoing condition, keyed by (brand, dedup_key). A
 * re-detection updates last_detected_at and the measured values. A RESOLVED
 * condition that fires again reopens as new; a DISMISSED one stays dismissed
 * — the user said "not relevant", and re-raising it nightly would teach them
 * to ignore the page.
 *
 * Resolution: persistent kinds (a drop, a surge, an open opportunity) are
 * auto-resolved when a run no longer detects them — the condition ended.
 * Event kinds (a first citation, a new engine appearance) describe moments;
 * they never auto-resolve and simply age until triaged.
 */

import { MAX_TARGET_IDS } from '../targetIds.js';
import supabaseAdmin from '../../config/supabase.js';
import { computePulseMetrics, LOST_CITATION_WINDOW_DAYS } from '../pulse/metrics.js';
import { lostCitationEvidence } from './lostCitationEvidence.js';
import { competitorEvidence } from './competitorEvidence.js';
import { mentionEvidence } from './mentionEvidence.js';
import { TRAFFIC_WINDOW_DAYS, trafficEvidence } from './trafficEvidence.js';
import { logger } from '../logger.js';
import { readAllRpcRows } from '../rpcPages.js';
import { resolve } from '../../config/actionEngine.js';
import { EXCLUSIVE_KIND_GROUPS, LIBRARY_KINDS } from './library/kinds.js';
import { libraryCandidates } from './library/detect.js';
import { newAiPlatformCandidates } from './trafficPlatforms.js';
import { notifyChatAgentsOfSignals } from '../chatAgents.js';

const DAY_MS = 86_400_000;

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

// What counts as a signal is decided in config/actionEngine.js (#818 phase
// 2.5), alongside every other threshold the engine judges by.
const { detection, library: libraryThresholds } = resolve();

/**
 * Library kinds that report a fall. Suppressed during a platform outage, when
 * a fall in collected answers is ours and not the brand's.
 */
const DECLINE_KINDS = new Set([
  'lost_mentions',
  'high_value_prompt_lost',
  'citation_at_risk',
  'topic_slipping',
  'topic_drop',
  'platform_slipping',
  'platform_drop',
  'page_citation_slipping',
  'owned_page_citation_lost',
]);

/**
 * Static knowledge per detector kind. Mirrored by the web registry
 * (frontend/src/lib/signals/registry.ts) which owns the display templates —
 * this side owns what gets STORED: category, impact, sources, KPI links,
 * and whether the condition persists.
 */
/**
 * The original detectors' kinds. The V1 library's forty-seven are in
 * library/kinds.js and merged below, so everything downstream — the recorder,
 * the registry checks, the web — treats them alike.
 */
const BASE_KINDS = {
  sharp_drop: {
    category: 'visibility',
    impact: 'high',
    kpiKeys: ['ai_visibility'],
    persistent: true,
  },
  // Early deterioration, the Protect family's trigger: a brand with a real
  // position losing ground, caught before it becomes the collapse above.
  // Medium rather than high — it is a warning, not an emergency, and filing
  // it as high would make both grades mean the same thing.
  visibility_slipping: {
    category: 'visibility',
    impact: 'medium',
    kpiKeys: ['ai_visibility'],
    persistent: true,
  },
  platform_gap: {
    category: 'visibility',
    impact: 'medium',
    kpiKeys: ['ai_visibility'],
    persistent: true,
  },
  competitor_citation_gap: {
    category: 'competitor',
    impact: 'medium',
    kpiKeys: ['citations', 'share_of_voice'],
    persistent: true,
  },
  prompt_gain: {
    category: 'visibility',
    impact: 'medium',
    kpiKeys: ['ai_visibility'],
    persistent: false,
  },
  new_engine: {
    category: 'visibility',
    impact: 'medium',
    kpiKeys: ['ai_visibility'],
    persistent: false,
  },
  lost_citations: {
    category: 'citation',
    impact: 'high',
    kpiKeys: ['citations'],
    persistent: true,
  },
  first_citation: {
    category: 'citation',
    impact: 'medium',
    kpiKeys: ['citations'],
    persistent: false,
  },
  competitor_surge: {
    category: 'competitor',
    impact: 'high',
    kpiKeys: ['share_of_voice'],
    persistent: true,
  },
  competitor_crossed: {
    category: 'competitor',
    impact: 'high',
    kpiKeys: ['share_of_voice', 'ai_visibility'],
    persistent: true,
  },
  competitor_overtaken: {
    category: 'competitor',
    impact: 'medium',
    kpiKeys: ['share_of_voice'],
    persistent: false,
  },
  page_opportunity: {
    category: 'traffic',
    impact: 'medium',
    kpiKeys: ['ai_referral_traffic'],
    persistent: true,
  },
  uncited_mentions: {
    category: 'mention',
    impact: 'medium',
    kpiKeys: ['citations', 'mentions'],
    persistent: true,
  },
  audit_low_score: {
    category: 'technical',
    impact: 'medium',
    kpiKeys: [],
    persistent: true,
  },
  // An AI platform started sending visits (AT-013): an event, like
  // new_engine, that no definition turns into work.
  ai_platform_new: {
    category: 'traffic',
    impact: 'medium',
    kpiKeys: ['ai_referral_traffic'],
    persistent: false,
  },
};

export const KIND_META = { ...BASE_KINDS, ...LIBRARY_KINDS };

/** Pulse highlight/warning → signal candidate. Returns null for entries that
 *  describe engine health rather than the brand (degraded platforms). */
function fromPulseEntry(entry) {
  const meta = KIND_META[entry.type];
  if (!meta) return null;

  const candidate = {
    kind: entry.type,
    dedupKey: entry.key,
    source: ['ai_results'],
    payload: {},
    previousValue: null,
    currentValue: null,
    changeValue: null,
  };

  switch (entry.type) {
    case 'sharp_drop':
    case 'visibility_slipping':
      candidate.previousValue = entry.from;
      candidate.currentValue = entry.to;
      candidate.changeValue = -entry.drop;
      break;
    case 'prompt_gain':
      // The prompt's id lives in the dedup key (prompt_gain:<id>); surfaced
      // in the payload so the drawer can link to the prompt itself.
      candidate.payload = { promptText: entry.promptText, promptId: entry.key.split(':')[1] };
      candidate.changeValue = entry.gain;
      break;
    case 'new_engine':
      candidate.payload = { platform: entry.platform };
      break;
    case 'lost_citations':
      candidate.payload = { promptText: entry.promptText, promptId: entry.key.split(':')[1] };
      break;
    case 'first_citation':
      candidate.payload = { url: entry.url, label: entry.label, promptText: entry.promptText };
      break;
    case 'competitor_surge':
      candidate.payload = { competitorName: entry.competitorName };
      candidate.previousValue = entry.from;
      candidate.currentValue = entry.to;
      candidate.changeValue = Math.round((entry.to - entry.from) * 10) / 10;
      break;
    case 'competitor_crossed':
    case 'competitor_overtaken':
      candidate.payload = {
        competitorName: entry.competitorName,
        competitorRate: entry.competitorRate,
        brandRate: entry.brandRate,
      };
      break;
    default:
      return null;
  }
  return candidate;
}

/**
 * Mentioned-but-never-cited (brief §10's headline mention signal), from the
 * same per-prompt aggregates the Prompts page reads. A prompt counts when
 * the window's answers mention the brand at least once and cite it never —
 * the brand is in the conversation but AI engines have nothing of its own
 * to point at. One consolidated signal (brief §29), not one per prompt.
 *
 * One row per prompt, read a page at a time past PostgREST's 1000-row cap.
 * Exported for the test that pins the paging behaviour.
 */
export async function uncitedMentionCandidates(brandId, now) {
  const from = new Date(now.getTime() - detection.windowDays * DAY_MS);
  const { data, error } = await readAllRpcRows('prompt_visibility_summaries', (start, end) =>
    supabaseAdmin
      .rpc('prompt_visibility_summaries', {
        p_brand_id: brandId,
        p_date_from: from.toISOString(),
        p_date_to: now.toISOString(),
      })
      .order('prompt_id', { ascending: true })
      .range(start, end),
  );
  if (error) throw new Error(error.message);

  // By id, not by row: a prompt repeated at a page boundary is still one prompt.
  const byPrompt = new Map();
  for (const row of data ?? []) {
    if (
      Number(row.runs) > 0 &&
      Number(row.total_mentions) > 0 &&
      Number(row.total_citations) === 0
    ) {
      byPrompt.set(row.prompt_id, row);
    }
  }
  // Most mentioned first: the prompts the panel describes are the first few.
  const uncited = [...byPrompt.values()].sort(
    (a, b) =>
      Number(b.total_mentions) - Number(a.total_mentions) ||
      String(a.prompt_id).localeCompare(String(b.prompt_id)),
  );
  if (uncited.length < detection.uncitedMinPrompts) return [];

  return [
    {
      kind: 'uncited_mentions',
      dedupKey: 'uncited_mentions',
      source: ['ai_results'],
      // Every uncited prompt, so the action counts and keeps them all (AC-009).
      payload: { promptIds: uncited.map((row) => row.prompt_id).slice(0, MAX_TARGET_IDS) },
      previousValue: null,
      currentValue: uncited.length,
      changeValue: null,
    },
  ];
}

/**
 * Low AEO readiness from Site Audit's stored scores (brief §12). Only the
 * LATEST completed audit of each URL speaks for it — an old bad score
 * followed by a good re-audit is a fixed page — and audits past the age cap
 * no longer describe the page at all.
 *
 * Consolidated into ONE signal per brand (§29): a brand that audits forty
 * weak pages has one condition, "audited pages score low", not forty rows
 * drowning every other category. The worst pages ride in the payload for
 * the drawer; the full list lives on the Site Audit page.
 */
export async function auditCandidates(brandId, now) {
  const since = new Date(now.getTime() - detection.auditMaxAgeDays * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('url, total_score, completed_at')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .not('total_score', 'is', null)
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const latestByUrl = new Map();
  for (const audit of data ?? []) {
    if (!latestByUrl.has(audit.url)) latestByUrl.set(audit.url, audit);
  }

  // Site Audit stores a score from 0 to 1; the threshold is out of 100.
  const low = [...latestByUrl.values()]
    .map((audit) => ({ url: audit.url, score: Number(audit.total_score) }))
    .filter((audit) => audit.score * 100 < detection.auditLowScore)
    .sort((a, b) => a.score - b.score);
  if (low.length === 0) return [];

  return [
    {
      kind: 'audit_low_score',
      dedupKey: 'audit_low_score',
      source: ['site_audit'],
      // The ten lowest to show; past them, every low page's address for the
      // action's count (AC-009), as group signals list theirs past 50.
      payload: {
        urls: low.slice(0, 10),
        ...(low.length > 10
          ? { targetIds: low.slice(0, MAX_TARGET_IDS).map((audit) => audit.url) }
          : {}),
      },
      previousValue: null,
      currentValue: low.length,
      changeValue: null,
    },
  ];
}

/** Open page-opportunity findings → signal candidates. */
async function pageOpportunityCandidates(brandId) {
  const { data, error } = await supabaseAdmin
    .from('page_opportunities')
    .select('landing_page, value_signal, value_rank, sessions, citation_state')
    .eq('brand_id', brandId)
    .is('resolved_at', null)
    .limit(1000);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    kind: 'page_opportunity',
    dedupKey: `page_opportunity:${row.landing_page}`,
    source: ['ga4', 'ai_results'],
    payload: {
      landingPage: row.landing_page,
      valueSignal: row.value_signal,
      valueRank: row.value_rank,
      citationState: row.citation_state,
    },
    previousValue: null,
    currentValue: row.sessions,
    changeValue: null,
  }));
}

/**
 * Detect and record signals for one brand. Best-effort by contract: callers
 * fire-and-forget, and a failure here must never affect the tracking run.
 */
/**
 * Whether a set of per-platform visibility rates describes a gap worth acting on.
 *
 * Platforms differ for everyone — the spread between a brand's best and worst
 * averages 12 points across live brands — so a gap alone is the normal state,
 * not news. Two conditions make it actionable together: the brand already
 * ranks well somewhere, which proves the content can rank, and it is
 * materially absent somewhere else. Without the first half a brand that is
 * weak everywhere would be told it has a platform opportunity, which is not
 * what the number means.
 *
 * Returns null when there is nothing to report.
 */
export function classifyPlatformGap(rates) {
  if (rates.length < detection.platformMinCompared) return null;

  const sorted = [...rates].sort((a, b) => b.rate - a.rate);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const points = Math.round((best.rate - worst.rate) * 10) / 10;

  if (best.rate < detection.platformBestFloor) return null;
  if (points < detection.platformGapPoints) return null;
  return { best, worst, points };
}

/**
 * Whether a competitor's citation lead is structural rather than a week's
 * variance.
 *
 * A competitor leads two thirds of brands on citations in any given week, so
 * "behind" is not the signal. Behind by a multiple is: it says the gap will
 * not close on its own, and that there is a body of citations to go after.
 * The absolute floor keeps the multiple honest — twice as many can mean four
 * against two, which is not a finding.
 */
export function classifyCitationGap({ brandCitations, leaderCitations }) {
  const absoluteGap = leaderCitations - brandCitations;
  if (absoluteGap < detection.citationGapMinAbsolute) return null;
  if (leaderCitations < brandCitations * detection.citationGapMultiple) return null;
  return { absoluteGap };
}

/**
 * A platform the brand ranks poorly on, when it ranks well on another.
 *
 * Platforms differ for everyone — the average spread between a brand's best
 * and worst platform is 12 points across live brands — so a gap on its own is
 * the normal state, not news. What makes it actionable is the pair: visibility
 * already proven achievable somewhere, and materially absent somewhere else.
 * Without the "proven" half a brand that is weak everywhere would be told it
 * has a platform opportunity, which is not what the number means.
 *
 * One signal per brand, naming the weakest platform. A brand behind on three
 * engines has one condition to work on, not three rows.
 */
/** Rows the platform comparison reads. Comfortably above the largest brand's
 *  7-day volume; reaching it means the comparison cannot be trusted. */
const PLATFORM_ROW_LIMIT = 20000;

async function platformGapCandidates(brandId) {
  const { data, error } = await supabaseAdmin
    .from('insights_prompt_daily')
    .select('model_used, prompt_id, has_mention, has_citation')
    .eq('brand_id', brandId)
    .gte('day', new Date(Date.now() - detection.windowDays * DAY_MS).toISOString().slice(0, 10))
    .limit(PLATFORM_ROW_LIMIT);
  if (error) throw new Error(error.message);

  // The ceiling is generous — the largest brand uses 8k of it — but a brand
  // that reaches it would have its platform rates computed from an arbitrary
  // subset, and report a gap that is an artefact of where the read stopped.
  // Say so rather than answer confidently from truncated data.
  if ((data ?? []).length >= PLATFORM_ROW_LIMIT) {
    logger.warn(
      { brandId, rows: data.length, limit: PLATFORM_ROW_LIMIT },
      '[signals] platform gap read hit its row ceiling — skipping rather than judging a subset',
    );
    return [];
  }

  const byPlatform = new Map();
  for (const row of data ?? []) {
    const entry = byPlatform.get(row.model_used) ?? { tracked: new Set(), visible: new Set() };
    entry.tracked.add(row.prompt_id);
    if (row.has_mention || row.has_citation) entry.visible.add(row.prompt_id);
    byPlatform.set(row.model_used, entry);
  }

  const rates = [...byPlatform.entries()]
    .filter(([, e]) => e.tracked.size >= detection.platformMinPrompts)
    .map(([platform, e]) => ({
      platform,
      rate: Math.round((e.visible.size / e.tracked.size) * 1000) / 10,
    }));
  if (rates.length < detection.platformMinCompared) return [];

  const gap = classifyPlatformGap(rates);
  if (!gap) return [];
  const { best, worst } = gap;

  return [
    {
      kind: 'platform_gap',
      dedupKey: `platform_gap:${worst.platform}`,
      source: ['ai_results'],
      payload: { platform: worst.platform, bestPlatform: best.platform, bestRate: best.rate },
      previousValue: best.rate,
      currentValue: worst.rate,
      changeValue: -gap.points,
    },
  ];
}

/**
 * A competitor cited far more often than the brand.
 *
 * Being behind on citations is ordinary — a competitor leads two thirds of
 * brands in any given week — so "behind" is not the signal. Being behind by a
 * multiple is: it says the gap is structural rather than a week's variance,
 * and that there is a body of citations to go after rather than a handful.
 * The absolute floor keeps it off brands where the multiple is arithmetic on
 * tiny numbers.
 */
async function competitorCitationGapCandidates(brandId, now) {
  // Read from the daily rollups, not the raw aggregate.
  //
  // #829 moved the pulse's wide windows off `ai_visibility_aggregates`
  // because it rescans a brand's entire history and crosses the database's 8s
  // statement timeout once a brand is large enough. This call site was missed,
  // and it is worse placed than the ones that were fixed: the pulse's helper
  // retries a timeout, this called the client directly, so the first timeout
  // threw and took the whole nightly pass with it. On the largest brand it did
  // so every night — 8.2s to fail here against 0.13s to succeed from the
  // rollup.
  const to = utcDay(now);
  const from = utcDay(new Date(now.getTime() - (detection.windowDays - 1) * DAY_MS));
  const { data, error } = await supabaseAdmin.rpc('ai_visibility_aggregates_daily', {
    p_brand_id: brandId,
    p_day_from: from,
    p_day_to: to,
  });
  if (error) throw new Error(error.message);

  const brandCitations = Number(data?.citation_answers ?? 0);
  const leader = (data?.by_competitor ?? []).reduce(
    (top, c) => (Number(c.citation_answers ?? 0) > Number(top?.citation_answers ?? -1) ? c : top),
    null,
  );
  if (!leader) return [];

  const leaderCitations = Number(leader.citation_answers ?? 0);
  const gap = classifyCitationGap({ brandCitations, leaderCitations });
  if (!gap) return [];

  return [
    {
      kind: 'competitor_citation_gap',
      dedupKey: `competitor_citation_gap:${leader.competitor_id}`,
      source: ['ai_results'],
      payload: { competitorName: leader.name, competitorCitations: leaderCitations },
      previousValue: leaderCitations,
      currentValue: brandCitations,
      changeValue: -gap.absoluteGap,
    },
  ];
}

const isOpen = (row) => row.status === 'new' || row.status === 'acknowledged';

/**
 * Over-cap findings that keep an open signal open. One with no open signal
 * behind it raises nothing: the cap bounds what a night writes, and a
 * resolved finding comes back only when it ranks again.
 */
export function overflowRefreshes(overflow, existing) {
  return overflow
    .map((candidate) => ({ candidate, current: existing.get(candidate.dedupKey) }))
    .filter(({ current }) => current && isOpen(current));
}

/** What a single-subject key is about: `topic_drop:<id>` → `<id>`. */
const subjectOf = (dedupKey) => {
  const at = dedupKey.indexOf(':');
  return at < 0 ? null : dedupKey.slice(at + 1);
};

const GROUP_OF = new Map(
  EXCLUSIVE_KIND_GROUPS.flatMap((group, i) => group.map((kind) => [kind, i])),
);

/**
 * A lost citation arrives from the pulse naming only its prompt. Before it is
 * written, it gets what the drawer shows (AC-001): the brand's page that was
 * cited and when, the platforms it was lost on, who is cited now, and its
 * cited days before and after. Best effort: without it the signal is still
 * true and is recorded as before.
 */
export async function attachLostCitationEvidence(brandId, candidates, now) {
  const lost = candidates.filter(
    (c) => c.kind === 'lost_citations' && typeof c.payload?.promptId === 'string',
  );
  if (lost.length === 0) return;
  try {
    const evidence = await lostCitationEvidence(
      brandId,
      lost.map((c) => c.payload.promptId),
      {
        now,
        windowDays: LOST_CITATION_WINDOW_DAYS,
        quietDays: detection.lostCitationQuietDays,
      },
    );
    for (const candidate of lost) {
      const found = evidence.get(candidate.payload.promptId);
      if (found) candidate.payload = { ...candidate.payload, ...found };
    }
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[signals] lost-citation evidence unavailable');
  }
}

// What each kind's evidence step writes, and the field that marks it written.
const EVIDENCE = {
  lost_citations: {
    marker: 'citedDays',
    fields: ['platforms', 'regions', 'citedDays', 'days', 'quietDays', 'lostUrls', 'citedNow'],
  },
};

// Signals about one competitor, which get its positions, winning sources and
// page events.
const COMPETITOR_KINDS = new Set([
  'competitor_leads',
  'competitor_momentum',
  'competitor_surge',
  'competitor_crossed',
  'competitor_overtaken',
  'competitor_citation_gap',
]);
for (const kind of COMPETITOR_KINDS) {
  EVIDENCE[kind] = {
    marker: 'positions',
    fields: ['positions', 'winningSources', 'pageEvents', 'pageEventDays'],
  };
}
EVIDENCE.uncited_mentions = { marker: 'mentions', fields: ['mentions'] };

// Signals about AI visits: to their pages, to one page, or to the whole site.
const TRAFFIC_PAGE_KINDS = new Set([
  'ai_traffic_slipping',
  'ai_traffic_drop',
  'ai_landing_page_winner',
  'ai_landing_underperforming',
  'converting_page_slipping',
]);
const TRAFFIC_SITE_KINDS = new Set(['cross_channel_risk', 'visibility_traffic_loss']);
for (const kind of [...TRAFFIC_PAGE_KINDS, ...TRAFFIC_SITE_KINDS, 'page_opportunity']) {
  EVIDENCE[kind] = {
    marker: 'referrals',
    fields: ['referrals', 'referralDays', 'citablePrompts', 'citablePromptsTotal'],
  };
}

/** Pages a traffic signal's referrals describe: its first ones. */
const TRAFFIC_PAGES_SHOWN = 5;

/** Prompts a traffic signal names it could be cited on. */
const CITABLE_PROMPTS_SHOWN = 10;

/**
 * A night whose evidence read failed refreshes a signal with its bare
 * detector payload. Keep what an earlier night recorded instead: it is older,
 * and still truer than nothing.
 */
export function keepRecordedEvidence(candidates, existing) {
  for (const candidate of candidates) {
    const evidence = EVIDENCE[candidate.kind];
    if (!evidence || evidence.marker in (candidate.payload ?? {})) continue;
    const recorded = existing.get(candidate.dedupKey)?.payload ?? {};
    if (!(evidence.marker in recorded)) continue;
    const kept = Object.fromEntries(
      evidence.fields.filter((key) => key in recorded).map((key) => [key, recorded[key]]),
    );
    candidate.payload = { ...candidate.payload, ...kept };
  }
}

/**
 * An uncited-mentions signal names its prompts and nothing about them. Before
 * it is written, its first prompts get what the drawer shows (AC-001): the
 * platforms, the brand's position, the answers' sentiment, and a quote of
 * the newest one. Best effort, like the other evidence.
 */
export async function attachMentionEvidence(brandId, candidates, now) {
  const uncited = candidates.filter(
    (c) => c.kind === 'uncited_mentions' && Array.isArray(c.payload?.promptIds),
  );
  for (const candidate of uncited) {
    try {
      const mentions = await mentionEvidence(brandId, candidate.payload.promptIds, {
        now,
        windowDays: detection.windowDays,
      });
      candidate.payload = { ...candidate.payload, mentions };
    } catch (err) {
      logger.warn({ brandId, err: err.message }, '[signals] mention evidence unavailable');
    }
  }
}

/** A traffic signal's pages, or its one; null for the site. */
function trafficPagesOf(candidate) {
  if (candidate.kind === 'page_opportunity') {
    const page = candidate.payload?.landingPage;
    return typeof page === 'string' && page ? [page] : [];
  }
  if (TRAFFIC_SITE_KINDS.has(candidate.kind)) return null;
  if (!TRAFFIC_PAGE_KINDS.has(candidate.kind)) return [];
  return (candidate.payload?.targets ?? [])
    .map((target) => target?.id)
    .filter((id) => typeof id === 'string' && id);
}

/** One traffic evidence read; null when it fails, which costs its signals only. */
async function readTraffic(brandId, pages, opts) {
  if (pages?.length === 0) return new Map();
  try {
    return await trafficEvidence(brandId, pages, opts);
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[signals] traffic evidence unavailable');
    return null;
  }
}

/**
 * Traffic signals arrive naming their pages and a session count. Before they
 * are written they get what the drawer shows (AC-001): for their first pages,
 * the AI visits by platform over the last two windows, and the prompts
 * naming any of their pages as the target. The detector's pages are matched
 * as written, so their numbers are the finding's; a page opportunity's path
 * as a path. Three reads at most, side by side. Best effort, like the other
 * evidence.
 */
export async function attachTrafficEvidence(brandId, candidates, now) {
  const onPages = candidates
    .map((candidate) => ({
      candidate,
      pages: trafficPagesOf(candidate),
      exact: TRAFFIC_PAGE_KINDS.has(candidate.kind),
    }))
    .filter(({ pages }) => pages?.length);
  const onSite = candidates.filter((candidate) => TRAFFIC_SITE_KINDS.has(candidate.kind));
  const pagesOf = (exact) => [
    ...new Set(onPages.filter((o) => o.exact === exact).flatMap((o) => o.pages)),
  ];

  const [asWritten, asPaths, site] = await Promise.all([
    readTraffic(brandId, pagesOf(true), { now, exact: true }),
    readTraffic(brandId, pagesOf(false), { now }),
    onSite.length ? readTraffic(brandId, null, { now }) : null,
  ]);

  for (const { candidate, pages, exact } of onPages) {
    const evidence = exact ? asWritten : asPaths;
    if (!evidence) continue;
    const found = pages.map((page) => evidence.get(page)).filter(Boolean);
    const prompts = [...new Map(found.flatMap((f) => f.prompts).map((p) => [p.id, p])).values()];
    candidate.payload = {
      ...candidate.payload,
      referrals: found.slice(0, TRAFFIC_PAGES_SHOWN).map((f) => f.referrals),
      referralDays: TRAFFIC_WINDOW_DAYS,
      citablePrompts: prompts.slice(0, CITABLE_PROMPTS_SHOWN),
      citablePromptsTotal: prompts.length,
    };
  }
  const whole = site?.get(null);
  if (whole) {
    for (const candidate of onSite) {
      candidate.payload = {
        ...candidate.payload,
        referrals: [whole.referrals],
        referralDays: TRAFFIC_WINDOW_DAYS,
      };
    }
  }
}

/** The competitor a signal is about: the library names it, the others key on it. */
function competitorOf(candidate) {
  const named = candidate.payload?.competitorId;
  if (typeof named === 'string' && named) return named;
  return subjectOf(candidate.dedupKey);
}

/**
 * Competitor signals arrive naming the competitor and one number. Before they
 * are written they get what the drawer shows (AC-001): per prompt and
 * platform, the competitor's position against the brand's, the sources
 * behind its wins, and what happened to its pages lately (learning C3).
 * Best effort, like the lost-citation evidence.
 */
export async function attachCompetitorEvidence(brandId, candidates, now) {
  const about = candidates
    .filter((c) => COMPETITOR_KINDS.has(c.kind))
    .map((candidate) => ({ candidate, id: competitorOf(candidate) }))
    .filter(({ id }) => id);
  if (about.length === 0) return;
  try {
    const evidence = await competitorEvidence(brandId, [...new Set(about.map(({ id }) => id))], {
      now,
      windowDays: libraryThresholds.windowDays,
    });
    for (const { candidate, id } of about) {
      const found = evidence.get(id);
      if (found) candidate.payload = { ...candidate.payload, competitorId: id, ...found };
    }
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[signals] competitor evidence unavailable');
  }
}

/**
 * Open, persistent signals nothing detected tonight, split by why.
 *
 * - `superseded`: the subject is still there under another kind of the same
 *   exclusive group — a topic that went from slipping to dropped. Closed now,
 *   naming what replaced it, so the list does not show the same topic twice
 *   and does not call a worsening "resolved".
 * - `resolved`: not detected at all, for longer than `resolveAfterHours`.
 *   One quiet night is not an ending: values near a threshold dip under it
 *   and back, and closing on the dip reopened the same signal a day later.
 *
 * `detected` must include over-cap findings: a finding that moved down a
 * list has not ended. A kind whose detector failed was not looked at, and a
 * condition nobody looked at has not ended either.
 */
export function signalsToResolve(existingRows, detected, unreadKinds, { now, graceHours }) {
  const detectedKeys = new Set(detected.map((candidate) => candidate.dedupKey));
  const detectedIn = new Map();
  for (const { kind, dedupKey } of detected) {
    const group = GROUP_OF.get(kind);
    const subject = subjectOf(dedupKey);
    if (group !== undefined && subject) detectedIn.set(`${group}|${subject}`, kind);
  }
  const cutoff = now.getTime() - graceHours * 60 * 60 * 1000;

  const superseded = [];
  const resolved = [];
  for (const row of existingRows) {
    if (!KIND_META[row.kind]?.persistent || !isOpen(row)) continue;
    if (detectedKeys.has(row.dedup_key) || unreadKinds.has(row.kind)) continue;

    const group = GROUP_OF.get(row.kind);
    const subject = subjectOf(row.dedup_key);
    const successor = group !== undefined && subject && detectedIn.get(`${group}|${subject}`);
    if (successor) {
      superseded.push({ row, by: successor });
    } else if (new Date(row.last_detected_at).getTime() < cutoff) {
      resolved.push(row);
    }
  }
  return { superseded, resolved };
}

export async function recordSignalsForBrand(brandId, { now = new Date() } = {}) {
  const metrics = await computePulseMetrics(brandId, {
    windowDays: detection.windowDays,
    now,
  });

  // No fresh results means the detectors saw nothing, not that every
  // condition ended — recording now would silently auto-resolve real
  // signals. Same for a platform outage, during which the engine already
  // suppresses drop/loss warnings: absence of a warning is not recovery.
  if ((metrics.kpis?.totalResults ?? 0) === 0) {
    logger.info({ brandId }, '[signals] skipped — no fresh results in window');
    return { skipped: 'no_fresh_results' };
  }
  const outage = (metrics.degradedPlatforms?.length ?? 0) > 0;

  const candidates = [];
  for (const entry of [...(metrics.highlights ?? []), ...(metrics.warnings ?? [])]) {
    const candidate = fromPulseEntry(entry);
    if (candidate) candidates.push(candidate);
  }
  await attachLostCitationEvidence(brandId, candidates, now);
  candidates.push(...(await pageOpportunityCandidates(brandId)));
  candidates.push(...(await uncitedMentionCandidates(brandId, now)));
  candidates.push(...(await auditCandidates(brandId, now)));
  candidates.push(...(await platformGapCandidates(brandId)));
  candidates.push(...(await competitorCitationGapCandidates(brandId, now)));
  candidates.push(...(await newAiPlatformCandidates(brandId, { now })));

  // The V1 definition library's detectors (#818). Isolated per family inside:
  // a read that fails costs that family's signals for the night, and its kinds
  // are reported unread so the resolution step below does not take the
  // silence for recovery.
  const library = await libraryCandidates(brandId, { now });
  // During a platform outage a fall is our collection, not the brand's
  // visibility — the same suppression the pulse applies to its own warnings.
  candidates.push(
    ...library.candidates.filter((candidate) => !(outage && DECLINE_KINDS.has(candidate.kind))),
  );
  const unreadKinds = library.unreadKinds;
  // Findings past their kind's cap: still true, so an open signal for one
  // stays open and is refreshed. Nothing new is raised from them, and a
  // resolved one is not reopened — that waits until it ranks again.
  const overflow = library.overflow.filter(
    (candidate) => !(outage && DECLINE_KINDS.has(candidate.kind)),
  );
  await attachCompetitorEvidence(brandId, [...candidates, ...overflow], now);
  await attachMentionEvidence(brandId, candidates, now);
  await attachTrafficEvidence(brandId, [...candidates, ...overflow], now);

  // Existing rows decide insert vs update vs reopen. A brand's signal set is
  // small (tens), so reading it whole is cheaper than being clever.
  const { data: existingRows, error: readErr } = await supabaseAdmin
    .from('signals')
    .select('id, dedup_key, kind, status, last_detected_at, payload')
    .eq('brand_id', brandId)
    .limit(1000);
  if (readErr) throw new Error(readErr.message);
  const existing = new Map((existingRows ?? []).map((row) => [row.dedup_key, row]));
  keepRecordedEvidence([...candidates, ...overflow], existing);

  const nowIso = now.toISOString();
  let inserted = 0;
  let refreshed = 0;
  let reopened = 0;

  for (const { candidate, current } of overflowRefreshes(overflow, existing)) {
    const { error } = await supabaseAdmin
      .from('signals')
      .update({
        last_detected_at: nowIso,
        previous_value: candidate.previousValue,
        current_value: candidate.currentValue,
        change_value: candidate.changeValue,
        payload: candidate.payload,
        updated_at: nowIso,
      })
      .eq('id', current.id);
    if (error) throw new Error(error.message);
    refreshed += 1;
  }

  for (const candidate of candidates) {
    const meta = KIND_META[candidate.kind];
    const current = existing.get(candidate.dedupKey);

    if (!current) {
      const { error } = await supabaseAdmin.from('signals').insert({
        brand_id: brandId,
        category: meta.category,
        kind: candidate.kind,
        impact: meta.impact,
        source: candidate.source,
        dedup_key: candidate.dedupKey,
        detected_at: nowIso,
        last_detected_at: nowIso,
        previous_value: candidate.previousValue,
        current_value: candidate.currentValue,
        change_value: candidate.changeValue,
        payload: candidate.payload,
        kpi_keys: meta.kpiKeys,
      });
      if (error) throw new Error(error.message);
      inserted += 1;
      continue;
    }

    if (current.status === 'dismissed') continue;

    const patch = {
      last_detected_at: nowIso,
      previous_value: candidate.previousValue,
      current_value: candidate.currentValue,
      change_value: candidate.changeValue,
      payload: candidate.payload,
      updated_at: nowIso,
    };
    if (current.status === 'resolved') {
      // The condition came back: this is a new observation, not a stale one.
      patch.status = 'new';
      patch.detected_at = nowIso;
      patch.resolved_at = null;
      reopened += 1;
    } else {
      refreshed += 1;
    }
    const { error } = await supabaseAdmin.from('signals').update(patch).eq('id', current.id);
    if (error) throw new Error(error.message);
  }

  // Persistent conditions this run no longer detects have ended — close
  // them. Not during an outage: the engine suppresses drop/loss warnings
  // while a platform is degraded, and treating that silence as recovery
  // would close real signals.
  const closing = outage
    ? { superseded: [], resolved: [] }
    : signalsToResolve(existingRows ?? [], [...candidates, ...overflow], unreadKinds, {
        now,
        graceHours: libraryThresholds.resolveAfterHours,
      });
  for (const row of closing.resolved) {
    const { error } = await supabaseAdmin
      .from('signals')
      .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
  }
  for (const { row, by } of closing.superseded) {
    const { error } = await supabaseAdmin
      .from('signals')
      .update({
        status: 'resolved',
        resolved_at: nowIso,
        updated_at: nowIso,
        payload: { ...(row.payload ?? {}), supersededBy: by },
      })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
  }

  const summary = {
    inserted,
    refreshed,
    reopened,
    autoResolved: closing.resolved.length,
    superseded: closing.superseded.length,
  };
  logger.info({ brandId, ...summary }, '[signals] recorded');
  // Chat's agents' Signal triggers read what this pass raised or reopened
  // (W2-16). Not awaited, and it never throws: a Chat agent never slows the pass.
  if (inserted + reopened > 0) void notifyChatAgentsOfSignals(brandId, nowIso);
  return summary;
}
