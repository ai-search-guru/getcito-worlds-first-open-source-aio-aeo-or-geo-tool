// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Why card's answer in the evidence drawer (CHAT-22 §1 item 4): found by
 * the run and the row's places, never kept by the browser; a place that
 * isn't one, or an answer the person can't open, is 404.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const RUN = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/runApi', async (original) => ({
  ...(await original<typeof import('@/lib/chat/runApi')>()),
  chatActor: async () => ACTOR,
}));
const why = vi.hoisted(() => ({ readWhyAnswer: vi.fn() }));
vi.mock('@/lib/chat/why/answer', () => why);

const { GET } = await import('./route');

const params = (n: string, cause: string, row: string, id = RUN) => ({
  params: Promise.resolve({ id, n, cause, row }),
});
const ANSWER = {
  engine: 'google-aio',
  date: '2026-10-24',
  passage: [{ text: 'Acme', mark: true }],
  citations: [{ url: 'acme.example/blog', own: true }],
};

beforeEach(() => why.readWhyAnswer.mockReset());

describe('GET /api/chat/runs/{id}/why/{n}/{cause}/{row}', () => {
  it('answers the row’s answer, kept by no one', async () => {
    why.readWhyAnswer.mockResolvedValueOnce(ANSWER);
    const res = await GET(new Request('http://x'), params('1', '0', '2'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ answer: ANSWER });
    expect(why.readWhyAnswer).toHaveBeenCalledWith(RUN, 1, 0, 2);
  });

  it('is 404 for a place that isn’t one, or an answer it can’t open', async () => {
    for (const [n, cause, row, id] of [
      ['0', '0', '0', RUN],
      ['1', '-1', '0', RUN],
      ['1', '0', '1.5', RUN],
      ['1', '0', 'x', RUN],
      ['1', '0', '0', 'not-a-run'],
    ]) {
      expect((await GET(new Request('http://x'), params(n, cause, row, id))).status).toBe(404);
    }
    expect(why.readWhyAnswer).not.toHaveBeenCalled();
    why.readWhyAnswer.mockResolvedValueOnce(null);
    expect((await GET(new Request('http://x'), params('1', '0', '0'))).status).toBe(404);
  });

  it('says it failed, without its reason, when the read throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    why.readWhyAnswer.mockRejectedValueOnce(new Error('relation does not exist'));
    const res = await GET(new Request('http://x'), params('1', '0', '0'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('relation');
    logged.mockRestore();
  });
});
