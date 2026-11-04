import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Which RPCs the nightly path is allowed to call.
 *
 * `ai_visibility_aggregates`, `insights_aggregates` and `competitor_aggregates`
 * rescan everything a brand has ever collected, and past roughly 25k results
 * that crosses the database's 8s statement timeout. Each has a `_daily`
 * variant answered from the rollup tables, whose cost scales with days in the
 * window instead.
 *
 * This is a grep, and it exists because the alternative failed twice. #829
 * moved the pulse's calls to the rollups and missed the one in the signal
 * recorder, which then threw every night on the largest brand and took the
 * whole pass with it — the second silent multi-day outage from the same
 * cause. A convention nothing checks is a convention that holds until someone
 * adds a call site.
 */
const NIGHTLY_MODULES = [
  'src/lib/signals/record.js',
  'src/lib/signals/lostCitationEvidence.js',
  'src/lib/signals/competitorEvidence.js',
  'src/lib/signals/mentionEvidence.js',
  'src/lib/signals/trafficEvidence.js',
  'src/lib/pulse/metrics.js',
  'src/lib/action-center/generate.js',
  'src/lib/action-center/priorityData.js',
  'src/lib/action-center/validate.js',
  'src/lib/action-center/execution/tools.js',
];

const RAW_AGGREGATES = ['ai_visibility_aggregates', 'insights_aggregates', 'competitor_aggregates'];

describe('the nightly path', () => {
  it.each(NIGHTLY_MODULES)('%s reads wide windows from the rollups', (file) => {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');

    for (const rpc of RAW_AGGREGATES) {
      // A direct call with the raw name as a literal: `rpc('name', …)`.
      // Deliberately not prose — these names appear in comments explaining
      // why they are not called — and deliberately not `rpc(daily('name',
      // window), …)`, which is the routed form that picks the rollup when the
      // window is expressed in whole days and the raw RPC only for the 24-hour
      // run-anchored window that no day window can express.
      const call = new RegExp(`rpc\\(\\s*['"\`]${rpc}(?!_daily)['"\`]`, 'g');
      const hits = [...source.matchAll(call)].map((match) => match[0]);
      expect({ file, rpc, hits }).toEqual({ file, rpc, hits: [] });
    }
  });

  /** A module joining the nightly path without joining this list would be
   *  unchecked, so the list itself has to stay honest. */
  it('covers every module the list names', () => {
    for (const file of NIGHTLY_MODULES) {
      expect(() =>
        readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'),
      ).not.toThrow();
    }
  });
});
