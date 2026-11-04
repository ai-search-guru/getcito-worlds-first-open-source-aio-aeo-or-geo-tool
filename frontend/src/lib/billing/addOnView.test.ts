import { describe, expect, it } from 'vitest';
import { creditLeftCents, creditLine, packAdds, purchaseState } from './addOnView';

const ai = (grant: number) => ({ kind: 'ai' as const, grant_ai_usd: grant, grant_bytes: null });

describe('what a pack adds', () => {
  it('is a share of the plan’s monthly AI limit, never dollars (CHAT-18 item 3)', () => {
    // Growth's $25: the $10, $50, $250 and $1,000 packs.
    expect([5, 25, 125, 500].map((g) => packAdds(ai(g), 25))).toEqual([
      { kind: 'share', percent: 20 },
      { kind: 'limits', count: 1 },
      { kind: 'limits', count: 5 },
      { kind: 'limits', count: 20 },
    ]);
    // Starter's $5.
    expect([5, 25, 125, 500].map((g) => packAdds(ai(g), 5))).toEqual([
      { kind: 'limits', count: 1 },
      { kind: 'limits', count: 5 },
      { kind: 'limits', count: 25 },
      { kind: 'limits', count: 100 },
    ]);
    // Enterprise's $50: never rounded up.
    expect(packAdds(ai(125), 50)).toEqual({ kind: 'limits', count: 2.5 });
    expect(packAdds(ai(5), 60)).toEqual({ kind: 'share', percent: 8 });
  });

  it('is nothing to measure without a monthly limit, and GB for storage', () => {
    expect(packAdds(ai(25), null)).toBeNull();
    expect(packAdds({ kind: 'storage', grant_ai_usd: null, grant_bytes: 26843545600 }, 25)).toEqual(
      {
        kind: 'storage',
        gb: 25,
      },
    );
  });
});

const NOW = new Date('2026-10-30T12:00:00Z');
const grant = (used: number, expiresAt: string) => ({
  usdTotal: 25,
  usdUsed: used,
  expiresAt,
  priceCents: 5000,
  grantUsd: 25,
});

describe('the credit left', () => {
  it('shows at the pack’s price, rounded down: what was paid, not the model cost', () => {
    expect(creditLeftCents(grant(0, '2027-10-30T00:00:00Z'))).toBe(5000);
    expect(creditLeftCents(grant(0.9, '2027-10-30T00:00:00Z'))).toBe(4820);
    expect(creditLeftCents(grant(24.999999, '2027-10-30T00:00:00Z'))).toBe(0);
  });

  it('adds up the packs still valid, and ends when the soonest of them does', () => {
    expect(
      creditLine(
        [
          grant(5, '2027-10-01T00:00:00Z'),
          grant(0, '2027-03-01T00:00:00Z'),
          // Used up and expired ones don't count.
          grant(25, '2027-01-01T00:00:00Z'),
          grant(0, '2026-10-01T00:00:00Z'),
        ],
        NOW,
      ),
    ).toEqual({ leftCents: 9000, expiresAt: '2027-03-01T00:00:00Z' });
    expect(creditLine([grant(25, '2027-01-01T00:00:00Z')], NOW)).toBeNull();
  });
});

describe('a purchase’s state', () => {
  const later = { leftCents: 100, until: '2027-01-01T00:00:00Z' };
  it('reads as the history lists it', () => {
    expect(purchaseState({ status: 'pending', kind: 'ai' }, null, NOW)).toBe('processing');
    expect(purchaseState({ status: 'paid', kind: 'ai' }, later, NOW)).toBe('active');
    expect(purchaseState({ status: 'paid', kind: 'ai' }, { ...later, leftCents: 0 }, NOW)).toBe(
      'used_up',
    );
    expect(
      purchaseState(
        { status: 'paid', kind: 'ai' },
        { ...later, until: '2026-10-01T00:00:00Z' },
        NOW,
      ),
    ).toBe('expired');
    expect(purchaseState({ status: 'paid', kind: 'storage' }, later, NOW)).toBe('active');
    expect(
      purchaseState(
        { status: 'paid', kind: 'storage' },
        { leftCents: 0, until: '2026-10-29T00:00:00Z' },
        NOW,
      ),
    ).toBe('ended');
    expect(purchaseState({ status: 'refunded', kind: 'ai' }, later, NOW)).toBe('refunded');
    expect(purchaseState({ status: 'failed', kind: 'ai' }, null, NOW)).toBeNull();
  });
});
