import { describe, expect, it, vi } from 'vitest';

// metrics.js reaches the admin client at import time, whose config hard-exits
// without SUPABASE_* env (as in CI). The classifier under test touches none
// of it — it is pure arithmetic over two numbers.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { classifyVisibilityFall } from './metrics.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const { detection } = ENGINE_THRESHOLDS;
const ENOUGH_PROMPTS = detection.visibilityDropMinPrompts;

const fall = (from, to, over = {}) =>
  classifyVisibilityFall({ from, to, promptCount: ENOUGH_PROMPTS, ...over });

describe('classifyVisibilityFall', () => {
  /**
   * The regression this whole change exists for. The rule used to demand 15
   * absolute points, so a brand whose visibility never reached 15 could lose
   * all of it and go unreported — which is why the detector had not fired
   * once in production. Scores across live brands average under 10.
   */
  it('reports a collapse at a low baseline, which a points threshold could not', () => {
    expect(fall(6.5, 2.3)).toEqual({ type: 'sharp_drop', drop: 4.2 });
  });

  it('still reports a collapse at a high baseline', () => {
    expect(fall(48, 20)).toEqual({ type: 'sharp_drop', drop: 28 });
  });

  /**
   * The noise floor. Week-to-week movement averages 1.3 points on its own;
   * without this, a brand sitting at 2.0 losing 1.0 would be filed as having
   * lost half its visibility every other week.
   */
  it('ignores a large relative loss that is only noise in absolute terms', () => {
    const noise = detection.visibilityDropFloorPoints - 0.1;
    expect(fall(3, 3 - noise)).toBeNull();
  });

  it('reports early deterioration from a position worth protecting', () => {
    const from = detection.slippingMinBaseline + 10;
    const drop = from * 0.15; // inside the band: past slipping, short of collapse
    expect(fall(from, from - drop)).toMatchObject({ type: 'visibility_slipping' });
  });

  /**
   * The two grades are exclusive and ordered. A fall severe enough to be a
   * collapse is that, not an early warning — otherwise Protect and Recover
   * would fire on the same brand for the same week.
   */
  it('grades a severe fall as a collapse, never as slipping', () => {
    const from = detection.slippingMinBaseline + 10;
    const drop = from * 0.5;
    expect(fall(from, from - drop)).toMatchObject({ type: 'sharp_drop' });
  });

  /** Protect is for brands with something to protect. The same relative slip
   *  at a low base is a brand that was barely visible to begin with. */
  it('does not warn about slipping when there was no position to hold', () => {
    const from = detection.slippingMinBaseline - 1;
    const drop = from * (detection.slippingMinRatio + 0.05);
    expect(fall(from, from - drop)).toBeNull();
  });

  it('says nothing about a brand whose visibility rose', () => {
    expect(fall(10, 25)).toBeNull();
  });

  it('says nothing when too few prompts are tracked to average over', () => {
    expect(fall(40, 10, { promptCount: ENOUGH_PROMPTS - 1 })).toBeNull();
  });

  /**
   * A platform-wide collection incident makes every brand look like it
   * collapsed. Reporting that as their problem would be worse than silence.
   */
  it('stays silent during a platform outage', () => {
    expect(fall(40, 10, { outage: true })).toBeNull();
  });

  it('handles a brand that had no visibility to lose', () => {
    expect(fall(0, 0)).toBeNull();
  });
});
