import type { Signal } from './map';
import { locationName, platformName } from './names';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { isLibrarySignalKind, type SignalCategory, type SignalKind } from './registry';
import { libraryTargetCount } from './display';
import { parseTimelineEvents, type CompetitorPageEvent } from '@/lib/competitorTimeline';

/**
 * What a signal's detail says, as data (AC-001): where it happened, what
 * changed, and what it rests on. The drawer renders it and the MCP
 * list_signals tool returns it, so both describe a signal the same way.
 *
 * Every number gets a metric, a role and a period, because the row's three
 * value columns mean different things per detector: for a source domain
 * "0 → 251 +167" is answers naming you, answers citing it and answers naming
 * only competitors, not a before and an after. A field the spec asks for
 * but no detector records yet is listed with no value, so the panel says
 * "Not available" rather than hiding the question.
 */

// ─── What changed ───────────────────────────────────────────────────────────

export type SignalMetric =
  /** Share of tracked prompts where the brand appears. */
  | 'visibility_rate'
  /** Share of answers naming the brand (or the competitor in `subject`). */
  | 'mention_rate'
  /** Share of a topic's prompts where the brand appears. */
  | 'coverage'
  /** Answers naming the brand, or the competitor in `subject`. */
  | 'mentions'
  /** Answers citing the brand, or the competitor in `subject`. */
  | 'citation_answers'
  /** Answers citing a source domain. */
  | 'answers_citing'
  | 'visibility_score'
  | 'ai_sessions'
  | 'search_clicks'
  | 'sessions'
  | 'engagement_rank'
  /** How many things a grouped finding covers. */
  | 'prompts'
  | 'pages'
  | 'queries'
  /** Result days on which an answer cited the brand. */
  | 'cited_days';

export type SignalUnit = 'percent' | 'points' | 'count' | 'rank';

export const METRIC_UNITS: Record<SignalMetric, SignalUnit> = {
  visibility_rate: 'percent',
  mention_rate: 'percent',
  coverage: 'percent',
  mentions: 'count',
  citation_answers: 'count',
  answers_citing: 'count',
  visibility_score: 'points',
  ai_sessions: 'count',
  search_clicks: 'count',
  sessions: 'count',
  engagement_rank: 'rank',
  prompts: 'count',
  pages: 'count',
  queries: 'count',
  cited_days: 'count',
};

/**
 * Whose or when a figure is. `before`/`after` are the two windows of a
 * week-over-week change; the others compare things inside one window, with
 * `subject` naming the competitor, platform or location.
 */
export type FigureRole =
  | 'before'
  | 'after'
  /** The earlier result days of a window, and its latest few. */
  | 'earlier'
  | 'latest'
  | 'change'
  | 'you'
  | 'competitor'
  | 'best'
  | 'this'
  | 'total'
  | 'naming_you'
  | 'competitors_only'
  | 'now';

export interface SignalFigure {
  metric: SignalMetric;
  role: FigureRole;
  value: number;
  /** The competitor's name, or the platform slug or location code compared. */
  subject?: string;
  subjectType?: 'competitor' | 'platform' | 'location';
  /** Out of how many, for a count of days: 9 of 11. */
  of?: number;
  /**
   * Its own window, where it differs from the change's: a cross-channel
   * finding sets 14 days of AI sessions beside 28 days of search clicks.
   */
  period?: ChangePeriod;
}

/**
 * The window the figures cover. The library's detectors read 7-day windows,
 * AI traffic 14 (server signals/trafficEvidence.js) and Search Console 28
 * (server signals/library/detect.js, `ctx.gsc`).
 */
export type ChangePeriod =
  | 'week_over_week'
  /** The AI-traffic detector's windows (server signals/trafficEvidence.js). */
  | 'fortnight_over_fortnight'
  /** The Search Console detector's windows. */
  | 'four_weeks_over_four_weeks'
  | 'last_7_days'
  | 'last_14_days'
  | 'last_fortnight'
  | 'last_four_weeks'
  /** The AI bot report's alert window (server 00185). */
  | 'last_30_days'
  | 'latest';

/** Days in each window of a before-and-after period: "previous 14 days". */
export const PERIOD_DAYS: Partial<Record<ChangePeriod, number>> = {
  week_over_week: 7,
  fortnight_over_fortnight: 14,
  four_weeks_over_four_weeks: 28,
};

