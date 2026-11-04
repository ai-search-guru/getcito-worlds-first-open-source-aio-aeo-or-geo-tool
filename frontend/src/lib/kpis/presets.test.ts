import { describe, expect, it } from 'vitest';
import { isValidKpiTarget } from './registry';
import { PRESET_KPIS, presetKpiKeys, presetTarget } from './presets';

describe('presetKpiKeys', () => {
  it('adds AI Referral Traffic only when Google Analytics is mapped', () => {
    expect(presetKpiKeys(false)).toEqual([
      'ai_visibility',
      'mentions',
      'citations',
      'share_of_voice',
      'positive_sentiment',
    ]);
    expect(presetKpiKeys(true)).toEqual([...PRESET_KPIS, 'ai_referral_traffic']);
  });
});

describe('presetTarget', () => {
  it('aims 20% above the last 30 days', () => {
    expect(presetTarget('positive_sentiment', 40)).toBe(48);
    expect(presetTarget('ai_visibility', 33.3)).toBe(40);
    expect(presetTarget('mentions', 107)).toBe(129);
    expect(presetTarget('ai_referral_traffic', 10)).toBe(12);
  });

  it('keeps a percent target at most 100', () => {
    expect(presetTarget('share_of_voice', 90)).toBe(100);
  });

  it("starts from the registry's default without a value", () => {
    expect(presetTarget('mentions', 0)).toBe(100);
    expect(presetTarget('positive_sentiment', null)).toBe(50);
    expect(presetTarget('ai_visibility', Number.NaN)).toBe(50);
  });

  it('always gives a target the framework accepts', () => {
    for (const key of presetKpiKeys(true)) {
      for (const value of [null, 0, 0.01, 1, 55.5, 99.9, 100, 12_345]) {
        expect(isValidKpiTarget(key, presetTarget(key, value))).toBe(true);
      }
    }
  });
});
