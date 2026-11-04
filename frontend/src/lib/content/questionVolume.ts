import {
  keywordVolumeEstimate,
  promptVolumeEstimate,
  type EstimateConfidence,
  type VolumeEstimate,
} from '@/lib/volumeEstimate';
import type { PromptVolume } from '@/types';

/**
 * A content opportunity's volume is its question's: the prompt it is shown
 * with, as the Content page names it (2026-11-01). Its cluster's prompts used
 * to be added up, so a group of five prompts on 50k head terms read as
 * 112,500 a month, and a merge could keep a sum frozen months ago. One
 * question's estimate, "one of N prompts", is what the page, its export and
 * MCP show; the score's demand still weighs the whole group.
 *
 * A prompt's estimate comes from short head terms for its category, by design
 * (PROMPT-013). For a long question that reads far above what its own words
 * are searched, so it says it is from head terms, and names its related
 * keyword closest to its words that has Google data, with that keyword's own
 * estimate: "best coffee subscription 2026", 585/mo, beside 3,038/mo.
 */

/** From this many words a question is long: its own wording is searched far less than its head terms. */
export const LONG_QUESTION_WORDS = 6;

/** Words that don't make a keyword closer to a question. */
const FILLER = new Set(
  'a an the and or of in on for to with at by is are be do does what which who how should can i my me'.split(
    ' ',
  ),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export interface QuestionVolume {
  /** The question, as its prompt is tracked. */
  question: string;
  /** Its prompt's estimate, from its head terms (PROMPT-013). */
  estimate: VolumeEstimate;
  /** A long question: its estimate is its head terms', not its own words'. */
  fromHeadTerms: boolean;
  /** For a long question, the related keyword closest to its words with Google data, and that keyword's own estimate. */
  closest: { phrase: string; estimate: VolumeEstimate } | null;
}

type VolumeRow = Pick<
  PromptVolume,
  'estAiVolume' | 'googleVolumes' | 'aiVolumeMultiplier' | 'keywords' | 'fetchedAt'
>;

/**
 * The related keyword with Google data that shares most of the question's
 * words, none it lacks counting against it; of two as close, the less
 * searched, the more specific. Null when none shares a word.
 */
export function closestPhrase(
  question: string,
  googleVolumes: Record<string, number>,
): { phrase: string; googleVolume: number } | null {
  const asked = new Set(words(question).filter((w) => !FILLER.has(w)));
  let best: { phrase: string; googleVolume: number; score: number } | null = null;
  for (const [phrase, googleVolume] of Object.entries(googleVolumes)) {
    if (!(googleVolume > 0)) continue;
    const own = words(phrase).filter((w) => !FILLER.has(w));
    const shared = own.filter((w) => asked.has(w)).length;
    const score = shared - (own.length - shared);
    if (shared === 0) continue;
    if (!best || score > best.score || (score === best.score && googleVolume < best.googleVolume)) {
      best = { phrase, googleVolume, score };
    }
  }
  return best && { phrase: best.phrase, googleVolume: best.googleVolume };
}

/** A question's volume from its prompt's volume row; null when it has none. */
export function questionVolume(
  question: string,
  row: VolumeRow,
  now: Date = new Date(),
): QuestionVolume | null {
  if (!(row.estAiVolume > 0)) return null;
  const fromHeadTerms = words(question).length >= LONG_QUESTION_WORDS;
  const near = fromHeadTerms ? closestPhrase(question, row.googleVolumes ?? {}) : null;
  return {
    question,
    estimate: promptVolumeEstimate(row, now),
    fromHeadTerms,
    closest: near && {
      phrase: near.phrase,
      estimate: keywordVolumeEstimate(
        near.googleVolume,
        row.aiVolumeMultiplier,
        row.fetchedAt ?? null,
        now,
      ),
    },
  };
}

/** An opportunity's volume as MCP gives it (get_content_opportunity). */
export interface OpportunityVolumeForMcp {
  question: string;
  est_ai_volume: number;
  est_ai_volume_low: number;
  est_ai_volume_high: number;
  volume_confidence: EstimateConfidence;
  /** Always 'estimate': AI engines publish no search volumes. */
  volume_type: 'estimate';
  source: string;
  fetched_at: string | null;
  /** How many prompts the opportunity answers; the question is one of them. */
  of_prompts: number;
  /** A long question: its volume is its category's head terms', not its own words'. */
  from_head_terms: boolean;
  /** For a long question, its related keyword with Google data closest to its words, and that keyword's own estimate. */
  closest_phrase: {
    phrase: string;
    est_ai_volume: number;
    est_ai_volume_low: number;
    est_ai_volume_high: number;
  } | null;
}

/** An opportunity's volume for MCP (get_content_opportunity), from its question's. */
export function opportunityVolumeForMcp(
  read: QuestionVolume | null,
  prompts: number,
): OpportunityVolumeForMcp | null {
  if (!read) return null;
  const { estimate, closest } = read;
  return {
    question: read.question,
    est_ai_volume: estimate.value,
    est_ai_volume_low: estimate.low,
    est_ai_volume_high: estimate.high,
    volume_confidence: estimate.confidence,
    volume_type: 'estimate',
    source: `Median monthly Google searches of the prompt's related head terms (DataForSEO) × an AI answer share of ${Math.round(estimate.rate * 100)}%`,
    fetched_at: estimate.asOf,
    of_prompts: Math.max(1, prompts),
    from_head_terms: read.fromHeadTerms,
    closest_phrase: closest && {
      phrase: closest.phrase,
      est_ai_volume: closest.estimate.value,
      est_ai_volume_low: closest.estimate.low,
      est_ai_volume_high: closest.estimate.high,
    },
  };
}