export interface SignalChange {
  period: ChangePeriod;
  figures: SignalFigure[];
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** Kinds whose two values are one metric's previous and last window. */
const WEEK_OVER_WEEK: Partial<Record<SignalKind, SignalMetric>> = {
  sharp_drop: 'visibility_rate',
  visibility_slipping: 'visibility_rate',
  platform_slipping: 'mention_rate',
  platform_drop: 'mention_rate',
  topic_gap: 'coverage',
  topic_uncovered: 'coverage',
  topic_slipping: 'coverage',
  topic_drop: 'coverage',
  competitor_momentum: 'mentions',
  competitor_surge: 'mention_rate',
  ai_traffic_drop: 'ai_sessions',
  // The AI Traffic page's own visits, the last seven whole days against the
  // seven before (AT-013, server library/detect.js `ctx.weeklyVisits`).
  ai_visits_weekly_drop: 'ai_sessions',
  visibility_traffic_loss: 'ai_sessions',
  cross_channel_risk: 'ai_sessions',
};

// Compared over the last 14 days against the 14 before, not by week.
const AI_TRAFFIC_KINDS: ReadonlySet<string> = new Set([
  'ai_traffic_slipping',
  'ai_traffic_drop',
  'ai_landing_page_winner',
  'ai_landing_underperforming',
  'converting_page_slipping',
]);

// Page targets that carry their AI visits before and after: the 14-day kinds
// and the weekly drop (AT-013).
const VISIT_PAGE_KINDS: ReadonlySet<string> = new Set([
  ...AI_TRAFFIC_KINDS,
  'ai_visits_weekly_drop',
]);

// Compared over the last 28 days against the 28 before (`ctx.gsc`).
const SEARCH_CONSOLE_KINDS: ReadonlySet<string> = new Set([
  'gsc_demand_gap',
  'search_ai_misalignment',
  'gsc_low_ctr',
  'gsc_risk',
  'gsc_decline',
]);

const COUNTED: Record<string, SignalMetric> = {
  prompts: 'prompts',
  pages: 'pages',
  queries: 'queries',
};

/** The figures behind a signal, or null when its row records none. */
export function signalChange(signal: Signal): SignalChange | null {
  const p = signal.payload ?? {};
  const prev = signal.previousValue;
  const cur = signal.currentValue;
  const change = signal.changeValue;
  const competitor = str(p, 'competitorName') || undefined;

  const overTime = WEEK_OVER_WEEK[signal.kind];
  if (overTime && prev !== null && cur !== null) {
    // A competitor's own trend names the competitor; the brand's doesn't.
    const competitorOnly = overTime === 'mentions' || overTime === 'mention_rate';
    const about =
      competitor && competitorOnly
        ? { subject: competitor, subjectType: 'competitor' as const }
        : {};
    const figures: SignalFigure[] = [
      { metric: overTime, role: 'before', value: prev, ...about },
      { metric: overTime, role: 'after', value: cur, ...about },
    ];
    // The cross-channel findings say what fell beside the AI sessions, each
    // over the window it was read in: Search Console's 28 days, or the
    // library's 7 for mentions (`ctx.dimensions`).
    if (signal.kind === 'cross_channel_risk') {
      const period = 'four_weeks_over_four_weeks';
      figures.push(
        { metric: 'search_clicks', role: 'before', value: Number(p.clicksBefore ?? 0), period },
        { metric: 'search_clicks', role: 'after', value: Number(p.clicksNow ?? 0), period },
      );
    }
    if (signal.kind === 'visibility_traffic_loss') {
      const period = 'week_over_week';
      figures.push(
        { metric: 'mentions', role: 'before', value: Number(p.mentionsBefore ?? 0), period },
        { metric: 'mentions', role: 'after', value: Number(p.mentionsNow ?? 0), period },
      );
    }
    return {
      // AI sessions are read over 14 days (`ctx.traffic`), the weekly drop's
      // over seven.
      period:
        overTime === 'ai_sessions' && signal.kind !== 'ai_visits_weekly_drop'
          ? 'fortnight_over_fortnight'
          : 'week_over_week',
      figures,
    };
  }

  switch (signal.kind) {
    case 'lost_citations': {
      // Recorded with the evidence (server signals/lostCitationEvidence.js):
      // cited on `citedDays` of the `days` earlier result days, on none of
      // the latest `quietDays`.
      const { citedDays, days, quietDays } = p;
      if (typeof citedDays !== 'number' || typeof days !== 'number') return null;
      return {
        period: 'last_14_days',
        figures: [
          { metric: 'cited_days', role: 'earlier', value: citedDays, of: days },
          {
            metric: 'cited_days',
            role: 'latest',
            value: 0,
            of: typeof quietDays === 'number' ? quietDays : 0,
          },
        ],
      };
    }
    case 'platform_gap':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'visibility_rate',
            role: 'best',
            value: prev,
            subject: str(p, 'bestPlatform'),
            subjectType: 'platform',
          },
          {
            metric: 'visibility_rate',
            role: 'this',
            value: cur,
            subject: str(p, 'platform'),
            subjectType: 'platform',
          },
        ],
      };
    case 'country_gap':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'mention_rate',
            role: 'best',
            value: prev,
            subject: str(p, 'bestRegion'),
            subjectType: 'location',
          },
          {
            metric: 'mention_rate',
            role: 'this',
            value: cur,
            subject: str(p, 'region'),
            subjectType: 'location',
          },
        ],
      };
    case 'competitor_leads':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'mentions',
            role: 'competitor',
            value: cur,
            subject: competitor,
            subjectType: 'competitor',
          },
          { metric: 'mentions', role: 'you', value: prev },
        ],
      };
    case 'competitor_citation_gap':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'citation_answers',
            role: 'competitor',
            value: prev,
            subject: competitor,
            subjectType: 'competitor',
          },
          { metric: 'citation_answers', role: 'you', value: cur },
        ],
      };
    case 'competitor_crossed':
    case 'competitor_overtaken':
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'mention_rate',
            role: 'competitor',
            value: Number(p.competitorRate ?? 0),
            subject: competitor,
            subjectType: 'competitor',
          },
          { metric: 'mention_rate', role: 'you', value: Number(p.brandRate ?? 0) },
        ],
      };
    case 'prompt_gain':
      if (change === null) return null;
      return {
        period: 'week_over_week',
        figures: [{ metric: 'visibility_score', role: 'change', value: change }],
      };
    case 'page_opportunity': {
      const figures: SignalFigure[] = [];
      if (typeof p.valueRank === 'number') {
        figures.push({ metric: 'engagement_rank', role: 'now', value: p.valueRank });
      }
      if (cur !== null) figures.push({ metric: 'sessions', role: 'now', value: cur });
      return figures.length ? { period: 'latest', figures } : null;
    }
    case 'uncited_mentions':
      return cur === null
        ? null
        : { period: 'last_7_days', figures: [{ metric: 'prompts', role: 'total', value: cur }] };
    // Its first week's AI visits (AT-013).
    case 'ai_platform_new':
      return cur === null
        ? null
        : {
            period: 'last_7_days',
            figures: [{ metric: 'ai_sessions', role: 'now', value: cur }],
          };
    case 'audit_low_score':
      return cur === null
        ? null
        : { period: 'latest', figures: [{ metric: 'pages', role: 'total', value: cur }] };
  }

  if (!isLibrarySignalKind(signal.kind)) return null;
  const entity = str(p, 'entity');
  // Answers citing a source domain: all of them, those naming the brand, and
  // those naming only competitors (ae_citation_sources).
  if (entity === 'sources' && cur !== null) {
    return {
      period: 'last_7_days',
      figures: [
        { metric: 'answers_citing', role: 'total', value: cur },
        { metric: 'answers_citing', role: 'naming_you', value: prev ?? 0 },
        { metric: 'answers_citing', role: 'competitors_only', value: change ?? 0 },
      ],
    };
  }
  // A competitor's topic finding counts the topic's tracked prompts.
  if (entity === 'topics' && prev === null && cur !== null) {
    return { period: 'last_7_days', figures: [{ metric: 'prompts', role: 'total', value: cur }] };
  }
  const counted = COUNTED[entity];
  if (counted && cur !== null) {
    const period: ChangePeriod = AI_TRAFFIC_KINDS.has(signal.kind)
      ? 'last_fortnight'
      : SEARCH_CONSOLE_KINDS.has(signal.kind)
        ? 'last_four_weeks'
        : signal.kind === 'cited_page_uncrawled'
          ? 'last_30_days'
          : 'last_7_days';
    return { period, figures: [{ metric: counted, role: 'total', value: cur }] };
  }
  return null;
}

