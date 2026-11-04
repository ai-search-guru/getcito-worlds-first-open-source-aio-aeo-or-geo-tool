/**
 * A prompt's real demand (PROMPT-014) as the Demand card reads it: what the
 * server's nightly sweep read (backend/src/lib/promptDemand.js) and what
 * each card says when a signal isn't there. Measured numbers: they never
 * carry the Estimate badge (PROMPT-013).
 */

import type { GoogleSourceStatus } from '@/lib/trafficSources';

export type DemandLevel = 'high' | 'medium' | 'low';

/** The four signals; the level counts how many were read. */
export const DEMAND_SIGNALS = ['gsc', 'trends', 'paa', 'youtube'] as const;
export type DemandSignal = (typeof DEMAND_SIGNALS)[number];
export type PaidDemandSignal = Exclude<DemandSignal, 'gsc'>;

/** Search Console over the last 28 days: the brand's queries that match the prompt. */
export interface GscDemand {
  impressions: number;
  clicks: number;
  queries: number;
  top: { query: string; impressions: number; clicks: number } | null;
  at: string;
}

/** Google Trends, 12 months: weekly interest (0–100, relative to its own peak). */
export interface TrendsDemand {
  points: number[];
  trend: 'rising' | 'steady' | 'falling' | null;
  /** Percent between the first and the last four weeks; null without a base. */
  change: number | null;
  from: string | null;
  to: string | null;
  at: string;
}

export interface PaaDemand {
  questions: {
    question: string;
    url: string | null;
    domain: string | null;
    /** The brand already tracks a prompt with this text (questionKey). */
    tracked?: boolean;
  }[];
  at: string;
}

export interface YoutubeDemand {
  /** Videos read: YouTube's first results. */
  videos: number;
  /** Their views, summed. */
  views: number;
  /** How many results YouTube says it has. */
  results: number | null;
  top: {
    title: string;
    url: string | null;
    channel: string | null;
    views: number;
    published: string | null;
  } | null;
  at: string;
}

/** GET /api/prompts/:id/demand. */
export interface PromptDemand {
  level: DemandLevel | null;
  signals: number;
  updatedAt: string | null;
  /** The keyword the paid signals are read for: the volume analysis's top one. */
  keyword: string | null;
  locationCode: number | null;
  languageCode: string | null;
  gsc: GscDemand | null;
  trends: TrendsDemand | null;
  paa: PaaDemand | null;
  youtube: YoutubeDemand | null;
  /** Tasks set and not read yet. */
  pending: Record<PaidDemandSignal, boolean>;
  /** The prompt has a volume analysis. */
  hasVolume: boolean;
  /** …with a keyword Google has searches for. */
  hasKeyword: boolean;
  /** Trends, PAA and YouTube are read on this server (DEMAND_SIGNALS). */
  paidSignals: boolean;
}

/**
 * What a Trends, People Also Ask or YouTube card shows: its data, or why
 * there is none — being read, no volume analysis yet, no keyword with
 * searches, not read on this server, or not read yet.
 */
export type PaidSignalState = 'data' | 'pending' | 'noVolume' | 'noKeyword' | 'off' | 'notRead';

export function paidSignalState(demand: PromptDemand, signal: PaidDemandSignal): PaidSignalState {
  if (demand[signal]) return 'data';
  if (demand.pending[signal]) return 'pending';
  if (!demand.hasVolume) return 'noVolume';
  if (!demand.hasKeyword) return 'noKeyword';
  if (!demand.paidSignals) return 'off';
  return 'notRead';
}

/**
 * What the Search Console card shows: its data, or the source's state
 * (AI Traffic's, googleSourceStatus) — not connected, no property for this
 * brand, the first sync running, a server without Search Console — or not
 * read yet when it's connected. Unknown state (still loading, or unread):
 * not read yet.
 */
export type GscSignalState = 'data' | Exclude<GoogleSourceStatus, 'connected'> | 'notRead';

export function gscSignalState(
  demand: PromptDemand,
  status: GoogleSourceStatus | null,
): GscSignalState {
  if (demand.gsc) return 'data';
  if (!status || status === 'connected') return 'notRead';
  return status;
}

/**
 * A prompt's text as compared for "already tracked": case, accents,
 * punctuation and spacing don't count. The server marks the People Also Ask
 * questions the brand tracks the same way (backend/src/lib/promptDemand.js).
 */
export function questionKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** "+64%", "−12%", "0%": a year's change as the Trends card says it. */
export function formatChange(change: number): string {
  if (change > 0) return `+${change}%`;
  if (change < 0) return `−${Math.abs(change)}%`;
  return '0%';
}
