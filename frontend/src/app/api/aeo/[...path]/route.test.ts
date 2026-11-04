import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The same-origin proxy to the API: a read the API hasn't started answering
 * within a minute comes back as a 504 the page can say something about,
 * instead of hanging until the platform cuts the function off. Changes keep
 * their long limit (the suggestion runs).
 */

vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { GET, POST } = await import('./route');

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

/** An upstream that never answers, until the call is aborted. */
function hangs() {
  fetchMock.mockImplementation(
    (_url: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        );
      }),
  );
}
const call = (handler: typeof GET, method: string, path: string[]) =>
  handler(
    new NextRequest(`http://localhost/api/aeo/${path.join('/')}`, {
      method,
      ...(method === 'GET' ? {} : { body: '{}' }),
    }),
    { params: Promise.resolve({ path }) },
  );

describe('/api/aeo proxy', () => {
  it("answers a read the API hasn't started answering in a minute with a 504", async () => {
    hangs();
    const pending = call(GET, 'GET', ['api', 'integrations', 'config']);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: 'API server took too long to answer',
      code: 'upstream_timeout',
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example/api/integrations/config');
  });

  it('passes a read that answers in time through, and an unreachable API as a 502', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await call(GET, 'GET', ['api', 'catalog', 'connectors']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const down = await call(GET, 'GET', ['api', 'catalog', 'connectors']);
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: 'API server is unreachable' });
  });

  it('leaves a change without the read limit', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await call(POST, 'POST', ['api', 'topics', 'suggest']);
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });
});