// ─── Where ──────────────────────────────────────────────────────────────────

export type WhereFieldKey =
  | 'scope'
  | 'prompt'
  | 'prompts'
  | 'topic'
  | 'platforms'
  | 'locations'
  /** Where the signal's prompts are tracked, which can be wider than where it happened. */
  | 'trackedOn'
  | 'trackedIn'
  | 'domain'
  | 'competitor'
  | 'url'
  | 'pages'
  | 'queries'
  | 'engagementRank'
  | 'lostUrl'
  | 'citedNow'
  | 'exampleUrls'
  | 'competitorsNamed'
  | 'bestPage'
  | 'position'
  | 'sentiment'
  | 'excerpt'
  | 'aiReferrals'
  | 'citablePrompts'
  | 'issue'
  | 'crawlers'
  | 'evidence'
  | 'competitorPositions'
  | 'winningSources'
  /** What happened to a competitor's pages lately (learning C3). */
  | 'competitorPageEvents'
  /** Per prompt: platforms, position, sentiment and a quote, for mentions. */
  | 'mentionDetails';

export type WhereValue =
  | { type: 'text'; text: string }
  | { type: 'scope'; scope: 'all_prompts' | 'site' | 'topic' | 'platform' | 'location' | 'prompt' }
  | { type: 'prompt'; id: string | null; text: string }
  | { type: 'prompts'; items: { id: string | null; text: string }[]; total: number }
  | { type: 'list'; items: string[]; total: number }
  | { type: 'platforms'; slugs: readonly string[] }
  /** Every tracked platform: a finding about the whole brand or a location. */
  | { type: 'all_platforms' }
  /** Cited pages: the brand's lost ones, or those cited in their place. */
  | { type: 'citations'; items: CitedPage[] }
  /** A competitor's position against the brand's, per prompt and platform. */
  | { type: 'positions'; competitor: string; items: PromptPosition[] }
  /** Domains cited in the answers a competitor wins. */
  | { type: 'sources'; items: WinningSource[] }
  /**
   * A competitor's pages first cited in the brand's answers or changed in
   * the last `days` (learning C3), newest first; none is a finding too.
   */
  | {
      type: 'pageEvents';
      competitorId: string | null;
      items: CompetitorPageEvent[];
      days: number;
    }
  /** The brand's mentions on each prompt: where, how high, in what tone. */
  | { type: 'mentions'; items: PromptMention[] }
  /** What each failed audit check found, page by page. */
  | { type: 'issues'; items: PageIssue[] }
  /** AI crawlers by robots.txt user agent (`gptbot`). */
  | { type: 'crawlers'; agents: string[] }
  /**
   * AI-traffic pages: their sessions and, from Analytics, what their AI
   * visitors did; `metrics` are those the signal's kind is about.
   */
  | {
      type: 'trafficPages';
      items: TrafficPage[];
      total: number;
      metrics: TrafficMetric[];
      siteEngagedRate: number | null;
      siteKeyRate: number | null;
    }
  /** AI visits by platform, per page or for the site, over two windows of `days`. */
  | { type: 'referrals'; items: PageReferrals[]; days: number }
  | { type: 'locations'; codes: readonly string[] }
  | { type: 'number'; value: number };

export interface CitedPage {
  url: string;
  /** Its position among the answer's citations, 1 first. */
  position: number | null;
  lastCitedAt?: string;
  answers?: number;
  /** Of how many answers read back: a sample of the quiet days' answers. */
  answersRead?: number;
}

function citedPages(value: unknown): CitedPage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.url === 'string')
    .map((v) => ({
      url: v.url as string,
      position: typeof v.position === 'number' ? v.position : null,
      ...(typeof v.lastCitedAt === 'string' ? { lastCitedAt: v.lastCitedAt } : {}),
      ...(typeof v.answers === 'number' ? { answers: v.answers } : {}),
      ...(typeof v.answersRead === 'number' ? { answersRead: v.answersRead } : {}),
    }));
}

