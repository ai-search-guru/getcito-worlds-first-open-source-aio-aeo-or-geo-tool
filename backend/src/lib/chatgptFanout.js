/**
 * ChatGPT's query fan-out, sampled (CLORO_CHATGPT_FANOUT).
 *
 * Since 2026-09-30 ChatGPT's default (mobile-web) interface carries no query
 * text, so we stopped asking Cloro for it (#1119). Its legacy desktop
 * interface (`legacy: true`) still does, but the fan-out add-on costs +2
 * credits a task, and Cloro calls the legacy interface best-effort and
 * temporary. So each prompt's ChatGPT answer asks for it one day a week:
 * that day's answer is the one tracking stores, with no extra request. Only
 * the nightly run's first attempt asks (see runAsksChatgptFanout in the
 * tracking worker); a manual run, a retry or a recovered run would pay again.
 *
 * Modes:
 *   off     never ask
 *   sample  one day a week per prompt
 *   all     every nightly run
 * Unset, it is `sample` on the managed cloud and `off` on self-host, so an
 * update never starts spending a self-hoster's credits on its own.
 */

import { createHash } from 'node:crypto';
import { isCloud } from '../config/plans.js';
import { logger } from './logger.js';

export const CHATGPT_FANOUT_MODES = ['off', 'sample', 'all'];

let warnedUnknown = false;

/**
 * The configured mode. Unset (or blank): `sample` on the cloud, `off` on
 * self-host. A value it doesn't know is `off`, said once in the log: a typo
 * must not cost credits.
 */
export function chatgptFanoutMode(value = process.env.CLORO_CHATGPT_FANOUT, cloud = isCloud()) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  if (mode === '') return cloud ? 'sample' : 'off';
  if (CHATGPT_FANOUT_MODES.includes(mode)) return mode;
  if (!warnedUnknown) {
    warnedUnknown = true;
    logger.warn(
      { value, expected: CHATGPT_FANOUT_MODES },
      'CLORO_CHATGPT_FANOUT has a value it does not know; ChatGPT fan-out is off',
    );
  }
  return 'off';
}

/**
 * The weekday (0 = Sunday … 6, in UTC, as `getUTCDay` counts) on which a
 * prompt's ChatGPT answer asks for its fan-out. Read from a hash of the
 * prompt's id, so it needs no stored state, never moves, and spreads the
 * prompts (and the cost) across the week.
 */
export function chatgptFanoutWeekday(promptId) {
  return createHash('sha256').update(String(promptId)).digest().readUInt32BE(0) % 7;
}

/** Whether a prompt's ChatGPT task submitted at `date` asks for its fan-out. */
export function chatgptFanoutDue(promptId, date, mode = chatgptFanoutMode()) {
  if (mode === 'all') return true;
  if (mode === 'off') return false;
  return chatgptFanoutWeekday(promptId) === date.getUTCDay();
}
