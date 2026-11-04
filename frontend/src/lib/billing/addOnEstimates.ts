/**
 * "What a pack can cover, roughly" in the Get more window (CHAT-18 §A item
 * 3): a pack's budget (its price ÷ 2) over the average cost of one item on
 * Auto, rounded down to a round number so it never promises more. Examples
 * only: credits work for everything Chat does. The averages are the launch
 * ones (2026-10-18 prices); later they come from the last 30 days of Auto
 * usage (CHAT-04 telemetry), which isn't wired yet.
 */

/** Launch averages on Auto, in dollars: one Chat answer, one ~1,500-word article with research. */
export const AUTO_AVERAGE_USD = { answer: 0.025, article: 0.08 } as const;

/** Down to a round number: tens under 100, hundreds under 1,000, five hundreds under 10,000. */
export function roundDown(count: number): number {
  const step = count < 100 ? 10 : count < 1_000 ? 100 : count < 10_000 ? 500 : 1_000;
  return Math.floor(count / step + 1e-9) * step;
}

/** About how many answers and articles a pack of this price covers on Auto. */
export function packEstimate(priceCents: number): { answers: number; articles: number } {
  const budgetUsd = priceCents / 100 / 2;
  return {
    answers: roundDown(budgetUsd / AUTO_AVERAGE_USD.answer),
    articles: roundDown(budgetUsd / AUTO_AVERAGE_USD.article),
  };
}
