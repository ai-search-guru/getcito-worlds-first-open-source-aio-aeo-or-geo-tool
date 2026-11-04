import { describe, expect, it, vi } from 'vitest';

// record.js reaches the admin client at import time, whose config hard-exits
// without SUPABASE_* env (as in CI). The classifiers under test touch none of
// it — they are arithmetic over numbers the caller already fetched.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({ computePulseMetrics: vi.fn() }));

import { classifyCitationGap, classifyPlatformGap } from './record.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const { detection } = ENGINE_THRESHOLDS;

const rate = (platform, value) => ({ platform, rate: value });

describe('classifyPlatformGap', () => {
  /**
   * The pair that makes a gap mean something: proven somewhere, absent
   * elsewhere. Either half alone is not a finding.
   */
  it('reports a gap when the brand ranks well on one engine and poorly on another', () => {
    const gap = classifyPlatformGap([
      rate('a', detection.platformBestFloor + 20),
      rate('b', detection.platformBestFloor + 10),
      rate('c', detection.platformBestFloor - 10),
    ]);

    expect(gap).toMatchObject({ points: 30 });
    expect(gap.best.platform).toBe('a');
    expect(gap.worst.platform).toBe('c');
  });

  /**
   * Platforms differ for everyone — the average spread is 12 points — so a
   * gap under the threshold is the normal state rather than news.
   */
  it('says nothing about a spread narrower than platforms normally differ', () => {
    const narrow = detection.platformGapPoints - 1;
    expect(
      classifyPlatformGap([rate('a', 50), rate('b', 50 - narrow / 2), rate('c', 50 - narrow)]),
    ).toBeNull();
  });

  /**
   * Without the floor, a brand weak on every engine would be told it has a
   * platform opportunity. It has a visibility problem, which is a different
   * signal and a different action.
   */
  it('does not call it an opportunity when the brand ranks nowhere', () => {
    const below = detection.platformBestFloor - 1;
    expect(classifyPlatformGap([rate('a', below), rate('b', below / 2), rate('c', 0)])).toBeNull();
  });

  it('needs enough platforms to be comparing at all', () => {
    const rates = Array.from({ length: detection.platformMinCompared - 1 }, (_, i) =>
      rate(`p${i}`, i === 0 ? 60 : 0),
    );
    expect(classifyPlatformGap(rates)).toBeNull();
  });

  it('finds the extremes whatever order they arrive in', () => {
    const gap = classifyPlatformGap([rate('low', 5), rate('high', 60), rate('mid', 30)]);
    expect(gap.best.platform).toBe('high');
    expect(gap.worst.platform).toBe('low');
  });
});

describe('classifyCitationGap', () => {
  it('reports a competitor cited by a multiple, with a real body of citations', () => {
    expect(classifyCitationGap({ brandCitations: 40, leaderCitations: 120 })).toEqual({
      absoluteGap: 80,
    });
  });

  /**
   * A competitor leads two thirds of brands in any given week. Being behind
   * is the ordinary state; being behind by a multiple is the finding.
   */
  it('says nothing when the competitor is merely ahead', () => {
    expect(classifyCitationGap({ brandCitations: 100, leaderCitations: 140 })).toBeNull();
  });

  /**
   * Without the absolute floor, "twice as many" can mean four against two —
   * arithmetic on numbers too small to act on.
   */
  it('ignores a large multiple over small numbers', () => {
    expect(classifyCitationGap({ brandCitations: 2, leaderCitations: 8 })).toBeNull();
  });

  it('reports a brand cited nowhere when a competitor is cited widely', () => {
    expect(classifyCitationGap({ brandCitations: 0, leaderCitations: 60 })).toEqual({
      absoluteGap: 60,
    });
  });

  it('says nothing when the brand is ahead', () => {
    expect(classifyCitationGap({ brandCitations: 200, leaderCitations: 50 })).toBeNull();
  });
});
