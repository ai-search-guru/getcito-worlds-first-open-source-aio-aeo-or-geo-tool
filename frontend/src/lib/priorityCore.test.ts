import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelOf, logScale, round } from './priorityCore';

/**
 * The web twin of the shared priority core (learning D4) gives what the
 * server's gives, case for case: the fixtures are the server's.
 */

interface Fixtures {
  logScale: { value: number; fullAt: number; result: number }[];
  round: { n: number; digits: number; result: number }[];
  levelOf: {
    score: number;
    cutoffs: { critical: number; high: number; medium: number };
    result: string;
  }[];
}

const fixtures: Fixtures = JSON.parse(
  readFileSync(join(__dirname, '../../../backend/src/lib/priority-core.fixtures.json'), 'utf8'),
);

describe("the server's cases", () => {
  it('logScale', () => {
    expect(fixtures.logScale.length).toBeGreaterThan(10);
    for (const c of fixtures.logScale) expect(logScale(c.value, c.fullAt)).toBe(c.result);
  });

  it('round', () => {
    for (const c of fixtures.round) expect(round(c.n, c.digits)).toBe(c.result);
  });

  it('levelOf', () => {
    for (const c of fixtures.levelOf) expect(levelOf(c.score, c.cutoffs)).toBe(c.result);
  });
});
