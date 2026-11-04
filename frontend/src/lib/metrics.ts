/** Percentage change with one stable meaning; a zero base has no percentage delta. */
export function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}
