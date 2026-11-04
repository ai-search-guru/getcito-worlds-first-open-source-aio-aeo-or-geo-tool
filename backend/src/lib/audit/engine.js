/**
 * Run every implemented signal over an audit context. A signal that throws is
 * recorded as 'na' (not applicable / errored) rather than aborting the run, so
 * one bad check never sinks the whole audit.
 */

import { signalRegistry } from './signals/index.js';

/**
 * @param {import('./context.js').AuditContext} ctx
 * @returns {Promise<Array<{ key: string, status: string, score: number|null, evidence: object }>>}
 */
export async function runSignals(ctx) {
  const results = [];
  for (const signal of signalRegistry) {
    try {
      const verdict = await signal.evaluate(ctx);
      results.push({
        key: signal.key,
        status: verdict.status,
        score: verdict.score,
        evidence: verdict.evidence ?? {},
      });
    } catch (err) {
      results.push({
        key: signal.key,
        status: 'na',
        score: null,
        evidence: { error: err.message },
      });
    }
  }
  return results;
}
