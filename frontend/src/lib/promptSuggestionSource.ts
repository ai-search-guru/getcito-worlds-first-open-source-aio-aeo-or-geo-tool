/**
 * Shapes and guards for the evidence behind a prompt suggestion.
 *
 * A plain module rather than part of `lib/actions/promptSuggestions.ts`,
 * because that file is `'use server'` and every runtime export of a server
 * module has to be an async server action — a synchronous helper there fails
 * the production build, not the type check.
 */

export type GscSuggestionBadge = 'protect_traffic' | 'capture_demand' | 'low_competition';

export interface GscSuggestionSourceData {
  query: string;
  impressions: number;
  clicks: number;
  avgPosition: number | null;
  badge: GscSuggestionBadge | null;
  competitionIndex: number | null;
}

/**
 * Evidence behind an Analytics-derived suggestion (#705): either a page that
 * earns and has no prompt coverage, or one an AI engine already refers to.
 */
export interface GaSuggestionSourceData {
  landingPage: string;
  kind: 'revenue_blind_spot' | 'ai_momentum';
  rank: number;
  sessions: number;
  keyEvents: number;
  transactions: number;
  revenue: number;
  aiSessions: number;
  aiPlatforms: string[];
  pageTitle: string | null;
}

/**
 * The catalog category behind a shopping suggestion (ECOM-003): its live
 * products and, when they share a currency, their price band.
 */
export interface CatalogSuggestionSourceData {
  category: string;
  products: number;
  priceLow: number | null;
  priceHigh: number | null;
  /** The round price most of its products sell under. */
  priceUnder: number | null;
  currency: string | null;
}

export type SuggestionSourceData =
  GscSuggestionSourceData | GaSuggestionSourceData | CatalogSuggestionSourceData;

export type PromptSuggestionSource = 'llm' | 'heuristic' | 'gsc' | 'ga' | 'catalog';

interface SourceCarrier {
  source: PromptSuggestionSource;
  sourceData: SuggestionSourceData | null;
}

/**
 * Narrow `sourceData` to the shape its source promises.
 *
 * The `source` column and the payload are written together but read apart, so
 * these check both. A row whose source says one thing and whose payload says
 * another renders as a plain suggestion instead of reading fields that are not
 * there.
 */
export function gscSourceData(s: SourceCarrier): GscSuggestionSourceData | null {
  return s.source === 'gsc' && s.sourceData && 'query' in s.sourceData ? s.sourceData : null;
}

export function gaSourceData(s: SourceCarrier): GaSuggestionSourceData | null {
  return s.source === 'ga' && s.sourceData && 'landingPage' in s.sourceData ? s.sourceData : null;
}

/** A shopping question drawn from the brand's catalog: Prompt Suggestions' "Shopping" filter. */
export function catalogSourceData(s: SourceCarrier): CatalogSuggestionSourceData | null {
  return s.source === 'catalog' && s.sourceData && 'category' in s.sourceData ? s.sourceData : null;
}

/**
 * Built from the brand's own Search Console or Analytics data: Prompt
 * Suggestions' "From your data" filter, which Getting started links to.
 */
export function fromYourData(s: SourceCarrier): boolean {
  return gscSourceData(s) !== null || gaSourceData(s) !== null;
}