/** Positions are averages over the week's answers (1 = named first); null when not named. */
export interface PromptPosition {
  promptId: string;
  promptText: string;
  platform: string;
  competitor: { now: number | null; before: number | null };
  you: { now: number | null; before: number | null };
}

export interface PromptMention {
  promptId: string;
  promptText: string;
  platforms: string[];
  answers: number;
  /** Median position among the brands named, 1 first; null when not ranked. */
  position: number | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  /** A quote of the newest answer around the mention, and where it came from. */
  excerpt: string | null;
  excerptPlatform: string | null;
  excerptAt: string | null;
}

const SENTIMENTS = new Set(['positive', 'neutral', 'negative']);

function promptMentions(value: unknown): PromptMention[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.promptId === 'string')
    .map((v) => ({
      promptId: v.promptId as string,
      promptText: typeof v.promptText === 'string' ? v.promptText : '',
      platforms: Array.isArray(v.platforms)
        ? v.platforms.filter((x): x is string => typeof x === 'string')
        : [],
      answers: num(v.answers) ?? 0,
      position: num(v.position),
      sentiment: SENTIMENTS.has(v.sentiment as string)
        ? (v.sentiment as PromptMention['sentiment'])
        : null,
      excerpt: typeof v.excerpt === 'string' && v.excerpt ? v.excerpt : null,
      excerptPlatform: typeof v.excerptPlatform === 'string' ? v.excerptPlatform : null,
      excerptAt: typeof v.excerptAt === 'string' ? v.excerptAt : null,
    }));
}

/** A failed audit check on a page, with the check's own evidence. */
export interface PageIssue {
  page: string;
  check: string;
  label: string;
  evidence: Record<string, unknown>;
}

/**
 * The failed checks on each page. Findings recorded before the checks'
 * evidence name the checks only: their key stands in for the label.
 */
function pageIssues(targets: Target[]): PageIssue[] {
  return targets.flatMap((t) => {
    const page = label(t);
    const issues: Record<string, unknown>[] = Array.isArray(t.issues)
      ? t.issues
      : Array.isArray(t.checks)
        ? t.checks.map((check: unknown) => ({ check }))
        : [];
    return issues
      .filter((i) => typeof i?.check === 'string')
      .map((i) => ({
        page,
        check: i.check as string,
        label: typeof i.label === 'string' ? i.label : (i.check as string),
        evidence:
          i.evidence && typeof i.evidence === 'object'
            ? (i.evidence as Record<string, unknown>)
            : {},
      }));
  });
}

/**
 * The AI crawlers robots.txt blocks, from the bot check's evidence. Audits
 * from before it named them only say some bot is blocked, among bots it may
 * allow, so they name none.
 */
function blockedCrawlers(issues: PageIssue[]): string[] {
  const agents = issues
    .filter((i) => i.check === 'ai-bot-access')
    .flatMap((i) => (Array.isArray(i.evidence.blockedBots) ? i.evidence.blockedBots : []))
    .filter((a): a is string => typeof a === 'string');
  return [...new Set(agents)];
}

/** A page's AI sessions, and from Analytics what its AI visitors did. */
export interface TrafficPage {
  page: string;
  /** AI sessions now and in the window before; null when not recorded. */
  sessions: number | null;
  before: number | null;
  /** Engaged sessions' share, 0–1; null without Analytics. */
  engagedRate: number | null;
  /** Key events per session (can pass 1); null without Analytics. */
  keyRate: number | null;
  keyEvents: number | null;
  keyEventsBefore: number | null;
}

export type TrafficMetric = 'engagement' | 'keyEvents' | 'keyRate';

// What each AI-traffic finding was raised on, beside the sessions
// (server signals/library/classify.js classifyTrafficPage).
const TRAFFIC_METRICS: Record<string, TrafficMetric[]> = {
  ai_landing_underperforming: ['engagement'],
  ai_landing_page_winner: ['keyEvents', 'keyRate'],
  converting_page_slipping: ['keyEvents'],
};

function trafficPages(targets: Target[]): TrafficPage[] {
  return targets.map((t) => ({
    page: label(t),
    sessions: num(t.now),
    before: num(t.before),
    engagedRate: num(t.engagedRate),
    keyRate: num(t.keyRate),
    keyEvents: num(t.keyEvents),
    keyEventsBefore: num(t.keyEventsBefore),
  }));
}

/** A page's AI visits (the site's, with no page) by referring platform. */
export interface PageReferrals {
  page: string | null;
  /** Where they were counted: Analytics, or the tracking snippet without it. */
  source: 'analytics' | 'snippet' | null;
  sessions: number;
  before: number;
  /** By the referrer's platform (`chatgpt.com`), most visits first. */
  platforms: { platform: string; sessions: number; before: number }[];
}

function pageReferrals(value: unknown): PageReferrals[] {
  if (!Array.isArray(value)) return [];
  const count = (v: unknown) => (typeof v === 'number' ? v : 0);
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      page: typeof r.page === 'string' ? r.page : null,
      source: r.source === 'analytics' || r.source === 'snippet' ? r.source : null,
      sessions: count(r.sessions),
      before: count(r.before),
      platforms: (Array.isArray(r.platforms) ? r.platforms : [])
        .filter((p): p is Record<string, unknown> => typeof p?.platform === 'string')
        .map((p) => ({
          platform: p.platform as string,
          sessions: count(p.sessions),
          before: count(p.before),
        })),
    }));
}

