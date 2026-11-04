import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAiUsage, readDraftAiUsage, readUsageLimits } from './aiUsageClient';

/**
 * The header meter's reads, from the browser through the API's proxy: the
 * period's AI usage, and the limits that aren't AI for its popover.
 */

let session: { access_token: string } | null;
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  session = { access_token: 'token-1' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('readAiUsage', () => {
  it('reads the period’s usage through the proxy', async () => {
    fetchMock.mockResolvedValue(answer(200, { unlimited: false, percentUsed: 21 }));
    expect(await readAiUsage()).toEqual({ unlimited: false, percentUsed: 21 });
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/billing/ai-usage', {
      headers: { Authorization: 'Bearer token-1' },
      cache: 'no-store',
      // A read that hangs gives up, so the meter can read again.
      signal: expect.any(AbortSignal),
    });
  });

  it('reads an older API’s answer the new way: quality in the Content Editor, no unused rows', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        unlimited: false,
        percentUsed: 1.3,
        features: [
          { feature: 'improve', percent: 0 },
          { feature: 'content', percent: 1.2 },
          { feature: 'action_center', percent: 0 },
          { feature: 'quality', percent: 0.1 },
        ],
      }),
    );
    expect(await readAiUsage()).toEqual({
      unlimited: false,
      percentUsed: 1.3,
      features: [{ feature: 'content', percent: 1.3 }],
    });
  });

  it('is null without an active plan', async () => {
    fetchMock.mockResolvedValue(answer(402, { error: 'plan_limit' }));
    expect(await readAiUsage()).toBeNull();
  });

  it('throws when it can’t be read, or without a session', async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Failed to read AI usage' }));
    await expect(readAiUsage()).rejects.toThrow('Failed to read AI usage');
    session = null;
    await expect(readAiUsage()).rejects.toThrow('Not authenticated');
  });
});

describe('readUsageLimits', () => {
  const prompts = (locationLimit: number | null) => ({
    plan: { key: 'growth', name: 'Growth plan', locationLimit, cta: 'upgrade' },
    brand: { active: 3, paused: 0, total: 3 },
    account: { activePrompts: 40, brands: 2, locationsUsed: 148 },
    updatedAt: '2026-10-23T10:00:00Z',
  });

  it('counts Site Audit pages with the running ones, and the account’s prompt locations', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/aeo/api/audits/quota')
        ? answer(200, { success: true, quota: { used: 40, running: 2, limit: 500 } })
        : answer(200, prompts(200)),
    );
    expect(await readUsageLimits('b1')).toEqual({
      auditPages: { used: 42, limit: 500 },
      promptLocations: { used: 148, limit: 200 },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/audits/quota', {
      headers: { Authorization: 'Bearer token-1' },
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/prompts/usage?brandId=b1', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it('leaves out a limit with no cap, one it can’t read, and prompts without a brand', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/aeo/api/audits/quota')
        ? answer(200, { success: true, quota: { used: 0, running: 0, limit: -1 } })
        : answer(200, prompts(null)),
    );
    expect(await readUsageLimits('b1')).toEqual({ auditPages: null, promptLocations: null });

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await readUsageLimits(null)).toEqual({ auditPages: null, promptLocations: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('readDraftAiUsage', () => {
  it('reads the page’s share through the proxy', async () => {
    fetchMock.mockResolvedValue(answer(200, { unlimited: false, percent: 3.7 }));
    expect(await readDraftAiUsage('d 1')).toBe(3.7);
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/billing/ai-usage/draft/d%201', {
      headers: { Authorization: 'Bearer token-1' },
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it('is null on a plan without an allowance, when it can’t be read, or without a session', async () => {
    fetchMock.mockResolvedValue(answer(200, { unlimited: true, percent: null }));
    expect(await readDraftAiUsage('d1')).toBeNull();
    fetchMock.mockResolvedValue(answer(402, { error: 'plan_limit' }));
    expect(await readDraftAiUsage('d1')).toBeNull();
    session = null;
    fetchMock.mockClear();
    expect(await readDraftAiUsage('d1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
