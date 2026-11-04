// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A run's write through the API server for its person (apiAs): always
 * CHAT_ACTING_SECRET with X-Acting-User naming the run's person, never a
 * session's token or a cookie, and nothing sent while the way is closed.
 * The server's refusals of the way (401, 403 chat_off) come back as the
 * person's words.
 */

const SECRET = 'a'.repeat(64);
const PERSON = 'aaaaaaaa-0000-4000-8000-000000000001';
const actor = { userId: PERSON, organizationId: 'org-1' };

// A request's session, which apiAs never reads: the run's person is the context's.
const cookies = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: cookies }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { ACTING_USER_HEADER, ActingRefusedError, actingOpen, apiAs } = await import('./api');

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const sentHeaders = () => fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>;
const post = () => apiAs(actor, '/api/audits', { method: 'POST', body: { brandId: 'b' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CHAT_ACTING_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the acting way', () => {
  it('is open only with a secret as long as the server takes', () => {
    expect(actingOpen()).toBe(true);
    vi.stubEnv('CHAT_ACTING_SECRET', 'a'.repeat(31));
    expect(actingOpen()).toBe(false);
    vi.stubEnv('CHAT_ACTING_SECRET', '');
    expect(actingOpen()).toBe(false);
  });

  it('acts as the run’s person with the secret when no session is behind the request', async () => {
    answer(200, { ok: true });
    expect(await post()).toEqual({ status: 200, ok: true, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/audits');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(JSON.parse(init.body)).toEqual({ brandId: 'b' });
    expect(sentHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
      [ACTING_USER_HEADER]: PERSON,
    });
  });

  it('never reads a session or a cookie: the run’s person is the context’s', async () => {
    answer(200, {});
    answer(200, {});
    await post();
    await apiAs({ ...actor, userId: 'aaaaaaaa-0000-4000-8000-000000000002' }, '/api/audits', {
      method: 'POST',
    });
    expect(cookies).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([, init]) => init.headers[ACTING_USER_HEADER])).toEqual([
      PERSON,
      'aaaaaaaa-0000-4000-8000-000000000002',
    ]);
  });

  it('sends nothing while the way is closed: the person’s words instead', async () => {
    vi.stubEnv('CHAT_ACTING_SECRET', 'short');
    const err = await post().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActingRefusedError);
    expect((err as InstanceType<typeof ActingRefusedError>).refusal).toMatchObject({
      ok: false,
      reason: 'acting_refused',
      message: expect.stringMatching(/\w/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the server’s refusals of the way in the person’s words: 401, and Chat off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    answer(401, { message: 'Unauthorized API Request' });
    await expect(post()).rejects.toMatchObject({ refusal: { reason: 'acting_refused' } });
    // The secrets differ: a setup to fix, said once as a warning, never with the secret.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    answer(403, { code: 'chat_off', message: 'Chat is off for this workspace' });
    await expect(post()).rejects.toMatchObject({ refusal: { reason: 'chat_off' } });
    // Any other refusal is the route's own answer, for the caller to read.
    answer(403, { code: 'no_brand_access' });
    expect(await post()).toEqual({ status: 403, ok: false, body: { code: 'no_brand_access' } });
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('sends no body or content type for a request without one, and reads an empty answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    const res = await apiAs(actor, '/api/prompts/suggestions/s-1/dismiss', { method: 'POST' });
    expect(res).toEqual({ status: 200, ok: true, body: {} });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeUndefined();
    expect(sentHeaders()['Content-Type']).toBeUndefined();
  });
});
