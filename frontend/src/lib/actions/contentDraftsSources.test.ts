import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Sources tab (CE-008): a draft's sources and a person's choices on them. */

const DRAFT = '77777777-7777-7777-7777-777777777777';
const PROMPT = '55555555-5555-5555-5555-555555555555';
const OTHER_PROMPT = '66666666-6666-6666-6666-666666666666';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  options?: unknown;
  filters: [string, unknown][];
}
let calls: Call[];
let rpcCalls: { fn: string; args: unknown }[];
let rpcResult: { data: unknown; error: { message: string } | null };
let reads: Record<string, unknown>;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const result = () =>
        call.op === 'select'
          ? { data: reads[table] ?? null, error: null }
          : { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push([col, v]), chain),
        in: (col: string, v: unknown) => (call.filters.push([col, v]), chain),
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        upsert: (value: unknown, options: unknown) => (
          (call.op = 'upsert'),
          (call.value = value),
          (call.options = options),
          chain
        ),
        maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const { addDraftSource, getDraftSources, setDraftSourceIncluded } = await import('./contentDrafts');

const writes = () => calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  calls = [];
  rpcCalls = [];
  rpcResult = { data: null, error: null };
  reads = {};
});

describe('getDraftSources', () => {
  it('reads the last 30 days of sources with the person’s choices', async () => {
    const data = {
      prompts: [],
      fanouts: [],
      citedPages: [],
      gscQueries: [],
      brandDomains: [],
      competitorDomains: [],
    };
    rpcResult = { data, error: null };
    reads.content_draft_sources = [
      { kind: 'fanout', ref: 'espresso', included: false, added: false },
      { kind: 'file', ref: 'x', included: true, added: true },
    ];
    // The sites the draft's brand trusts (00449) come with them.
    reads.content_drafts = { brands: { trusted_sources: ['sca.coffee'] } };
    expect(await getDraftSources(DRAFT)).toEqual({
      data: { ...data, trustedDomains: ['sca.coffee'] },
      choices: [{ kind: 'fanout', ref: 'espresso', included: false, added: false }],
    });
    expect(rpcCalls).toEqual([
      { fn: 'content_draft_sources', args: { p_draft_id: DRAFT, p_days: 30 } },
    ]);
    expect(calls[0].filters).toEqual([['draft_id', DRAFT]]);
  });

  it('trusts no site before 00449, or when the brand’s can’t be read', async () => {
    rpcResult = { data: { brandDomains: [], competitorDomains: [] }, error: null };
    expect((await getDraftSources(DRAFT))!.data.trustedDomains).toEqual([]);
  });

  it('returns null for a draft the member can’t read, and throws on a failed read', async () => {
    expect(await getDraftSources(DRAFT)).toBeNull();
    rpcResult = { data: null, error: { message: 'boom' } };
    await expect(getDraftSources(DRAFT)).rejects.toThrow('boom');
    await expect(getDraftSources('d1')).rejects.toThrow('invalid');
  });
});

describe('setDraftSourceIncluded', () => {
  it('keeps the choice under the source’s kind and reference', async () => {
    await setDraftSourceIncluded(DRAFT, {
      kind: 'cited_page',
      ref: 'https://x.example/a',
      included: false,
    });
    expect(writes()).toEqual([
      expect.objectContaining({
        table: 'content_draft_sources',
        op: 'upsert',
        value: expect.objectContaining({
          draft_id: DRAFT,
          kind: 'cited_page',
          ref: 'https://x.example/a',
          included: false,
        }),
        options: { onConflict: 'draft_id,kind,ref' },
      }),
    ]);
    expect((writes()[0].value as Record<string, unknown>).added).toBeUndefined();
  });

  it('writes nothing for an unknown kind or a malformed draft', async () => {
    await expect(
      setDraftSourceIncluded(DRAFT, { kind: 'file' as never, ref: 'x', included: true }),
    ).rejects.toThrow('invalid');
    await expect(
      setDraftSourceIncluded('d1', { kind: 'fanout', ref: 'x', included: true }),
    ).rejects.toThrow('invalid');
    expect(writes()).toEqual([]);
  });
});

describe('addDraftSource', () => {
  it('adds a prompt to the draft’s prompts, and back in if it was left out', async () => {
    reads.content_drafts = { prompt_ids: [OTHER_PROMPT] };
    await addDraftSource(DRAFT, { kind: 'prompt', promptId: PROMPT });
    expect(writes()).toEqual([
      expect.objectContaining({
        table: 'content_drafts',
        op: 'update',
        value: { prompt_ids: [OTHER_PROMPT, PROMPT] },
        filters: [['id', DRAFT]],
      }),
      expect.objectContaining({
        table: 'content_draft_sources',
        op: 'update',
        value: expect.objectContaining({ included: true }),
        filters: [
          ['draft_id', DRAFT],
          ['kind', 'prompt'],
          ['ref', [PROMPT]],
        ],
      }),
    ]);
  });

  it('leaves the prompts as they are when the prompt is in them, and says when the draft isn’t found', async () => {
    reads.content_drafts = { prompt_ids: [PROMPT] };
    await addDraftSource(DRAFT, { kind: 'prompt', promptId: PROMPT });
    expect(writes().map((w) => w.table)).toEqual(['content_draft_sources']);

    reads.content_drafts = null;
    await expect(addDraftSource(DRAFT, { kind: 'prompt', promptId: PROMPT })).rejects.toThrow(
      'not_found',
    );
  });

  it('keeps a page or a query as added by the person', async () => {
    await addDraftSource(DRAFT, { kind: 'cited_page', url: ' https://example.org/study ' });
    await addDraftSource(DRAFT, { kind: 'gsc_query', query: '  Espresso   Machine ' });
    expect(writes().map((w) => w.value)).toEqual([
      expect.objectContaining({
        kind: 'cited_page',
        ref: 'https://example.org/study',
        added: true,
        included: true,
      }),
      expect.objectContaining({
        kind: 'gsc_query',
        ref: 'espresso machine',
        added: true,
        included: true,
      }),
    ]);
  });

  it('refuses an address that isn’t a web page’s and a malformed prompt', async () => {
    await expect(
      addDraftSource(DRAFT, { kind: 'cited_page', url: 'javascript:alert(1)' }),
    ).rejects.toThrow('invalid');
    await expect(addDraftSource(DRAFT, { kind: 'cited_page', url: 'not a url' })).rejects.toThrow(
      'invalid',
    );
    await expect(addDraftSource(DRAFT, { kind: 'prompt', promptId: 'p1' })).rejects.toThrow(
      'invalid',
    );
    expect(calls).toEqual([]);
  });
});
