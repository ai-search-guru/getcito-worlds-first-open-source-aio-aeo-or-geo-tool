import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The page read (CE-049) and its AI checks (CE-050), as the API gives them. */

const DRAFT = '77777777-7777-7777-7777-777777777777';

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  })),
}));

const { readDraftPage } = await import('./contentDrafts');

const answer = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

const PICK = {
  quote: 'Our top pick is Ridge 28',
  block: 'Our top pick is Ridge 28, ahead of Talon.',
};

beforeEach(() => answer({ spots: [], proofs: [], regulated: null, checks: null }));
afterEach(() => vi.unstubAllGlobals());

describe('readDraftPage', () => {
  it('gives the checks the page read found, each with its words', async () => {
    answer({
      spots: [],
      proofs: [],
      regulated: null,
      checks: {
        answerFirst: { answers: false, block: 'By the way, packs vary.' },
        recommends: PICK,
        disclosure: null,
        balance: { quote: '', block: 'x' },
        how: { block: 'no quote' },
        cut: true,
        pageType: 'best_of',
      },
      pending: false,
    });
    expect(await readDraftPage(DRAFT)).toMatchObject({
      checks: {
        answerFirst: { answers: false, block: 'By the way, packs vary.' },
        recommends: PICK,
        disclosure: null,
        // Not a find: no words, or no quote.
        balance: null,
        how: null,
        cut: true,
        pageType: 'best_of',
      },
    });
  });

  it('gives no checks for a read without them, or one shaped otherwise', async () => {
    expect(await readDraftPage(DRAFT)).toMatchObject({ checks: null });
    answer({ spots: [], proofs: [], regulated: null, checks: 'yes' });
    expect(await readDraftPage(DRAFT)).toMatchObject({ checks: null });
    answer({
      spots: [],
      proofs: [],
      regulated: null,
      checks: { answerFirst: { answers: 'yes', block: 'x' } },
    });
    expect(await readDraftPage(DRAFT)).toMatchObject({
      checks: { answerFirst: null, recommends: null, cut: false, pageType: null },
    });
  });
});
