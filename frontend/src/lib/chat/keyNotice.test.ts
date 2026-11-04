import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The web asks the server to tell the Admins the own key fails (00441):
 * with CRON_SECRET, never throwing.
 */

vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { notifyOwnKeyFailure } = await import('./keyNotice');

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CRON_SECRET', 'shh');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('notifyOwnKeyFailure', () => {
  it('posts the episode with the secret', async () => {
    expect(await notifyOwnKeyFailure('org-1', 'openai', '2026-11-01T09:00:00.000Z')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/internal/chat/notices/own-key');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer shh' } });
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      provider: 'openai',
      since: '2026-11-01T09:00:00.000Z',
      reminder: false,
    });
  });

  it('says false, without throwing, when it couldn’t ask', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await notifyOwnKeyFailure('org-1', 'openai', '2026-11-01T09:00:00.000Z')).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect(await notifyOwnKeyFailure('org-1', 'openai', '2026-11-01T09:00:00.000Z')).toBe(false);
    vi.stubEnv('CRON_SECRET', '');
    expect(await notifyOwnKeyFailure('org-1', 'openai', '2026-11-01T09:00:00.000Z')).toBe(false);
  });
});
