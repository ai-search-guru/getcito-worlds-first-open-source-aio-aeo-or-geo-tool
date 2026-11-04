import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Site trust's read (CE-043): what the card gets from the API, with whether
 * the site answered all of it when the API says so.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  })),
}));

const { getSiteTrust } = await import('./audits');

const READ = {
  checks: {
    about: { ok: true, url: 'https://acme.com/about' },
    contact: { ok: false, url: null },
    editorial: { ok: false, url: null },
    organizationSchema: { ok: false, url: null },
    authorPages: { ok: false, authors: [] },
  },
  score: 1,
  checkedAt: '2026-10-23T12:00:00.000Z',
};

let body: unknown;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSiteTrust', () => {
  it("passes on that the site didn't answer all of it", async () => {
    body = { ...READ, complete: false };
    expect(await getSiteTrust('b1')).toEqual({ ...READ, complete: false });
  });

  it('reads an older API without it', async () => {
    body = READ;
    const read = await getSiteTrust('b1');
    expect(read).toEqual(READ);
    expect('complete' in read).toBe(false);
  });
});
