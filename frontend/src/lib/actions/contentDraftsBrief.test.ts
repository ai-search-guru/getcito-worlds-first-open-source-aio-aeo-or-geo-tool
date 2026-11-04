import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftBrief, RebuildSources } from '@/lib/content/brief';
import v2 from '@/lib/content/__fixtures__/brief-v2.json';

/** The Brief tab (CE-007): read, edit and rebuild a draft's brief. */

const DRAFT = '77777777-7777-7777-7777-777777777777';
const BRAND = '33333333-3333-3333-3333-333333333333';
const PROMPT = '55555555-5555-5555-5555-555555555555';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  filters: [string, unknown][];
}
let calls: Call[];
let reads: Record<string, unknown>;
let session: { access_token: string } | null;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const result = () =>
        call.op === 'update' && call.filters.length && reads[`${table}:update`] !== undefined
          ? { data: reads[`${table}:update`], error: null }
          : { data: call.op === 'select' ? (reads[table] ?? null) : null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push([col, v]), chain),
        in: (col: string, v: unknown) => (call.filters.push([col, v]), chain),
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const { addDraftPrompts, getDraftBrief, rebuildDraftBrief, saveDraftBrief } =
  await import('./contentDrafts');

const brief: DraftBrief = {
  goal: 'Help buyers pick',
  audience: 'Home baristas',
  outline: [
    { heading: 'Machines', keyPoints: ['Price'], fanout: 'espresso', platform: 'copilot-web' },
  ],
  keywords: ['espresso'],
  origin: 'rebuild',
  builtAt: '2026-10-21T10:00:00Z',
  builtFrom: { prompts: 1, fanouts: 1, pages: 0, queries: 0 },
};

const sources: RebuildSources = {
  promptIds: [PROMPT],
  fanouts: [{ query: 'espresso', platforms: ['copilot-web'] }],
  pages: [],
  queries: [],
  headings: [],
  length: 3000,
};

const fetchMock = vi.fn();