export interface WinningSource {
  domain: string;
  /** Answers it is cited in, of the answers read that the competitor wins. */
  answers: number;
  answersRead: number;
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function promptPositions(value: unknown): PromptPosition[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.promptId === 'string')
    .map((v) => {
      const competitor = (v.competitor ?? {}) as Record<string, unknown>;
      const you = (v.you ?? {}) as Record<string, unknown>;
      return {
        promptId: v.promptId as string,
        promptText: typeof v.promptText === 'string' ? v.promptText : '',
        platform: typeof v.platform === 'string' ? v.platform : '',
        competitor: { now: num(competitor.now), before: num(competitor.before) },
        you: { now: num(you.now), before: num(you.before) },
      };
    });
}

function winningSourcesOf(value: unknown): WinningSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.domain === 'string')
    .map((v) => ({
      domain: v.domain as string,
      answers: num(v.answers) ?? 0,
      answersRead: num(v.answersRead) ?? 0,
    }));
}

export interface WhereField {
  key: WhereFieldKey;
  /** Null when no detector records it yet: the panel says "Not available". */
  value: WhereValue | null;
}

// Signals about one of the brand's own citations going away.
const CITATION_LOSS: readonly SignalKind[] = [
  'lost_citations',
  'citation_at_risk',
  'page_citation_slipping',
  'owned_page_citation_lost',
];

// What the spec asks each panel to answer, per category (AC-001's table).
// The fields a signal's data can fill come first in each list.
const LAYOUT: Record<SignalCategory, WhereFieldKey[]> = {
  visibility: ['scope', 'prompt', 'prompts', 'topic', 'platforms', 'locations', 'queries'],
  citation: [
    'domain',
    'prompt',
    'prompts',
    'topic',
    'platforms',
    'locations',
    'url',
    'exampleUrls',
    'competitorsNamed',
    'bestPage',
  ],
  mention: [
    'prompt',
    'prompts',
    'platforms',
    'locations',
    'mentionDetails',
    'position',
    'sentiment',
    'excerpt',
  ],
  traffic: ['scope', 'url', 'pages', 'queries', 'engagementRank', 'aiReferrals', 'citablePrompts'],
  technical: ['url', 'pages', 'issue', 'evidence'],
  competitor: [
    'competitor',
    'domain',
    'topic',
    'prompts',
    'queries',
    'platforms',
    'competitorPositions',
    'winningSources',
    'competitorPageEvents',
  ],
};

// Only a blocked crawler has crawlers to name; another technical issue has none.
const CRAWLER_LAYOUT: WhereFieldKey[] = ['pages', 'issue', 'crawlers', 'evidence'];

// A site-wide traffic finding has no page to cite: where its AI visits come from.
const SITE_TRAFFIC_LAYOUT: WhereFieldKey[] = ['scope', 'aiReferrals'];

// The AI Traffic page's own findings (AT-013): broken AI links, and cited
// pages no AI search bot read. They name pages, not anything Site Audit checked.
const AI_TRAFFIC_PAGE_FINDINGS: readonly SignalKind[] = [
  'broken_citation_target',
  'cited_page_uncrawled',
];
const AI_TRAFFIC_PAGES_LAYOUT: WhereFieldKey[] = ['pages'];

// A platform that started sending AI visits: its title names it.
const NEW_AI_PLATFORM_LAYOUT: WhereFieldKey[] = ['scope'];

// A first citation is a gain: the page and the prompt, not who replaced it.
const FIRST_CITATION_LAYOUT: WhereFieldKey[] = ['url', 'prompt', 'platforms', 'locations'];

const CITATION_LOSS_LAYOUT: WhereFieldKey[] = [
  'prompt',
  'prompts',
  'topic',
  'pages',
  'platforms',
  'locations',
  'lostUrl',
  'citedNow',
];

// A field that only some signals of a category have is shown when it has a
// value; the spec's required fields are shown either way.
const OPTIONAL: ReadonlySet<WhereFieldKey> = new Set([
  'mentionDetails',
  'scope',
  'prompt',
  'prompts',
  'topic',
  'domain',
  'url',
  'pages',
  'queries',
  'locations',
  'engagementRank',
  'issue',
]);

interface Target {
  id?: unknown;
  label?: unknown;
  competitor?: unknown;
  checks?: unknown;
  issues?: unknown;
  page?: unknown;
  before?: unknown;
  now?: unknown;
  engagedRate?: unknown;
  keyRate?: unknown;
  keyEvents?: unknown;
  keyEventsBefore?: unknown;
}

function targetsOf(signal: Signal): Target[] {
  const targets = signal.payload?.targets;
  return Array.isArray(targets) ? (targets as Target[]) : [];
}

function label(target: Target): string {
  if (typeof target.label === 'string' && target.label) return target.label;
  if (typeof target.page === 'string') return target.page;
  return typeof target.id === 'string' ? target.id : '';
}

