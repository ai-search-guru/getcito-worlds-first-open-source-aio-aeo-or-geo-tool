import { rankable, type EstimateConfidence } from '@/lib/volumeEstimate';

/**
 * Insights' High Opportunity Prompts: a prompt makes the list from
 * OPPORTUNITY_MIN_VOLUME estimated AI searches a month, and is High rather
 * than Medium from OPPORTUNITY_HIGH_VOLUME.
 *
 * Set for the median-based estimate at the 45% AI adoption rate (00154,
 * 00155). The old 5k and 10k suited the sum of five keywords at 15%: on the
 * largest brand the median prompt now reads ~1.6k (it was ~4.7k), and p90
 * ~6.7k (~41k). These keep roughly the same share of prompts on the list,
 * about half, with the top third or so High.
 */
export const OPPORTUNITY_MIN_VOLUME = 1500;
export const OPPORTUNITY_HIGH_VOLUME = 3000;

export function opportunityLevel(
  estAiVolume: number,
  confidence?: EstimateConfidence,
): 'high' | 'medium' | null {
  // A low-confidence estimate isn't ranked on its own (PROMPT-013).
  if (confidence && !rankable({ confidence })) return null;
  if (estAiVolume >= OPPORTUNITY_HIGH_VOLUME) return 'high';
  if (estAiVolume >= OPPORTUNITY_MIN_VOLUME) return 'medium';
  return null;
}
