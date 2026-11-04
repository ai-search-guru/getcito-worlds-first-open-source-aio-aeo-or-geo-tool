import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The key guard as the agent checks read it (AGENT-OWN-KEY §4.2): from the
 * server with the internal secret, reached or not and when it renews, never
 * the dollars; only where Chat runs on the workspace's own key.
 */

const onOwnKey = vi.hoisted(() => ({ value: true }));
vi.mock('./key', () => ({ chatRunsOnOwnKey: vi.fn(async () => onOwnKey.value) }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { clearOwnKeyCap, forgetOwnKeyCap, ownKeyCapReached, readOwnKeyCap, readOwnKeyGuard } =
  await import('./ownKeyCap');

const ORG = '22222222-2222-4222-8222-222222222222';
const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

beforeEach(() => {
  clearOwnKeyCap();
  fetchMock.mockReset();
  onOwnKey.value = true;
  vi.stubEnv('CRON_SECRET', 'shh');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('readOwnKeyCap', () => {
  it('asks the server with the secret, keeps whether it is reached and when it renews, no dollars', async () => {
    answer({
      success: true,
      reached: true,
      usedUsd: 251.2,
      capUsd: 250,
      since: '2026-10-20T09:00:00.000Z',
      renewsAt: '2026-11-20T09:00:00.000Z',
    });
    expect(await readOwnKeyCap(ORG)).toEqual({
      reached: true,
      renewsAt: '2026-11-20T09:00:00.000Z',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://api.test/api/internal/chat/budget/own-key?orgId=${ORG}`);
    expect(init.headers).toEqual({ Authorization: 'Bearer shh' });

    // Kept a minute; a fresh read asks again.
    await readOwnKeyCap(ORG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await readOwnKeyCap(ORG, { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is null when the server doesn’t answer, refuses, or there is no secret', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await readOwnKeyCap(ORG)).toBeNull();
    answer({ success: false, error: 'chat_off' }, 403);
    expect(await readOwnKeyCap(ORG)).toBeNull();
    vi.stubEnv('CRON_SECRET', '');
    expect(await readOwnKeyCap(ORG)).toBeNull();
  });
});

describe('ownKeyCapReached', () => {
  it('answers the guard only when it is reached, and only on the own key', async () => {
    answer({ success: true, reached: false, renewsAt: '2026-11-20T09:00:00.000Z' });
    expect(await ownKeyCapReached(ORG)).toBeNull();

    clearOwnKeyCap();
    answer({ success: true, reached: true, renewsAt: '2026-11-20T09:00:00.000Z' });
    expect(await ownKeyCapReached(ORG)).toEqual({
      reached: true,
      renewsAt: '2026-11-20T09:00:00.000Z',
    });

    // Chat on GetCito's key: the guard isn't read at all.
    fetchMock.mockClear();
    onOwnKey.value = false;
    expect(await ownKeyCapReached(ORG, { fresh: true })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('readOwnKeyGuard', () => {
  it('reads the guard with this period’s spend, fresh every time', async () => {
    const body = {
      success: true,
      reached: false,
      usedUsd: 182.4,
      capUsd: 250,
      since: '2026-10-20T09:00:00.000Z',
      renewsAt: '2026-11-20T09:00:00.000Z',
    };
    // A new answer each call: a body reads once.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
    const guard = { capUsd: 250, usedUsd: 182.4, renewsAt: '2026-11-20T09:00:00.000Z' };
    expect(await readOwnKeyGuard(ORG)).toEqual(guard);
    expect(await readOwnKeyGuard(ORG)).toEqual(guard);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer shh' });
  });

  it('is null without numbers, an answer or a secret', async () => {
    answer({ success: true, reached: false, renewsAt: null });
    expect(await readOwnKeyGuard(ORG)).toBeNull();
    answer({ success: false, error: 'chat_off' }, 403);
    expect(await readOwnKeyGuard(ORG)).toBeNull();
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await readOwnKeyGuard(ORG)).toBeNull();
    vi.stubEnv('CRON_SECRET', '');
    expect(await readOwnKeyGuard(ORG)).toBeNull();
  });
});

describe('forgetOwnKeyCap', () => {
  it('makes the agent checks’ next read fresh once an Admin changed the guard', async () => {
    answer({ success: true, reached: true, renewsAt: null });
    await readOwnKeyCap(ORG);
    forgetOwnKeyCap(ORG);
    answer({ success: true, reached: false, renewsAt: null });
    expect(await readOwnKeyCap(ORG)).toEqual({ reached: false, renewsAt: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