function fieldValue(signal: Signal, key: WhereFieldKey): WhereValue | null {
  const p = signal.payload ?? {};
  const entity = str(p, 'entity');
  const targets = targetsOf(signal);
  // A grouped finding names the first 50 of its targets; the count is all.
  const total = libraryTargetCount(signal, targets);

  switch (key) {
    case 'scope': {
      if (signal.kind === 'sharp_drop' || signal.kind === 'visibility_slipping') {
        return { type: 'scope', scope: 'all_prompts' };
      }
      if (isSiteWide(signal)) return { type: 'scope', scope: 'site' };
      if (entity === 'topics') return { type: 'scope', scope: 'topic' };
      if (
        entity === 'platforms' ||
        signal.kind === 'platform_gap' ||
        signal.kind === 'new_engine' ||
        signal.kind === 'ai_platform_new'
      ) {
        return { type: 'scope', scope: 'platform' };
      }
      if (entity === 'regions') return { type: 'scope', scope: 'location' };
      if (str(p, 'promptId') || entity === 'prompts') return { type: 'scope', scope: 'prompt' };
      return null;
    }
    case 'prompt': {
      const text = str(p, 'promptText');
      if (!text) return null;
      return { type: 'prompt', id: str(p, 'promptId') || null, text };
    }
    case 'prompts': {
      if (entity === 'topics' && typeof p.prompts === 'number') {
        return { type: 'prompts', items: [], total: p.prompts };
      }
      if (entity !== 'prompts' || targets.length === 0) {
        const ids = Array.isArray(p.promptIds) ? p.promptIds : [];
        return ids.length > 0
          ? { type: 'prompts', items: [], total: Number(signal.currentValue ?? ids.length) }
          : null;
      }
      return {
        type: 'prompts',
        items: targets.map((t) => ({
          id: typeof t.id === 'string' ? t.id : null,
          text: label(t),
        })),
        total,
      };
    }
    case 'topic': {
      if (entity === 'topics') {
        const name = label(targets[0] ?? {});
        return name ? { type: 'text', text: name } : null;
      }
      const topics = signal.where.topics;
      if (topics.length > 1) return { type: 'list', items: [...topics], total: topics.length };
      return topics[0] ? { type: 'text', text: topics[0] } : null;
    }
    case 'platforms': {
      // Recorded evidence says where it happened: the platforms a competitor
      // leads on, or those whose answers name the brand without citing it.
      const recorded = [
        ...new Set([
          ...promptPositions(p.positions).map((row) => row.platform),
          ...promptMentions(p.mentions).flatMap((m) => m.platforms),
        ]),
      ].filter(Boolean);
      if (recorded.length) return { type: 'platforms', slugs: recorded };
      if (signal.where.platforms.length) {
        return { type: 'platforms', slugs: signal.where.platforms };
      }
      if (
        signal.kind === 'sharp_drop' ||
        signal.kind === 'visibility_slipping' ||
        entity === 'regions'
      ) {
        return { type: 'all_platforms' };
      }
      return null;
    }
    case 'locations':
      return signal.where.regions.length
        ? { type: 'locations', codes: signal.where.regions }
        : null;
    case 'domain': {
      const domain = str(p, 'domain');
      return domain ? { type: 'text', text: domain } : null;
    }
    case 'competitor': {
      const named = str(p, 'competitorName');
      if (named) return { type: 'text', text: named };
      const leaders = [
        ...new Set(targets.map((t) => (typeof t.competitor === 'string' ? t.competitor : ''))),
      ].filter(Boolean);
      return leaders.length ? { type: 'list', items: leaders, total: leaders.length } : null;
    }
    case 'url': {
      const url = str(p, 'landingPage') || str(p, 'url');
      return url ? { type: 'text', text: url } : null;
    }
    case 'pages': {
      if (VISIT_PAGE_KINDS.has(signal.kind) && targets.length && !isSiteWide(signal)) {
        return {
          type: 'trafficPages',
          items: trafficPages(targets),
          // A drop's value is the site's visits; its pages are counted apart
          // (`pageCount`, read by libraryTargetCount).
          total,
          metrics: TRAFFIC_METRICS[signal.kind] ?? [],
          siteEngagedRate: num(p.siteEngagedRate),
          siteKeyRate: num(p.siteKeyRate),
        };
      }
      if (entity === 'pages' && targets.length && targets[0]?.id !== 'site') {
        return { type: 'list', items: targets.map(label), total };
      }
      const urls = Array.isArray(p.urls) ? (p.urls as { url?: unknown }[]) : [];
      const items = urls.map((u) => (typeof u.url === 'string' ? u.url : '')).filter(Boolean);
      return items.length ? { type: 'list', items, total: Math.max(items.length, total) } : null;
    }
    case 'queries':
      return entity === 'queries' && targets.length
        ? { type: 'list', items: targets.map(label), total }
        : null;
    case 'engagementRank':
      return typeof p.valueRank === 'number' ? { type: 'number', value: p.valueRank } : null;
    case 'lostUrl': {
      const lost = citedPages(p.lostUrls);
      if (lost.length) return { type: 'citations', items: lost };
      // An owned page that stopped being cited is the lost URL itself.
      return signal.kind === 'owned_page_citation_lost' && targets.length
        ? { type: 'list', items: targets.map(label), total }
        : null;
    }
    case 'citedNow': {
      const now = citedPages(p.citedNow);
      return now.length ? { type: 'citations', items: now } : null;
    }
    case 'competitorPositions': {
      const rows = promptPositions(p.positions);
      return rows.length
        ? { type: 'positions', competitor: str(p, 'competitorName'), items: rows }
        : null;
    }
    case 'mentionDetails': {
      const mentions = promptMentions(p.mentions);
      return mentions.length ? { type: 'mentions', items: mentions } : null;
    }
    case 'winningSources': {
      const sources = winningSourcesOf(p.winningSources);
      return sources.length ? { type: 'sources', items: sources } : null;
    }
    case 'competitorPageEvents': {
      // Read with the positions: none recorded means not looked at, not none.
      if (!Array.isArray(p.pageEvents)) return null;
      return {
        type: 'pageEvents',
        competitorId: str(p, 'competitorId') || null,
        items: parseTimelineEvents(p.pageEvents as Record<string, unknown>[]),
        days: typeof p.pageEventDays === 'number' ? p.pageEventDays : 28,
      };
    }
    case 'aiReferrals': {
      const items = pageReferrals(p.referrals);
      return items.length
        ? {
            type: 'referrals',
            items,
            days: typeof p.referralDays === 'number' ? p.referralDays : 14,
          }
        : null;
    }
    case 'citablePrompts': {
      // Read with the referrals: none recorded means not looked at, not none.
      if (!Array.isArray(p.citablePrompts)) return null;
      const items = (p.citablePrompts as Record<string, unknown>[])
        .filter((q) => typeof q?.text === 'string')
        .map((q) => ({ id: typeof q.id === 'string' ? q.id : null, text: q.text as string }));
      const recorded = p.citablePromptsTotal;
      return {
        type: 'prompts',
        items,
        total: typeof recorded === 'number' ? recorded : items.length,
      };
    }
    case 'issue': {
      const labels = [...new Set(pageIssues(targets).map((i) => i.label))];
      return labels.length ? { type: 'list', items: labels, total: labels.length } : null;
    }
    case 'crawlers': {
      const agents = blockedCrawlers(pageIssues(targets));
      return agents.length ? { type: 'crawlers', agents } : null;
    }
    case 'evidence': {
      const issues = pageIssues(targets);
      return issues.length ? { type: 'issues', items: issues } : null;
    }
    default:
      return null;
  }
}

