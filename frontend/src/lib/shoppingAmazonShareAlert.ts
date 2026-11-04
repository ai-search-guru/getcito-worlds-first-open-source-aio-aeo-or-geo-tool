export const AMAZON_SHARE_REQUIRED_WEEKS = 5;
export const AMAZON_SHARE_MIN_CLASSIFIED_CARDS = 30;
export const AMAZON_SHARE_MAX_CURRENT_RATIO = 0.5;
export const AMAZON_SHARE_MIN_ABSOLUTE_DROP = 0.1;

export interface WeeklyAmazonShare {
  weekStart: string;
  amazonCards: number;
  classifiedCards: number;
}

export interface AmazonShareDropAlert {
  /** Median Amazon share across the previous four complete rolling seven-day windows. */
  fromShare: number;
  /** Amazon share in the latest complete seven-day window ending at query time. */
  toShare: number;
  baselineCards: number;
  currentCards: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function isConsecutiveWeeks(weeks: WeeklyAmazonShare[]): boolean {
  const weekStarts = weeks.map((week) => Date.parse(`${week.weekStart}T00:00:00.000Z`));
  if (weekStarts.some((date) => !Number.isFinite(date))) return false;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return weekStarts.every(
    (date, index) => index === 0 || date - weekStarts[index - 1] === sevenDays,
  );
}

/**
 * Detect a meaningful drop in Amazon's share of classified cards for a brand's
 * own products. Requires five consecutive rolling seven-day windows with at
 * least 30 classified cards each, so low-volume windows never trigger the alert.
 */
export function detectAmazonShareDrop(
  input: readonly WeeklyAmazonShare[],
): AmazonShareDropAlert | null {
  const weeks = [...input]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-AMAZON_SHARE_REQUIRED_WEEKS);
  if (weeks.length !== AMAZON_SHARE_REQUIRED_WEEKS || !isConsecutiveWeeks(weeks)) return null;

  for (const week of weeks) {
    if (
      !Number.isFinite(week.amazonCards) ||
      !Number.isFinite(week.classifiedCards) ||
      week.classifiedCards < AMAZON_SHARE_MIN_CLASSIFIED_CARDS ||
      week.amazonCards < 0 ||
      week.amazonCards > week.classifiedCards
    ) {
      return null;
    }
  }

  const shares = weeks.map((week) => week.amazonCards / week.classifiedCards);
  const baselineShare = median(shares.slice(0, -1));
  const currentShare = shares[shares.length - 1];
  const absoluteDrop = baselineShare - currentShare;

  if (
    currentShare >= baselineShare * AMAZON_SHARE_MAX_CURRENT_RATIO ||
    absoluteDrop < AMAZON_SHARE_MIN_ABSOLUTE_DROP - 1e-9
  ) {
    return null;
  }

  return {
    fromShare: baselineShare,
    toShare: currentShare,
    baselineCards: weeks.slice(0, -1).reduce((total, week) => total + week.classifiedCards, 0),
    currentCards: weeks[weeks.length - 1].classifiedCards,
  };
}
