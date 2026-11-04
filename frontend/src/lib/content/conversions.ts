import { getPlatformName, isNamedPlatform } from '@/lib/trafficPlatforms';
import type { SiteType } from './pageTypes';

/**
 * Conversions of AI journeys through a page (CE-017), as
 * content_page_conversions (00287) reads them for the Live page tab's
 * window: from the AI Traffic snippet with conversions on (00286), credited
 * to the AI source of the journey's first visit.
 */

/** A conversion's goal (server trafficEvents.js CONVERSION_GOALS). */
export type ConversionGoal = 'signup' | 'demo' | 'order' | 'booking' | 'newsletter' | 'custom';

export interface ContentConversions {
  /** The page's key, as its journeys name it (lower(normalize_page_path)). */
  page: string;
  /** The brand has conversions on. */
  enabled: boolean;
  goals: { goal: ConversionGoal; count: number; units: number }[];
  /** Orders' and bookings' value per currency: one without a currency isn't summed. */
  revenue: { currency: string; value: number }[];
  /** Per AI source the journey started from. */
  sources: { platform: string; conversions: number }[];
  /** The five most frequent: source, pages in order (page keys), goal. */
  journeys: { source: string; pages: string[]; goal: ConversionGoal; count: number }[];
}

/**
 * The brand's conversions from AI journeys in the Plan's period
 * (brand_ai_conversions, 00288), for its AI results strip.
 */
export interface PlanConversions {
  /** The brand has conversions on. */
  enabled: boolean;
  /** Per goal, the most first. */
  goals: { goal: ConversionGoal; count: number }[];
  /** The most frequent journey to a conversion, or null. */
  journey: { source: string; pages: string[]; goal: ConversionGoal; count: number } | null;
}

/** What a result card shows: a goal's count, the revenue, or the units ordered. */
export type ResultKey = ConversionGoal | 'revenue' | 'units';

/**
 * What each kind of site counts (spec §7 point 26): a B2B site its signups
 * and demo forms (its revenue comes with CE-024), a shop its orders, revenue
 * and units, a B2C site its bookings, revenue and newsletter signups, a
 * mobile app's site its signups and newsletter signups (installs happen in
 * the app stores, where the snippet can't follow).
 */
export const SITE_RESULTS: Record<SiteType, readonly ResultKey[]> = {
  b2b: ['signup', 'demo'],
  ecommerce: ['order', 'revenue', 'units'],
  b2c: ['booking', 'revenue', 'newsletter'],
  app: ['signup', 'newsletter'],
};

export type ResultCard =
  | { key: ConversionGoal | 'units'; value: number }
  | { key: 'revenue'; value: { currency: string; value: number }[] };

/**
 * The cards for a site: its own goals, revenue and units, always, at 0 when
 * there are none; then a card for each other goal it had, the most first (a
 * shop's newsletter form counts as a signup, and shows as one).
 */
export function conversionCards(conversions: ContentConversions, site: SiteType): ResultCard[] {
  const count = (goal: ConversionGoal) =>
    conversions.goals.find((g) => g.goal === goal)?.count ?? 0;
  const keys = SITE_RESULTS[site];
  const cards: ResultCard[] = keys.map((key) => {
    if (key === 'revenue') return { key, value: conversions.revenue };
    if (key === 'units') {
      return { key, value: conversions.goals.find((g) => g.goal === 'order')?.units ?? 0 };
    }
    return { key, value: count(key) };
  });
  const others: ResultCard[] = conversions.goals
    .filter((g) => g.count > 0 && !(keys as readonly string[]).includes(g.goal))
    .map((g) => ({ key: g.goal, value: g.count }));
  return [...cards, ...others];
}

/**
 * The by-source rows: one per platform name (ChatGPT's old hosts are
 * ChatGPT), keys the page can't name folded into Other, last; the most
 * conversions first.
 */
export function conversionSources(
  conversions: ContentConversions,
): { name: string | null; conversions: number }[] {
  const byName = new Map<string | null, number>();
  for (const { platform, conversions: n } of conversions.sources) {
    const name = isNamedPlatform(platform) ? getPlatformName(platform) : null;
    byName.set(name, (byName.get(name) ?? 0) + n);
  }
  return [...byName]
    .map(([name, n]) => ({ name, conversions: n }))
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        b.conversions - a.conversions ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );
}

/**
 * A journey's pages as the tab shows them: all of them up to five, or the
 * first, a gap and the last three; with `keep` (the page the tab is about)
 * only in the gap, the first, a gap, that page, a gap and the last, so the
 * page stays in view.
 */
export function journeyPages(pages: string[], keep?: string): (string | null)[] {
  if (pages.length <= 5) return pages;
  const shown = [pages[0], null, ...pages.slice(-3)];
  if (keep === undefined || shown.includes(keep) || !pages.includes(keep)) return shown;
  // A gap only where pages are left out: none before the page right after the first.
  const at = pages.indexOf(keep);
  return [pages[0], ...(at > 1 ? [null] : []), keep, null, pages[pages.length - 1]];
}
