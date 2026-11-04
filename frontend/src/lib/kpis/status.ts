import type { KpiDirection, KpiUnit } from './registry';

/**
 * Status is derived, never stored. A stored badge can go stale against the
 * numbers standing next to it; a derived one cannot. The thresholds are the
 * whole definition — if a status ever looks wrong, this file is the only
 * place to argue with.
 */
export type KpiStatus = 'on_track' | 'at_risk' | 'off_track' | 'goal_reached';

/**
 * Progress toward the target as a percentage. May exceed 100 — the caller
 * caps the *bar*, not the number.
 *
 * For lower_is_better KPIs the ratio inverts: being at or under the target
 * is 100%+. A zero value against a lower-is-better target is fully met, not
 * a division by zero.
 */
export function kpiProgress(value: number, target: number, direction: KpiDirection): number {
  if (target <= 0) return 0;
  if (direction === 'lower_is_better') {
    if (value <= 0) return 100;
    return Math.round((target / value) * 100);
  }
  return Math.round((value / target) * 100);
}

/**
 * @param change movement vs the previous window in the KPI's own terms
 *   (points for percents, percent for counts); sign is raw, not
 *   direction-adjusted. Null when there is no previous window to compare.
 *
 * Rules, in order:
 *  - `goal_reached` at 100%+ progress, whatever the trend.
 *  - `off_track` under 40% — too far out for trend to change the verdict.
 *  - `at_risk` under 70%, or when the value is moving the wrong way
 *    (per `direction`) while the goal is still unmet.
 *  - `on_track` otherwise.
 */
export function deriveKpiStatus({
  progress,
  change,
  direction,
}: {
  progress: number;
  change: number | null;
  direction: KpiDirection;
}): KpiStatus {
  if (progress >= 100) return 'goal_reached';
  if (progress < 40) return 'off_track';
  const movingWrongWay =
    change !== null && (direction === 'higher_is_better' ? change < 0 : change > 0);
  if (progress < 70 || movingWrongWay) return 'at_risk';
  return 'on_track';
}

/** Whether a raw change is an improvement for this KPI — drives arrow color. */
export function isImprovement(change: number, direction: KpiDirection): boolean {
  return direction === 'higher_is_better' ? change > 0 : change < 0;
}

/**
 * The target to hold a KPI against when the viewed window differs from the
 * goal's own timeframe. Flow metrics (counts, sessions) accumulate, so a
 * monthly 100 viewed over a week is ~23 — the week's slice of the goal.
 * Percent metrics are levels, not flows: a 50% visibility goal is 50% over
 * any window, so it never scales.
 */
export function scaleTargetToWindow(
  target: number,
  unit: KpiUnit,
  windowDays: number,
  timeframeDays: number,
): number {
  if (unit === 'percent' || windowDays <= 0 || timeframeDays <= 0) return target;
  return Math.max(1, Math.round(target * (windowDays / timeframeDays)));
}
