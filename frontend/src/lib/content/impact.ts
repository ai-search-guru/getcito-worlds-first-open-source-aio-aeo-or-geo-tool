import { PLATFORM_LABELS } from '@/config/platformLabels';
import { visitChange, type VisitChange } from '@/lib/trafficChange';
import { getPlatformName, isNamedPlatform } from '@/lib/trafficPlatforms';

/**
 * The editor's Impact tab (Content Editor CE-016, spec §7): what the page a
 * draft optimizes earns, over the last N days against the N before, as
 * content_page_impact (00209) reads it.
 */

/** The periods the tab offers, in days; 30 first. */
export const IMPACT_PERIODS = [7, 30, 90, 365] as const;
export type ImpactPeriod = (typeof IMPACT_PERIODS)[number];
export const DEFAULT_IMPACT_PERIOD: ImpactPeriod = 30;

/** Search Console page data is kept this long (gscSync.js PAGE_BACKFILL_DAYS). */
export const GSC_PAGE_DAYS = 190;

export interface ImpactCount {
  cur: number;
  prev: number;
}

export interface ImpactPrompt {
  id: string;
  text: string;
  cur: number;
  prev: number;
  curPlatforms: string[];
  prevPlatforms: string[];
}

export interface ContentImpact {
  citations: ImpactCount;
  /** Prompts citing the page in each window, and the ones it lost: counted over all of them. */
  promptCounts: ImpactCount & { lost: number };
  aiVisits: ImpactCount;
  gscClicks: ImpactCount;
  /** The first day of Search Console page data the brand has; null without any. */
  gscSince: string | null;
  /** The prompts to list, the most cited first: at most 100, so not to count from. */
  prompts: ImpactPrompt[];
  /** The brand's other pages cited now for this page's prompts. */
  overlap: { page: string; prompts: number }[];
}

/** The first day of each window, as content_page_impact counts them: whole UTC days ending yesterday. */
export function impactWindows(days: number, today = new Date()): { cur: string; prev: string } {
  const utc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const day = (offset: number) => new Date(utc - offset * 86_400_000).toISOString().slice(0, 10);
  return { cur: day(days), prev: day(2 * days) };
}

/**
 * How far Search Console covers the windows: 'none' without data, 'partial'
 * when even this window starts before its first day (1y, as pages are kept
 * 190 days), 'current' when only the previous one does, else 'both'.
 */
export function gscCoverage(
  gscSince: string | null,
  days: number,
  today = new Date(),
): 'none' | 'partial' | 'current' | 'both' {
  if (!gscSince) return 'none';
  const { cur, prev } = impactWindows(days, today);
  if (cur < gscSince) return 'partial';
  return prev < gscSince ? 'current' : 'both';
}

/** A count's change, as the AI Traffic page reads one; none when the previous window isn't whole. */
export function impactChange(count: ImpactCount, comparable = true): VisitChange {
  return visitChange(count.cur, count.prev, { comparable });
}

/** A prompt the page lost: cited in the previous window, not in this one. */
export function isLost(prompt: ImpactPrompt): boolean {
  return prompt.cur === 0 && prompt.prev > 0;
}

/** Platform names for a prompt row: where it cites the page now, or did before it was lost. */
export function platformNames(platforms: string[]): string[] {
  return [...new Set(platforms.map((p) => PLATFORM_LABELS[p] ?? p))];
}

/**
 * Results from AI visits (spec §7), as content_page_results (00210) reads
 * them for the same window: one row per AI source key, with its AI visits
 * (the snippet or Analytics, never both, as the AI visits card) and Google
 * Analytics' AI sessions landing on the page, their key events and purchases.
 */
export interface ResultSource {
  platform: string;
  visits: number;
  sessions: number;
  keyEvents: number;
  keyEventSessions: number;
  transactions: number;
  revenue: number;
}

export interface ContentResults {
  /** A Google Analytics property is mapped: key events and purchases come only from it. */
  analytics: boolean;
  /** The property reported purchases in the window, on any page. */
  purchases: boolean;
  sources: ResultSource[];
}

/** A source row as the tab lists it; a null name is "Other", the keys the page can't name. */
export interface NamedResultSource extends Omit<ResultSource, 'platform'> {
  name: string | null;
}

type ResultFigures = Omit<ResultSource, 'platform'>;

const NO_RESULTS: ResultFigures = {
  visits: 0,
  sessions: 0,
  keyEvents: 0,
  keyEventSessions: 0,
  transactions: 0,
  revenue: 0,
};

function addFigures(a: ResultFigures, b: ResultFigures): ResultFigures {
  return {
    visits: a.visits + b.visits,
    sessions: a.sessions + b.sessions,
    keyEvents: a.keyEvents + b.keyEvents,
    keyEventSessions: a.keyEventSessions + b.keyEventSessions,
    transactions: a.transactions + b.transactions,
    revenue: a.revenue + b.revenue,
  };
}

/** All sources together: the result cards. */
export function resultTotals(sources: ResultSource[]): ResultFigures {
  return sources.reduce<ResultFigures>(addFigures, NO_RESULTS);
}

/**
 * The by-source table: one row per platform name (ChatGPT's old hosts are
 * ChatGPT), keys the page can't name folded into Other, last; the most
 * visits first, then Analytics sessions. A source with nothing to show is
 * left out: Analytics sessions on a day the snippet counted the visits.
 */
export function resultSources(sources: ResultSource[]): NamedResultSource[] {
  const byName = new Map<string | null, ResultFigures>();
  for (const { platform, ...figures } of sources) {
    const name = isNamedPlatform(platform) ? getPlatformName(platform) : null;
    byName.set(name, addFigures(byName.get(name) ?? NO_RESULTS, figures));
  }
  return [...byName]
    .map(([name, figures]) => ({ name, ...figures }))
    .filter((row) => row.visits > 0 || row.keyEvents > 0 || row.transactions > 0 || row.revenue > 0)
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        b.visits - a.visits ||
        b.sessions - a.sessions ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );
}
