import { describe, expect, it } from 'vitest';
import { periodEndIso } from './periodEnd';

describe('periodEndIso', () => {
  it('reads the first item’s period end, as newer Stripe API versions put it', () => {
    expect(
      periodEndIso({
        items: { data: [{ current_period_end: 1_800_000_000 }] },
        current_period_end: 1_700_000_000,
      }),
    ).toBe('2027-01-15T08:00:00.000Z');
  });

  it('falls back to the subscription’s own, for older API versions', () => {
    expect(periodEndIso({ items: { data: [{}] }, current_period_end: 1_800_000_000 })).toBe(
      '2027-01-15T08:00:00.000Z',
    );
  });

  it('is null when Stripe gives none, or there is no subscription', () => {
    expect(periodEndIso({ items: { data: [] } })).toBeNull();
    expect(periodEndIso(null)).toBeNull();
    expect(periodEndIso(undefined)).toBeNull();
  });
});
