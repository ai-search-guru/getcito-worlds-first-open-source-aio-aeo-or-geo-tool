/**
 * Shared retry wrapper for LLM calls (promoted from lib/audit for #379).
 * Provider blips (rate limits, transient 5xx, the occasional malformed
 * structured-output response) should not drop a whole operation — one bad
 * round-trip is usually fixed by trying again a moment later. Callers wrap
 * the FULL operation (research + structuring for two-phase flows) so a
 * schema miss in phase 2 re-runs everything, not just the last call.
 */

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 */
import { logger } from './logger.js';

export async function withRetry(fn, { attempts = 3, baseDelayMs = 500, label = 'llm' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * 2 ** i;
        logger.warn(
          { label, attempt: i + 1, attempts, delayMs: delay, err: err.message },
          `[retry] ${label} attempt ${i + 1}/${attempts} failed; retrying`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}
