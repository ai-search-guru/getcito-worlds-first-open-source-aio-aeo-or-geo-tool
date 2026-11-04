import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The demo brand on the API (POST and PATCH /api/demo), from the browser through the proxy. */

let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const { demoPreparation, ensureDemoBrand, prepareDemoBrand, resetDemoPreparation, setDemoHidden } =
  await import('./demoClient');

const fetchMock = vi.fn();
beforeEach(() => {
  resetDemoPreparation();
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('ensureDemoBrand', () => {
  it('makes or updates the demo brand, with the session', async () => {
    answer(200, { brandId: 'demo1', version: 3, rebuilt: true });
    expect(await ensureDemoBrand()).toEqual({
      ok: true,
      brandId: 'demo1',
      version: 3,
      rebuilt: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/demo');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });
  });

  it('says a refusal with its status, and an answer without a brand as a failure', async () => {
    answer(403, { error: 'Forbidden' });
    expect(await ensureDemoBrand()).toEqual({ ok: false, status: 403 });
    answer(200, {});
    expect(await ensureDemoBrand()).toEqual({ ok: false, status: 200 });
  });

  it('never throws: no session, or no answer', async () => {
    session = null;
    expect(await ensureDemoBrand()).toEqual({ ok: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    session = { access_token: 'tok' };
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await ensureDemoBrand()).toEqual({ ok: false, status: 0 });
  });
});

describe('setDemoHidden', () => {
  it('hides the demo brand, or shows it again', async () => {
    answer(200, { brandId: 'demo1', hidden: true });
    expect(await setDemoHidden(true)).toEqual({ ok: true, brandId: 'demo1', hidden: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/demo');
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ hidden: true }) });
  });
});

describe('prepareDemoBrand', () => {
  it('asks once per page: a setup started ahead is the one the click waits for', async () => {
    answer(200, { brandId: 'demo1', version: 3, rebuilt: true });
    const ahead = prepareDemoBrand();
    const click = prepareDemoBrand();
    expect(click).toBe(ahead);
    expect(await click).toMatchObject({ ok: true, brandId: 'demo1' });
    expect(await prepareDemoBrand()).toMatchObject({ ok: true, brandId: 'demo1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failure', async () => {
    answer(500, {});
    expect(await prepareDemoBrand()).toEqual({ ok: false, status: 500 });
    expect(demoPreparation()).toBeNull();
    answer(200, { brandId: 'demo1', version: 3, rebuilt: false });
    expect(await prepareDemoBrand()).toMatchObject({ ok: true, brandId: 'demo1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says when the setup was asked and whether it answered', async () => {
    expect(demoPreparation()).toBeNull();
    let reply: (res: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (reply = resolve)));
    const before = Date.now();
    const request = prepareDemoBrand();
    const asked = demoPreparation();
    expect(asked).toEqual({ startedAt: expect.any(Number), answered: false });
    expect(asked!.startedAt).toBeGreaterThanOrEqual(before);
    // The session is read before the request goes out.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    reply(new Response(JSON.stringify({ brandId: 'demo1', version: 3, rebuilt: true })));
    await request;
    expect(demoPreparation()).toEqual({ startedAt: asked!.startedAt, answered: true });
  });
});
