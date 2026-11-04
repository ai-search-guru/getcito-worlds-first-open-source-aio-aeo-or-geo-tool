import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/audits', () => ({}));
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { auditBlock } = await import('./_usePageActions');

/** When a bulk audit from the Pages section can't start (AT-006 part B). */
describe('auditBlock', () => {
  it('never blocks an unlimited or unknown quota', () => {
    expect(auditBlock(null, 50)).toBeNull();
    expect(auditBlock({ used: 900, limit: -1, remaining: -1 }, 50)).toBeNull();
  });

  it('never blocks without an active plan: 0 of 0 is no plan, not spent', () => {
    expect(auditBlock({ used: 40, limit: 0, remaining: 0, noPlan: true }, 3)).toBeNull();
    // A read-only workspace reads the same, marked or not.
    expect(auditBlock({ used: 40, limit: 0, remaining: 0 }, 3, true)).toBeNull();
    expect(auditBlock({ used: 40, limit: 0, remaining: 0 }, 3)).toEqual({ reason: 'noneLeft' });
  });

  it('blocks when the month is spent, or fewer are left than pages', () => {
    expect(auditBlock({ used: 100, limit: 100, remaining: 0 }, 1)).toEqual({ reason: 'noneLeft' });
    // Running audits and the auto-audit share can take it below zero.
    expect(auditBlock({ used: 98, limit: 100, remaining: -2 }, 1)).toEqual({ reason: 'noneLeft' });
    expect(auditBlock({ used: 97, limit: 100, remaining: 3 }, 4)).toEqual({
      reason: 'overQuota',
      remaining: 3,
    });
    expect(auditBlock({ used: 97, limit: 100, remaining: 3 }, 3)).toBeNull();
  });
});
