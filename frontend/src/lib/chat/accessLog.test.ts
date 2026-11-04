// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./activity', () => ({ recordActivity: vi.fn(async () => 'row-1') }));

const { recordActivity } = await import('./activity');
const { accessDeniedEvent, recordAccessDenied } = await import('./accessLog');
type AccessDeniedContext = import('./accessLog').AccessDeniedContext;

/** Every denial is an `access.denied` event (CHAT-20 §4c). */

const ctx: AccessDeniedContext = {
  userId: 'u1',
  organizationId: 'o1',
  brandId: 'b1',
  toolKey: 'saveDraft',
  toolClass: 'write',
  surface: 'chat',
  conversationId: 'c1',
};

afterEach(() => vi.restoreAllMocks());

describe('accessDeniedEvent', () => {
  it('keeps who, which tool by its label key, why, where and in which run', () => {
    expect(accessDeniedEvent(ctx, { code: 'plan_locked', needs: 'growth' })).toEqual({
      kind: 'access.denied',
      userId: 'u1',
      organizationId: 'o1',
      brandId: 'b1',
      toolKey: 'saveDraft',
      toolClass: 'write',
      surface: 'chat',
      reason: 'plan_locked',
      detail: { needs: 'growth' },
      conversationId: 'c1',
      runId: null,
    });
  });

  it("names no brand the person can't see", () => {
    expect(accessDeniedEvent(ctx, { code: 'brand_scope' }).brandId).toBeNull();
  });
});

describe('recordAccessDenied', () => {
  it('writes the denial as its Activity log row', async () => {
    await recordAccessDenied(ctx, { code: 'forbidden_role', role: 'analyst', roles: ['admin'] });
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'access.denied',
        toolKey: 'saveDraft',
        reason: 'forbidden_role',
        detail: { role: 'analyst', roles: ['admin'] },
      }),
    );
  });

  it('never fails the run: a failed write goes to the server log', async () => {
    vi.mocked(recordActivity).mockRejectedValueOnce(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordAccessDenied(ctx, { code: 'policy_never' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      '[chat] could not record access.denied',
      expect.stringContaining('"policy_never"'),
      expect.any(Error),
    );
  });
});
