/**
 * A quota read while the workspace has no active plan (read-only once the
 * plan has ended): the server answers the reads that cost nothing with what
 * is stored, every limit 0 and `noPlan: true`. An active plan, and
 * self-hosted, never send the field.
 */
export interface NoPlanMark {
  /** No active plan: the limits read 0, but nothing was used up. */
  noPlan?: boolean;
}

/**
 * Whether a quota's 0 means "no active plan" rather than "used up": the
 * server marked it so, or the workspace is read-only. Such a quota isn't
 * shown as spent (no red, no "limit reached"), and its actions stay
 * clickable: the upgrade gate opens the plan dialog instead of running them.
 */
export function isNoPlan(quota: NoPlanMark | null | undefined, isLocked = false): boolean {
  return isLocked || quota?.noPlan === true;
}
