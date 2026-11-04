/**
 * Why a customer cancels, or asks for three days first (Settings › Billing ›
 * Cancel Subscription). The reasons match the server's
 * (backend/src/lib/cancelFeedback.js), which keeps the answer and e-mails it
 * to the team.
 */

export const CANCEL_REASONS = [
  'too_expensive',
  'missing_feature',
  'no_results',
  'switching',
  'temporary',
  'other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export type CancelChoice = 'cancel' | 'wait';

/** How long the team has to act when the customer waits. */
export const WAIT_DAYS = 3;

export const CANCEL_MESSAGE_MAX = 2000;

const DAY_MS = 86_400_000;

/** The day the team answers by, when the customer gives it three days. */
export function waitUntil(now = new Date()): Date {
  return new Date(now.getTime() + WAIT_DAYS * DAY_MS);
}

/**
 * Whether waiting is offered: only when the plan renews (or the trial ends)
 * at least a day after the team has answered, so no one is charged while
 * they wait and there is still time to cancel after hearing back. With no
 * known period end, it isn't. The server checks the same rule.
 */
export function canWait(currentPeriodEnd: string | null, now = new Date()): boolean {
  if (!currentPeriodEnd) return false;
  const end = new Date(currentPeriodEnd).getTime();
  return Number.isFinite(end) && end > waitUntil(now).getTime() + DAY_MS;
}
