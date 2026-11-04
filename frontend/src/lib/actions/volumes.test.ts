import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The volume runs' failure codes: a workspace whose plan isn't active is told
 * apart from a plan without volume analysis, so the page can open the
 * upgrade dialog rather than say the plan lacks it.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));

const { startPromptVolumeAnalysis, refreshVolumes } = await import('./volumes');

const answer = (status: number, body: Record<string, unknown>) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the volume runs’ failure codes', () => {
  it('reads the server’s 402 subscription_inactive as subscription_inactive, not plan_limit', async () => {
    vi.stubGlobal(
      'fetch',
      answer(402, { success: false, error: 'plan_limit', code: 'subscription_inactive' }),
    );
    expect(await startPromptVolumeAnalysis('b1')).toEqual({
      ok: false,
      code: 'subscription_inactive',
    });
    expect(await refreshVolumes('b1')).toEqual({ ok: false, code: 'subscription_inactive' });
  });

  it('reads plan-guard’s 402 for no active subscription the same way', async () => {
    vi.stubGlobal('fetch', answer(402, { success: false, error: 'plan_limit', message: '…' }));
    expect(await startPromptVolumeAnalysis('b1')).toEqual({
      ok: false,
      code: 'subscription_inactive',
    });
  });

  it('keeps plan_limit for a plan without the feature, and quota_exceeded', async () => {
    vi.stubGlobal('fetch', answer(403, { success: false, error: 'plan_limit' }));
    expect(await startPromptVolumeAnalysis('b1')).toEqual({ ok: false, code: 'plan_limit' });
    vi.stubGlobal('fetch', answer(429, { error: 'quota_exceeded' }));
    expect(await refreshVolumes('b1')).toEqual({ ok: false, code: 'quota_exceeded' });
  });
});
