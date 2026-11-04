/**
 * The Content Editor's Quality scores (Quality spec §2): E-E-A-T, Trust and
 * Readability, 0–100 each, shown in Instructions › Quality and as one
 * "Quality {avg}" chip in the header. GetCito estimates, not Google scores.
 */

/** Which of the spec's three phases are live (NEXT_PUBLIC_CONTENT_QUALITY_PHASE): 0 is none. */
export function qualityPhase(): number {
  const phase = Number(process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE ?? 0);
  return Number.isInteger(phase) && phase > 0 ? Math.min(phase, 3) : 0;
}

export type QualityBand = 'strong' | 'improve' | 'needsWork';

/** 80+ Strong, 60–79 Can improve, under 60 Needs work (spec §2). */
export function qualityBand(score: number): QualityBand {
  return score >= 80 ? 'strong' : score >= 60 ? 'improve' : 'needsWork';
}

/** The band's colours: green, neutral, amber, each with its dark mode. */
export const BAND_CLASSES: Record<QualityBand, string> = {
  strong:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  // Red only for what blocks (editor UX review 2026-11-03): a score under 60
  // asks for work, it doesn't stop the page.
  improve: 'border-border bg-muted/40 text-foreground',
  needsWork:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
};

/** A band's bar fill, as BAND_CLASSES: green, neutral, amber, never red. */
export const BAND_BAR_CLASSES: Record<QualityBand, string> = {
  strong: 'bg-emerald-600 dark:bg-emerald-500',
  improve: 'bg-muted-foreground/50',
  needsWork: 'bg-amber-500 dark:bg-amber-400',
};

/** A band's figure colour, as BAND_CLASSES. */
export const BAND_TEXT_CLASSES: Record<QualityBand, string> = {
  strong: 'text-emerald-700 dark:text-emerald-300',
  improve: 'text-foreground',
  needsWork: 'text-amber-700 dark:text-amber-300',
};

/** The header chip's figure: the scores that could be read, averaged; null with none. */
export function qualityAverage(scores: (number | null)[]): number | null {
  const read = scores.filter((s): s is number => s !== null);
  return read.length ? Math.round(read.reduce((a, b) => a + b, 0) / read.length) : null;
}