// A place the payload names is where the signal happened; one read from its
// prompts is where those are tracked, and is labelled so.
const TRACKED: Partial<Record<WhereFieldKey, WhereFieldKey>> = {
  platforms: 'trackedOn',
  locations: 'trackedIn',
};

/**
 * Whether a signal's platforms and its locations say where it happened, each
 * on its own: a lost citation records both, a competitor's positions and a
 * mention's evidence record platforms only, so their locations are still
 * where the prompts are tracked.
 */
function namedPlaces(signal: Signal): { platforms: boolean; locations: boolean } {
  const p = signal.payload ?? {};
  const some = (value: unknown) => Array.isArray(value) && value.length > 0;
  const lost = some(p.platforms);
  return {
    platforms:
      typeof p.platform === 'string' ||
      typeof p.region === 'string' ||
      lost ||
      some(p.positions) ||
      some(p.mentions),
    locations: typeof p.platform === 'string' || typeof p.region === 'string' || lost,
  };
}

/** A finding about the whole site rather than some of its pages. */
function isSiteWide(signal: Signal): boolean {
  const p = signal.payload ?? {};
  const targets = Array.isArray(p.targets) ? (p.targets as Target[]) : [];
  return str(p, 'entity') === 'pages' && targets[0]?.id === 'site';
}

/** The Where block: the spec's fields for this signal, each with its value or none. */
/** One of a signal's where fields, whatever its category's panel shows (AC-003). */
export function signalWhereValue(signal: Signal, key: WhereFieldKey): WhereValue | null {
  return fieldValue(signal, key);
}

export function signalWhereFields(signal: Signal): WhereField[] {
  const layout =
    signal.kind === 'first_citation'
      ? FIRST_CITATION_LAYOUT
      : signal.kind === 'crawler_blocked'
        ? CRAWLER_LAYOUT
        : CITATION_LOSS.includes(signal.kind)
          ? CITATION_LOSS_LAYOUT
          : AI_TRAFFIC_PAGE_FINDINGS.includes(signal.kind)
            ? AI_TRAFFIC_PAGES_LAYOUT
            : signal.kind === 'ai_platform_new'
              ? NEW_AI_PLATFORM_LAYOUT
              : signal.category === 'traffic' && isSiteWide(signal)
                ? SITE_TRAFFIC_LAYOUT
                : LAYOUT[signal.category];
  const named = namedPlaces(signal);
  // A mention's position, sentiment and quote are given per prompt when the
  // evidence is recorded; asked for on their own only when it is not.
  const perPrompt = promptMentions(signal.payload?.mentions).length > 0;
  const covered = new Set<WhereFieldKey>(perPrompt ? ['position', 'sentiment', 'excerpt'] : []);
  return layout
    .filter((key) => !covered.has(key))
    .map((key) => {
      const value = fieldValue(signal, key);
      const tracked = TRACKED[key];
      return {
        // Only a value read from the prompts is renamed; a missing one keeps
        // the spec's question ("which platforms?").
        key:
          (value?.type === 'platforms' && !named.platforms) ||
          (value?.type === 'locations' && !named.locations)
            ? (tracked ?? key)
            : key,
        value,
      };
    })
    .filter((field) => field.value !== null || !OPTIONAL.has(field.key));
}

// ─── Evidence ───────────────────────────────────────────────────────────────

/** A page that shows what the signal rests on, by app path. */
export interface SignalLink {
  kind:
    | 'prompt_answers'
    | 'prompts'
    | 'topic'
    | 'citations'
    | 'competitors'
    | 'traffic'
    | 'audit'
    | 'insights';
  href: string;
}

export function signalLinks(signal: Signal): SignalLink[] {
  const p = signal.payload ?? {};
  const promptId = str(p, 'promptId');
  if (promptId) {
    return [{ kind: 'prompt_answers', href: `/dashboard/prompts/${promptId}` }];
  }
  const entity = str(p, 'entity');
  const first = targetsOf(signal)[0];
  if (entity === 'topics' && typeof first?.id === 'string') {
    return [{ kind: 'topic', href: `/dashboard/topics/${first.id}` }];
  }
  // One prompt's answers for a one-prompt finding; a larger one lists its
  // prompts in Where, each linked, and points at the prompts list here.
  if (entity === 'prompts' && typeof first?.id === 'string') {
    return targetsOf(signal).length === 1
      ? [{ kind: 'prompt_answers', href: `/dashboard/prompts/${first.id}` }]
      : [{ kind: 'prompts', href: '/dashboard/prompts' }];
  }
  if (entity === 'sources' || signal.category === 'citation') {
    return [{ kind: 'citations', href: '/dashboard/citations' }];
  }
  if (AI_TRAFFIC_PAGE_FINDINGS.includes(signal.kind)) {
    return [{ kind: 'traffic', href: '/dashboard/traffic' }];
  }
  switch (signal.category) {
    case 'competitor':
      return [{ kind: 'competitors', href: '/dashboard/competitors' }];
    case 'traffic':
      return [{ kind: 'traffic', href: '/dashboard/traffic' }];
    case 'technical':
      return [{ kind: 'audit', href: '/dashboard/audit' }];
    default:
      return [{ kind: 'insights', href: '/dashboard/insights' }];
  }
}