beforeEach(() => {
  calls = [];
  reads = {};
  session = { access_token: 'jwt' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDraftBrief', () => {
  it('reads the draft’s brief', async () => {
    reads.content_drafts = { brief, opportunity_id: 'o1' };
    expect(await getDraftBrief(DRAFT)).toEqual({ brief });
    expect(calls.map((c) => c.table)).toEqual(['content_drafts']);
  });

  it('falls back to the opportunity’s brief, or none', async () => {
    reads.content_drafts = { brief: null, opportunity_id: 'o1' };
    reads.content_opportunities = {
      brief: {
        outline: [{ heading: 'Why', keyPoints: [] }],
        targetKeywords: [],
        callToAction: 'Try it',
      },
    };
    expect(await getDraftBrief(DRAFT)).toMatchObject({
      brief: { origin: 'opportunity', goal: 'Try it', outline: [{ heading: 'Why', fanout: null }] },
    });

    reads.content_opportunities = { brief: null };
    expect(await getDraftBrief(DRAFT)).toEqual({ brief: null });
    reads.content_drafts = { brief: null, opportunity_id: null };
    expect(await getDraftBrief(DRAFT)).toEqual({ brief: null });
    reads.content_drafts = null;
    expect(await getDraftBrief(DRAFT)).toBeNull();
  });

  it('reads a brief of version 2 whole', async () => {
    reads.content_drafts = { brief: v2, opportunity_id: null };
    expect(await getDraftBrief(DRAFT)).toEqual({ brief: v2 });
  });

  it('says a brief of its own it can’t read as a failed read, never as the opportunity’s', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      reads.content_drafts = { brief: { goal: 42 }, opportunity_id: 'o1' };
      reads.content_opportunities = {
        brief: { outline: [{ heading: 'Why', keyPoints: [] }], targetKeywords: [] },
      };
      // So Edit brief, which shows on a read brief only, can't write over it.
      expect(await getDraftBrief(DRAFT)).toBeNull();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('saveDraftBrief', () => {
  it('saves the brief as edited by the person', async () => {
    reads['content_drafts:update'] = { id: DRAFT };
    const saved = await saveDraftBrief(DRAFT, brief);
    expect(saved.origin).toBe('edit');
    expect(calls[0]).toMatchObject({
      table: 'content_drafts',
      op: 'update',
      value: { brief: { ...brief, origin: 'edit' } },
      filters: [['id', DRAFT]],
    });
  });

  it('keeps version 2 through an edit, as the person’s', async () => {
    reads['content_drafts:update'] = { id: DRAFT };
    const saved = await saveDraftBrief(DRAFT, v2 as DraftBrief);
    expect(saved).toMatchObject({ origin: 'edit', version: 2, tldr: v2.tldr });
    expect(saved.outline[0].facts).toEqual(v2.outline[0].facts);
  });

  it('says a brief past the column’s 64 KB is too long', async () => {
    const long = {
      ...v2,
      outline: Array.from({ length: 12 }, () => ({
        heading: 'h'.repeat(300),
        keyPoints: Array(8).fill('k'.repeat(500)),
        fanout: null,
        platform: null,
        answer: 'a'.repeat(600),
      })),
      leftOut: Array(20).fill('l'.repeat(300)),
    } as DraftBrief;
    reads['content_drafts:update'] = { id: DRAFT };
    await expect(saveDraftBrief(DRAFT, long)).rejects.toThrow('too_long');
    // Nothing written.
    expect(calls).toEqual([]);
  });

  it('refuses a brief over its limits, and says when the draft isn’t found', async () => {
    await expect(saveDraftBrief(DRAFT, { ...brief, goal: 'x'.repeat(501) })).rejects.toThrow(
      'invalid',
    );
    await expect(saveDraftBrief(DRAFT, brief)).rejects.toThrow('not_found');
  });
});

describe('rebuildDraftBrief', () => {
  it('asks the API to rebuild with the member’s session', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ brief }) });
    expect(await rebuildDraftBrief(DRAFT, BRAND, sources)).toEqual({ brief });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/content-drafts/${DRAFT}/brief$`));
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(JSON.parse(init.body)).toEqual({ brandId: BRAND, sources });
  });

  it('sends the rules in effect beside the sources, and none when there are none', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ brief }) });
    const rules = [{ key: 'h2Answer', name: 'Answer under each H2', detail: 'aim: 60 words' }];
    await rebuildDraftBrief(DRAFT, BRAND, sources, rules);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ brandId: BRAND, sources, rules });
    await rebuildDraftBrief(DRAFT, BRAND, sources, []);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ brandId: BRAND, sources });
  });

  it('names why it didn’t, and anything unexpected as failed', async () => {
    for (const [body, ok, error] of [
      [{ code: 'ai_budget' }, false, 'ai_budget'],
      [{ code: 'no_subscription' }, false, 'no_subscription'],
      [{ code: 'no_sources' }, false, 'no_sources'],
      [{ code: 'forbidden' }, false, 'failed'],
      [{ brief: { goal: 1 } }, true, 'failed'],
    ] as const) {
      fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
      expect(await rebuildDraftBrief(DRAFT, BRAND, sources)).toEqual({ error });
    }
    session = null;
    expect(await rebuildDraftBrief(DRAFT, BRAND, sources)).toEqual({ error: 'failed' });
    expect(await rebuildDraftBrief('d1', BRAND, sources)).toEqual({ error: 'failed' });
  });
});

describe('addDraftPrompts', () => {
  it('adds the prompts the draft hasn’t, and brings left-out ones back', async () => {
    reads.content_drafts = { prompt_ids: [PROMPT] };
    const other = '66666666-6666-6666-6666-666666666666';
    await addDraftPrompts(DRAFT, [PROMPT, other]);
    const writes = calls.filter((c) => c.op === 'update');
    expect(writes[0]).toMatchObject({
      table: 'content_drafts',
      value: { prompt_ids: [PROMPT, other] },
    });
    expect(writes[1]).toMatchObject({
      table: 'content_draft_sources',
      value: expect.objectContaining({ included: true }),
      filters: [
        ['draft_id', DRAFT],
        ['kind', 'prompt'],
        ['ref', [PROMPT, other]],
      ],
    });
  });

  it('refuses no prompts or a malformed one', async () => {
    await expect(addDraftPrompts(DRAFT, [])).rejects.toThrow('invalid');
    await expect(addDraftPrompts(DRAFT, ['p1'])).rejects.toThrow('invalid');
    expect(calls).toEqual([]);
  });
});
