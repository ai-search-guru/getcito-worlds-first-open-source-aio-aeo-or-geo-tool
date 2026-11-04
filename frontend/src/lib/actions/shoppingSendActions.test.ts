import { afterEach, describe, expect, it, vi } from 'vitest';

/** "Send to Action Center" from Product Visibility (ECOM-013): the body the route gets. */

const BRAND = '33333333-3333-3333-3333-333333333333';
const CATEGORY = '22222222-0000-0000-0000-000000000002';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { sendShoppingActions } = await import('./shopping');

afterEach(() => {
  vi.unstubAllGlobals();
});

function sent() {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ actionId: 'a1', actionNo: 301, created: true })),
  );
  vi.stubGlobal('fetch', fetch);
  return () => {
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    return { url, body: JSON.parse(String(init.body)) };
  };
}

const promptId = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;

describe('sendShoppingActions', () => {
  it("sends a category's first 50 questions: the route refuses more", async () => {
    const body = sent();
    const ids = Array.from({ length: 80 }, (_, i) => promptId(i));
    expect(
      await sendShoppingActions(
        BRAND,
        { type: 'category', id: CATEGORY },
        [{ type: 'create_content', who: 'agent', why: 'Buying guide: how to choose tents' }],
        [ids[0], ...ids],
      ),
    ).toEqual({ actionId: 'a1', actionNo: 301, created: true });
    expect(body().url).toBe('https://api.example/api/action-center/products');
    expect(body().body.promptIds).toEqual(ids.slice(0, 50));
    expect(body().body.work).toEqual([
      { type: 'create_content', who: 'agent', why: 'Buying guide: how to choose tents' },
    ]);
  });

  it('cuts a work line past 500 characters at a word: the route refuses it whole', async () => {
    const body = sent();
    const title = 'Ridge 30L Ultralight Waterproof Hiking Backpack '.repeat(8).trim();
    const why = `A comparison, ${title} vs ${title}, with an FAQ`;
    expect(why.length).toBeGreaterThan(500);
    await sendShoppingActions(
      BRAND,
      { type: 'product', id: CATEGORY },
      [
        { type: 'create_content', who: 'agent', why },
        { type: 'technical', who: 'me' },
      ],
      [],
    );
    const [line, technical] = body().body.work;
    expect(line.why.length).toBeLessThanOrEqual(500);
    expect(line.why.endsWith('…')).toBe(true);
    expect(why.startsWith(line.why.slice(0, -1))).toBe(true);
    // At a word: the text before the ellipsis ends where a word of the line ends.
    expect(why[line.why.length - 1]).toBe(' ');
    expect(technical).toEqual({ type: 'technical', who: 'me' });
  });

  it('never leaves half of a character written as two', async () => {
    const body = sent();
    // No space to cut at, and an emoji across the 499th character.
    const why = `${'x'.repeat(498)}😀${'y'.repeat(20)}`;
    await sendShoppingActions(
      BRAND,
      { type: 'product', id: CATEGORY },
      [{ type: 'optimize_page', who: 'agent', why }],
      [],
    );
    const [line] = body().body.work;
    expect(line.why).toBe(`${'x'.repeat(498)}…`);
  });
});
