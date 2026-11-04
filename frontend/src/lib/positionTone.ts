export type PositionTone = 'Early' | 'Mid' | 'Late';

/**
 * Where a rank sits in its list: the first third is Early, the last third
 * Late. The Citation URL page and the Prompts Positions panel share it, so
 * the same rank never reads differently on the two.
 */
export function positionTone(rank: number, total: number): PositionTone {
  const ratio = total > 1 ? (rank - 1) / (total - 1) : 0;
  return ratio <= 1 / 3 ? 'Early' : ratio >= 2 / 3 ? 'Late' : 'Mid';
}
