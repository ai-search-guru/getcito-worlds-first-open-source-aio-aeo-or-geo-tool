import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's facts (Quality CE-047) through the API: read, read again,
 * approved or rejected; errors returned, not thrown.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  })),
}));

const { getBrandFacts, readBrandFactsAgain, setBrandFactStatus } = await import('./brandFacts');

const BRAND = '33333333-3333-3333-3333-333333333333';
const FACT = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
let response: Response;
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
  async () => response,
);

beforeEach(() => {
  response = new Response(JSON.stringify({ facts: [], pages: [], paused: true }), { status: 200 });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('brand facts actions', () => {
  it('reads the facts, filling what the API leaves out', async () => {
    expect(await getBrandFacts(BRAND)).toEqual({
      facts: [],
      pages: [],
      checkedAt: null,
      recheckAt: null,
      paused: true,
      noDomain: false,
    });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/brand-facts\?brandId=33333333-/);
  });

  it('reads the site again, and approves or rejects a fact', async () => {
    await readBrandFactsAgain(BRAND);
    expect(fetchMock.mock.calls[0]).toEqual([
      expect.stringMatching(/\/api\/brand-facts\/fetch$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ brandId: BRAND }) }),
    ]);
    response = new Response(JSON.stringify({ id: FACT, status: 'approved' }), { status: 200 });
    expect(await setBrandFactStatus(FACT, 'approved')).toEqual({ id: FACT, status: 'approved' });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH' });
  });

  it('says off before phase 2, failed otherwise, and asks nothing for a malformed id', async () => {
    response = new Response(JSON.stringify({ code: 'off' }), { status: 404 });
    expect(await getBrandFacts(BRAND)).toEqual({ error: 'off' });
    response = new Response('{}', { status: 500 });
    expect(await getBrandFacts(BRAND)).toEqual({ error: 'failed' });
    fetchMock.mockClear();
    expect(await getBrandFacts('nope')).toEqual({ error: 'invalid' });
    expect(await setBrandFactStatus(FACT, 'pending' as unknown as 'approved')).toEqual({
      error: 'invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
