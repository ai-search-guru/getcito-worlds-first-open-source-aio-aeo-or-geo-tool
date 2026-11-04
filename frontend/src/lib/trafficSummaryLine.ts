/**
 * The AI Traffic page's summary line (AT-007, spec §3.1): one or two
 * sentences from the page's own aggregates, with a fixed template and no
 * model. Each fact is kept only when the page itself would state it:
 *
 *   - the change on the previous period, when both periods have 30 visits
 *     (AT-003, F4);
 *   - the share of all traffic and the best-converting platform, only from a
 *     connected Google Analytics (§3.8b rule 5: without GA4 it never says
 *     "Perplexity visitors convert best");
 *   - the best-converting platform, only when at least two platforms have 30
 *     visits and 5 key events, the bar for comparing conversions (§5.4);
 *   - the untracked Google queries, only from a connected Search Console
 *     (AT-009).
 *
 * Pure: the component renders the words.
 */

import type { TrafficEngagement } from '@/lib/actions/traffic';
import { LOW_SAMPLE_VISITS, visitChange } from '@/lib/trafficChange';
import { formatShare } from '@/lib/trafficKpis';
import { isNamedPlatform } from '@/lib/trafficPlatforms';

/** Key events a platform needs before its conversions are compared (§5.4). */
export const MIN_COMPARED_KEY_EVENTS = 5;

export interface SummaryLineInput {
  totalVisits: number;
  totalVisitsPrev: number;
  hasPreviousPeriod: boolean;
  /** The range's platforms, most visits first, with Analytics' figures for each. */
  platforms: { platform: string; visits: number; analytics: TrafficEngagement | null }[];
  /** Every session Analytics recorded on the range's days; null when it isn't connected. */
  gaSessions: number | null;
  /** Pages answers cite 20+ times with no AI visit (AT-006); null while unknown. */
  citedNotClicked: number | null;
  /** Google queries with clicks no prompt tracks (AT-009); null without Search Console. */
  untrackedQueries?: number | null;
}

export interface SummaryLine {
  visits: number;
  /** "0.8%" of all traffic. */
  share: string | null;
  /** The % change on the previous period, when there is one to state. */
  change: number | null;
  top: { platform: string; visits: number } | null;
  /** The platform whose visitors convert best, with its session key event rate. */
  best: { platform: string; rate: number } | null;
  /** 0 says nothing. */
  citedNotClicked: number;
  /** 0 says nothing. */
  untrackedQueries: number;
}

/** The platform whose visits convert best, when two or more can be compared. */
export function bestConvertingPlatform(
  platforms: SummaryLineInput['platforms'],
): { platform: string; rate: number } | null {
  const compared = platforms.flatMap((p) => {
    const a = p.analytics;
    if (!a || a.sessions < LOW_SAMPLE_VISITS || a.keyEvents < MIN_COMPARED_KEY_EVENTS) return [];
    // No session rate yet (rows synced before it was read): nothing to compare.
    if (a.keyEventSessions <= 0) return [];
    return [{ platform: p.platform, rate: a.keyEventSessions / a.sessions }];
  });
  if (compared.length < 2) return null;
  const best = compared.reduce((a, b) => (b.rate > a.rate ? b : a));
  return { platform: best.platform, rate: Math.round(best.rate * 1000) / 10 };
}

export function summaryLine(input: SummaryLineInput): SummaryLine {
  const change = visitChange(input.totalVisits, input.totalVisitsPrev, {
    comparable: input.hasPreviousPeriod,
  });
  // The most visits among the platforms it can name, as the weekly e-mail picks it.
  const top = input.platforms.find((p) => p.visits > 0 && isNamedPlatform(p.platform));
  const ga = input.gaSessions !== null;
  return {
    visits: input.totalVisits,
    share: ga ? formatShare(input.totalVisits, input.gaSessions ?? 0) : null,
    change: change.kind === 'pct' ? change.pct : null,
    top: top ? { platform: top.platform, visits: top.visits } : null,
    best: ga ? bestConvertingPlatform(input.platforms) : null,
    citedNotClicked: input.citedNotClicked ?? 0,
    untrackedQueries: input.untrackedQueries ?? 0,
  };
}
