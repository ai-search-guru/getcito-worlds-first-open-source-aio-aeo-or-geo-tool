import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * trackSuggestions (VIS-011): an Opportunities topic's "Track N". Each
 * prompt is added through the single Track's addPromptToSet, so the plan
 * check holds per prompt, and the run stops where the plan's prompt
 * locations run out; suggestions handled elsewhere are skipped.
 */

let slotsLeft = Infinity;
let added: string[] = [];
/** Suggestions still 'new'; others were accepted or dismissed elsewhere. */
let open: Set<string>;
let reads: string[] = [];
/** The brand's topics, and the ones made or removed while tracking. */
let brandTopics: string[] = [];
let madeTopics: string[] = [];
let removedTopics: string[] = [];
let categories: (string | undefined)[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://server' }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    from: (table: string) => {
      reads.push(table);
      let ids: string[] = [];
      const suggestion = (id: string) => ({
        id,
        brand_id: 'b1',
        suggested_text: `prompt ${id}`,
        topic_name: 'GEO tools',
      });
      const row = () =>
        table === 'prompt_sets' ? { id: 'ps1' } : { platforms: ['chatgpt-web'], models: [] };
      let made: { id: string; name: string } | null = null;
      let removing = false;
      const chain = {
        select: () => chain,
        in: (_col: string, val: string[]) => {
          ids = val;
          return chain;
        },
        eq: (_col: string, val: string) => {
          if (removing) removedTopics.push(val);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        insert: (r: { name: string }) => {
          madeTopics.push(r.name);
          made = { id: `topic-${madeTopics.length}`, name: r.name };
          return chain;
        },
        delete: () => {
          removing = true;
          return chain;
        },
        single: async () => ({ data: made, error: null }),
        maybeSingle: async () => ({ data: row(), error: null }),
        then: (resolve: (r: unknown) => void) =>
          resolve(
            table === 'topics'
              ? { data: brandTopics.map((name) => ({ name })), error: null }
              : { data: ids.filter((id) => open.has(id)).map(suggestion), error: null },
          ),
      };
      return chain;
    },
  })),
}));

vi.mock('@/lib/actions/prompt', () => ({
  addPromptToSet: vi.fn(async ({ text, category }: { text: string; category?: string }) => {
    categories.push(category);
    if (slotsLeft <= 0) {
      return { error: 'Your plan’s prompt locations are full.', code: 'plan_limit' };
    }
    slotsLeft -= 1;
    added.push(text);
    return { prompt: { id: `p-${added.length}` } };
  }),
}));

const targets: { promptId: string; url: string }[] = [];
let targetError: string | null = null;
vi.mock('@/lib/actions/promptWorkflow', () => ({
  addPromptTargetUrl: vi.fn(async (promptId: string, url: string) => {
    if (targetError) return { error: targetError };
    targets.push({ promptId, url });
    return { targetUrl: { id: `t-${promptId}`, url } };
  }),
}));

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

const {
  dismissSuggestions,
  getPromptSuggestions,
  refreshPromptSuggestions,
  trackPagePrompts,
  trackSuggestions,
} = await import('./promptSuggestions');

beforeEach(() => {
  slotsLeft = Infinity;
  added = [];
  targets.length = 0;
  targetError = null;
  brandTopics = [];
  madeTopics = [];
  removedTopics = [];
  categories = [];
  reads = [];
  open = new Set(['s1', 's2', 's3', 's4']);
  fetchMock.mockClear();
});

