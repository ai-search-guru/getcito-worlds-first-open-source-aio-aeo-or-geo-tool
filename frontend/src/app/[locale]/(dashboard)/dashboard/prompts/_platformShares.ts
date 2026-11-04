/**
 * The Prompt Volumes chart's split of AI-answered queries by answer engine,
 * with the figures its weights were derived from.
 */

import { AI_ADOPTION_RATE } from '@/lib/volumeEstimate';

/**
 * The share of Google searches that show an AI Overview: the AI adoption
 * rate the volumes are estimated with (AI_ADOPTION_RATE in
 * lib/volumeEstimate.ts, 45%: AI Overviews appear on roughly 43–48% of
 * Google searches). One figure for both, so the chart's split rests on the
 * rate its caption gives the total. Was 35% (Semrush / Pew) until the rate
 * moved to 45%.
 */
export const AIO_SEARCH_SHARE = AI_ADOPTION_RATE;

/** Google searches a day (ExplodingTopics, Feb 2026). */
const GOOGLE_DAILY_SEARCHES = 16.4e9;

/**
 * The other answer engines' AI-answered queries a day, together: ChatGPT
 * ~2.5B, the other chatbots ~1.13B and Google AI Mode, as the weights below
 * were set (AI Overviews at 35% of Google searches, 60.2% of the queries).
 * They stay as they are: a higher AI Overviews coverage adds AI Overviews
 * queries, not ChatGPT's.
 */
const OTHER_ENGINES_DAILY = 3.795e9;

/**
 * AI Overviews' share of all AI-answered queries: 45% × 16.4B = ~7.38B of
 * ~11.2B a day, ~66% (at 35% it was ~5.74B of ~9.5B, 60.2%).
 */
const AIO_SHARE = (() => {
  const aio = GOOGLE_DAILY_SEARCHES * AIO_SEARCH_SHARE;
  return aio / (aio + OTHER_ENGINES_DAILY);
})();

/**
 * Estimated share of AI-answered search queries across major answer engines.
 * The total the chart splits doesn't depend on it; only how it is divided.
 *
 * Derivation (all daily volume figures, early 2026):
 *   • Google Search:            ~16.4B searches/day  (ExplodingTopics, Feb 2026)
 *   • AI Overview coverage:     AIO_SEARCH_SHARE of Google searches (45%)
 *     → AI Overview volume:     ~7.38B/day
 *   • Google AI Mode:           ~100M MAU / ~1B monthly queries (Alphabet Q2 2025
 *     disclosures, 2026 industry estimates), still below Gemini app scale
 *   • ChatGPT:                  ~2.5B prompts/day  (Ahrefs, Jul 2025)
 *   • Other chatbots combined:  ~1.13B/day, split using the blended standalone
 *     chatbot market share average from Statcounter (Mar 2026),
 *     Similarweb (Jan 2026) and FirstPageSage (Apr 2026).
 *
 * AI Overviews' share comes from AIO_SEARCH_SHARE; the other engines split
 * the rest by their weights (shares of all AI-answered queries at the 35%
 * coverage they were set with, so each keeps its queries a day: ChatGPT
 * 27% of ~9.5B then, ~23% of ~11.2B now).
 *
 * Unlike raw chatbot-only market-share charts, this distribution reflects the
 * "any query that gets an AI-generated answer" universe — which is the
 * relevant denominator for Answer Engine Optimisation (AEO). Shares sum to 1.
 */
const OTHER_ENGINE_WEIGHTS: { name: string; weight: number; color: string }[] = [
  { name: 'ChatGPT', weight: 0.27, color: '#10a37f' },
  { name: 'Google Gemini', weight: 0.055, color: '#8ab4f8' },
  { name: 'Microsoft Copilot', weight: 0.029, color: '#0ea5e9' },
  { name: 'Perplexity', weight: 0.018, color: '#6366f1' },
  { name: 'Claude', weight: 0.013, color: '#d97706' },
  { name: 'Google AI Mode', weight: 0.008, color: '#1a73e8' },
  { name: 'Grok', weight: 0.005, color: '#18181b' },
];

const OTHER_WEIGHT = OTHER_ENGINE_WEIGHTS.reduce((sum, e) => sum + e.weight, 0);

export const AI_PLATFORM_SHARES: {
  name: string;
  share: number;
  color: string;
}[] = [
  { name: 'Google AI Overviews', share: AIO_SHARE, color: '#4285f4' },
  ...OTHER_ENGINE_WEIGHTS.map(({ name, weight, color }) => ({
    name,
    share: ((1 - AIO_SHARE) * weight) / OTHER_WEIGHT,
    color,
  })),
];