// ─── For the API ────────────────────────────────────────────────────────────

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function apiValue(value: WhereValue): unknown {
  switch (value.type) {
    case 'text':
      return value.text;
    case 'scope':
      return value.scope;
    case 'number':
      return value.value;
    case 'prompt':
      return { id: value.id, text: value.text };
    case 'prompts':
      return { total: value.total, items: value.items };
    case 'list':
      return { total: value.total, items: value.items };
    case 'platforms':
      return value.slugs.map((slug) => ({ slug, name: platformName(slug) }));
    case 'all_platforms':
      return 'all';
    case 'positions':
      return value.items.map((row) => ({
        prompt_id: row.promptId,
        prompt_text: row.promptText,
        platform: { slug: row.platform, name: platformName(row.platform) },
        competitor: row.competitor,
        you: row.you,
      }));
    case 'mentions':
      return value.items.map((m) => ({
        prompt_id: m.promptId,
        prompt_text: m.promptText,
        platforms: m.platforms.map((slug) => ({ slug, name: platformName(slug) })),
        answers: m.answers,
        position: m.position,
        sentiment: m.sentiment,
        excerpt: m.excerpt,
        excerpt_platform: m.excerptPlatform,
        excerpt_at: m.excerptAt,
      }));
    case 'issues':
      return value.items.map((issue) => ({
        page: issue.page,
        check: issue.check,
        label: issue.label,
        evidence: issue.evidence,
      }));
    case 'crawlers':
      return value.agents;
    case 'trafficPages':
      // `items` stays the page list every other signal's `pages` gives.
      return {
        total: value.total,
        items: value.items.map((item) => item.page),
        traffic: value.items.map((item) => ({
          page: item.page,
          sessions: item.sessions,
          sessions_before: item.before,
          engaged_rate: item.engagedRate,
          key_events: item.keyEvents,
          key_events_before: item.keyEventsBefore,
          key_events_per_session: item.keyRate,
        })),
        site_engaged_rate: value.siteEngagedRate,
        site_key_events_per_session: value.siteKeyRate,
      };
    case 'referrals':
      return {
        days: value.days,
        items: value.items.map((item) => ({
          page: item.page,
          source: item.source,
          sessions: item.sessions,
          before: item.before,
          platforms: item.platforms.map((p) => ({
            platform: p.platform,
            name: getPlatformName(p.platform),
            sessions: p.sessions,
            before: p.before,
          })),
        })),
      };
    case 'sources':
      return value.items.map((source) => ({
        domain: source.domain,
        answers: source.answers,
        answers_read: source.answersRead,
      }));
    case 'pageEvents':
      return {
        days: value.days,
        items: value.items.map((event) => ({
          kind: event.kind,
          at: event.at,
          url: event.url,
          ...(event.kind === 'first_cited'
            ? { answers: event.answers }
            : { gained: event.gained, lost: event.lost }),
        })),
      };
    case 'citations':
      return value.items.map((page) => ({
        url: page.url,
        position: page.position,
        ...(page.lastCitedAt ? { last_cited_at: page.lastCitedAt } : {}),
        ...(page.answers !== undefined ? { answers: page.answers } : {}),
        ...(page.answersRead !== undefined ? { answers_read: page.answersRead } : {}),
      }));
    case 'locations':
      return value.codes.map((code) => ({ code, name: locationName(code) }));
  }
}

export interface SignalActionRef {
  id: string;
  action_no: number;
  kind: string;
  status: string;
}

/**
 * A signal's actions as "Used by actions" lists them: its current action
 * (`signals.action_id`) first, then the others by their latest link. The
 * link date alone can put an older action first: a signal that rejoins a
 * reopened action keeps that link's first date.
 */
export function currentActionFirst<T extends { id: string }>(
  actions: T[],
  currentId: string | null,
): T[] {
  return [
    ...actions.filter((action) => action.id === currentId),
    ...actions.filter((action) => action.id !== currentId),
  ];
}

/**
 * A signal's detail in the shape the MCP tools return (AC-001: "the signal
 * API/MCP returns the same structured fields"): snake_case keys, a null for
 * every field no detector records yet, and every figure with its unit.
 */
export function signalDetailForApi(signal: Signal, actions: SignalActionRef[]) {
  const change = signalChange(signal);
  return {
    where: Object.fromEntries(
      signalWhereFields(signal).map(({ key, value }) => [
        snake(key),
        value ? apiValue(value) : null,
      ]),
    ),
    change: change && {
      period: change.period,
      figures: change.figures.map((f) => ({
        metric: f.metric,
        role: f.role,
        value: f.value,
        unit: METRIC_UNITS[f.metric],
        subject: f.subject ?? null,
        subject_type: f.subjectType ?? null,
        of: f.of ?? null,
        // One finding can mix windows: each figure says which it covers.
        period: f.period ?? change.period,
      })),
    },
    evidence: {
      first_detected_at: signal.detectedAt,
      last_detected_at: signal.lastDetectedAt,
      links: signalLinks(signal).map((link) => ({ kind: link.kind, path: link.href })),
    },
    used_by_actions: actions,
  };
}
