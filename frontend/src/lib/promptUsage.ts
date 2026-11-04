/**
 * Tracked prompt usage (PROMPT-009, PROMPT-012): which state "used / limit"
 * is in, for the usage cards' colors and for blocking Add Prompt. The numbers
 * are the ones the plan-limit guard enforces (active prompt locations,
 * org-wide; paused prompts don't count — see promptLocations.ts).
 */

export type PromptUsageState = 'unlimited' | 'normal' | 'warning' | 'full' | 'over';

export interface PromptUsage {
  state: PromptUsageState;
  /** Locations that can still be added; 0 when full or over. */
  remaining: number;
  /** Fill of the progress bar, 0–100 (capped at 100 when over). */
  percent: number;
}

/** From this share of the limit on, the usage cards turn amber (PROMPT-012: 90%). */
export const PROMPT_USAGE_WARNING_RATIO = 0.9;

/**
 * `limit === -1` is unlimited (self-host, enterprise without an override).
 * The cap is inclusive (locationLimitMessage), so landing exactly on it is
 * "full", not "over". "over" happens after a downgrade below current usage.
 */
export function getPromptUsage(used: number, limit: number): PromptUsage {
  if (limit === -1) return { state: 'unlimited', remaining: Infinity, percent: 0 };
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  let state: PromptUsageState;
  if (used > limit) state = 'over';
  else if (used === limit) state = 'full';
  else if (used >= limit * PROMPT_USAGE_WARNING_RATIO) state = 'warning';
  else state = 'normal';
  return { state, remaining, percent };
}

/** Whether adding a prompt is blocked: no location left under the cap. */
export function isPromptLimitReached(usage: PromptUsage): boolean {
  return usage.state === 'full' || usage.state === 'over';
}