describe('trackSuggestions', () => {
  it('tracks each suggestion in order and marks it added', async () => {
    expect(await trackSuggestions(['s1', 's2', 's3'])).toEqual({
      trackedIds: ['s1', 's2', 's3'],
      skippedIds: [],
    });
    expect(added).toEqual(['prompt s1', 'prompt s2', 'prompt s3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The suggestions, the prompt set and its defaults are read once, not per prompt.
    expect(reads).toEqual(['prompt_suggestions', 'prompt_sets', 'prompts']);
  });

  it('stops where the plan’s prompt locations run out', async () => {
    slotsLeft = 2;
    expect(await trackSuggestions(['s1', 's2', 's3', 's4'])).toEqual({
      trackedIds: ['s1', 's2'],
      skippedIds: [],
      error: 'Your plan’s prompt locations are full.',
      code: 'plan_limit',
    });
    expect(added).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips suggestions accepted or dismissed elsewhere and tracks the rest', async () => {
    open.delete('s1');
    expect(await trackSuggestions(['s1', 's2', 's3'])).toEqual({
      trackedIds: ['s2', 's3'],
      skippedIds: ['s1'],
    });
  });

  it('tracks a repeated id once', async () => {
    expect((await trackSuggestions(['s1', 's1'])).trackedIds).toEqual(['s1']);
  });

  it('refuses an empty or oversized list before adding anything', async () => {
    const many = Array.from({ length: 26 }, (_, i) => `s${i}`);
    expect((await trackSuggestions([])).trackedIds).toEqual([]);
    expect((await trackSuggestions(many)).error).toBeDefined();
    expect((await trackSuggestions('s1' as unknown as string[])).error).toBeDefined();
    expect(added).toEqual([]);
  });
});

describe('trackPagePrompts (AT-006 part B2)', () => {
  const picked = [
    { text: 'Best coffee gifts under 50 dollars?', topic: 'Gift Ideas' },
    { text: 'Which coffee gift set suits a beginner?', topic: 'Gift Ideas' },
  ];

  // The brand has a topic: prompts can be added (a brand without one is below).
  beforeEach(() => {
    brandTopics = ['Espresso'];
  });

  it('tracks each prompt pointing at the page', async () => {
    const result = await trackPagePrompts('b1', 'https://acme.example/gifts', picked);
    expect(result).toEqual({ promptIds: ['p-1', 'p-2'] });
    expect(added).toEqual(picked.map((p) => p.text));
    expect(targets).toEqual([
      { promptId: 'p-1', url: 'https://acme.example/gifts' },
      { promptId: 'p-2', url: 'https://acme.example/gifts' },
    ]);
  });

  it('stops where the plan’s prompt locations run out', async () => {
    slotsLeft = 1;
    expect(await trackPagePrompts('b1', 'https://acme.example/gifts', picked)).toEqual({
      promptIds: ['p-1'],
      error: 'Your plan’s prompt locations are full.',
      code: 'plan_limit',
    });
  });

  it('keeps a prompt tracked when its target URL could not be saved, or without a domain', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    targetError = 'duplicate';
    expect((await trackPagePrompts('b1', 'https://acme.example/gifts', picked)).promptIds).toEqual([
      'p-1',
      'p-2',
    ]);
    targetError = null;
    await trackPagePrompts('b1', null, picked.slice(0, 1));
    expect(targets).toEqual([]);
    log.mockRestore();
  });

  it('refuses an empty list before adding anything', async () => {
    expect(await trackPagePrompts('b1', null, [{ text: '  ', topic: 'x' }])).toEqual({
      promptIds: [],
      error: 'Pick at least one prompt.',
    });
    expect(added).toEqual([]);
  });

  it("files each prompt under the brand's topic, making the ones it lacks", async () => {
    brandTopics = ['gift ideas'];
    await trackPagePrompts('b1', null, [
      { text: 'Best coffee gifts under 50 dollars?', topic: 'Gift Ideas' },
      { text: 'Is a coffee subscription a good gift?', topic: 'Coffee Subscriptions' },
      { text: 'Which coffee gift set suits a beginner?', topic: 'coffee  subscriptions' },
    ]);
    // The brand's own spelling, then a topic made once and reused.
    expect(categories).toEqual(['gift ideas', 'Coffee Subscriptions', 'Coffee Subscriptions']);
    expect(madeTopics).toEqual(['Coffee Subscriptions']);
    expect(removedTopics).toEqual([]);
  });

  it('removes a topic made for a prompt the plan had no room for', async () => {
    slotsLeft = 0;
    await trackPagePrompts('b1', null, [{ text: 'Best coffee gifts?', topic: 'Coffee Gifts' }]);
    expect(madeTopics).toEqual(['Coffee Gifts']);
    expect(removedTopics).toEqual(['topic-1']);
  });

  it('asks for a topic first on a brand without one, before making a topic or a prompt', async () => {
    brandTopics = [];
    expect(await trackPagePrompts('b1', null, picked)).toEqual({
      promptIds: [],
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    expect(madeTopics).toEqual([]);
    expect(added).toEqual([]);
  });
});

/**
 * refreshPromptSuggestions: a brand with no topic yet comes back as a value,
 * as production hides a thrown message, so the card can ask for a topic.
 */
describe('refreshPromptSuggestions', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('returns the fresh suggestions', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ suggestions: [{ id: 's1', brand_id: 'b1', suggested_text: 'Best GEO tools?' }] }),
    );
    const result = await refreshPromptSuggestions('b1');
    expect(result.ok && result.suggestions.map((x) => x.suggestedText)).toEqual([
      'Best GEO tools?',
    ]);
  });

  it('says the brand needs a topic first', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: 'Add a topic first: prompts are grouped under topics.', code: 'no_topics' },
        409,
      ),
    );
    expect(await refreshPromptSuggestions('b1')).toEqual({ ok: false, failure: 'no_topics' });
  });

  it('returns every other failure as a value too, never throwing', async () => {
    // The month's AI budget: plan-guard's 429 plan_limit.
    fetchMock.mockResolvedValueOnce(json({ error: 'plan_limit', message: 'Budget used' }, 429));
    expect(await refreshPromptSuggestions('b1')).toEqual({
      ok: false,
      failure: 'limit',
      retryable: false,
    });
    // The demo brand, or a read-only workspace: the upgrade dialog.
    fetchMock.mockResolvedValueOnce(json({ error: 'plan_limit', code: 'demo_brand' }, 402));
    expect(await refreshPromptSuggestions('b1')).toMatchObject({ failure: 'subscription' });
    // A role refusal, and an error of the API's own.
    fetchMock.mockResolvedValueOnce(
      json({ error: 'Only admins and managers can generate prompt suggestions.' }, 403),
    );
    expect(await refreshPromptSuggestions('b1')).toMatchObject({ failure: 'failed' });
    fetchMock.mockResolvedValueOnce(json({ error: 'Failed to generate suggestions' }, 500));
    expect(await refreshPromptSuggestions('b1')).toMatchObject({
      failure: 'failed',
      retryable: false,
    });
    // The proxy while the API restarts, and no answer at all: worth trying again.
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    expect(await refreshPromptSuggestions('b1')).toEqual({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await refreshPromptSuggestions('b1')).toEqual({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
  });
});

/**
 * getPromptSuggestions: its failures come back as values, as production
 * hides a thrown server action's message behind React's #441.
 */
describe('getPromptSuggestions', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('returns the open suggestions', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        suggestions: [{ id: 's1', brand_id: 'b1', suggested_text: 'Best GEO tools?' }],
        stale: false,
      }),
    );
    const read = await getPromptSuggestions('b1');
    expect(read).toMatchObject({ ok: true, stale: false });
    expect(read.ok && read.suggestions.map((x) => x.suggestedText)).toEqual(['Best GEO tools?']);
  });

  it('marks a proxy that says the API is down as worth retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    expect(await getPromptSuggestions('b1')).toEqual({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
  });

  it('returns no answer, never throws, when the request fails or times out', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await getPromptSuggestions('b1')).toEqual({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
  });

  it("says why when trying again wouldn't help", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "This brand isn't in your workspace", code: 'not_in_workspace' }, 403),
    );
    expect(await getPromptSuggestions('b1')).toEqual({
      ok: false,
      failure: 'workspace',
      retryable: false,
    });
  });
});

describe('dismissSuggestions', () => {
  it('dismisses each one through the route one by one uses, a few at a time', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
    expect(await dismissSuggestions([...ids, 's1'])).toEqual({
      ok: true,
      dismissed: ids,
      failed: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://server/api/prompts/suggestions/s1/dismiss',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer t' } }),
    );
  });

  it('lists the ones that could not be dismissed, and never throws', async () => {
    fetchMock.mockImplementation((async (url: string) => {
      if (url.includes('/s2/')) return new Response('{}', { status: 403 });
      if (url.includes('/s3/')) throw new Error('network down');
      return new Response('{}', { status: 200 });
    }) as never);
    expect(await dismissSuggestions(['s1', 's2', 's3'])).toEqual({
      ok: true,
      dismissed: ['s1'],
      failed: ['s2', 's3'],
    });
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
  });
});
