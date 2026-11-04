import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Rules tab (CE-009): a draft's rule choices, read with it and saved. */

const DRAFT = '77777777-7777-7777-7777-777777777777';

let updates: { value: unknown; filters: [string, unknown][] }[];
let row: Record<string, unknown> | null;
let updated: { id: string } | null;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const call = {
        op: 'select',
        value: undefined as unknown,
        filters: [] as [string, unknown][],
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push([col, v]), chain),
        update: (value: unknown) => {
          call.op = 'update';
          call.value = value;
          updates.push(call);
          return chain;
        },
        maybeSingle: async () => ({ data: call.op === 'update' ? updated : row, error: null }),
      };
      return chain;
    },
  })),
}));

const { getContentDraft, saveDraftRules } = await import('./contentDrafts');

const base = {
  id: DRAFT,
  brand_id: 'b1',
  title: 'T',
  page_type: 'blog_post',
  page_type_source: 'user',
  method: 'create',
  status: 'draft',
  body_html: '',
  author: 'user',
  source_url: null,
  updated_at: '2026-10-21T10:00:00Z',
  brands: { site_type: null, industry: null, shopping_mode_enabled: false },
};

beforeEach(() => {
  updates = [];
  row = null;
  updated = { id: DRAFT };
});

describe('the draft’s rules', () => {
  it('are read with the draft, and none when they aren’t valid', async () => {
    row = { ...base, rules: { set: 'guide', overrides: { faq: { on: false } } } };
    expect((await getContentDraft(DRAFT))?.rules).toEqual({
      set: 'guide',
      source: null,
      overrides: { faq: { on: false } },
      textRules: [],
    });
    row = { ...base, rules: null };
    expect((await getContentDraft(DRAFT))?.rules).toEqual({
      set: null,
      source: null,
      overrides: {},
      textRules: [],
    });
    row = { ...base, rules: { set: 'nope', overrides: {} } };
    expect((await getContentDraft(DRAFT))?.rules).toEqual({
      set: null,
      source: null,
      overrides: {},
      textRules: [],
    });
  });

  it('are saved for this draft', async () => {
    const rules = { set: null, overrides: { sentence: { value: '120' } } };
    await saveDraftRules(DRAFT, rules);
    expect(updates).toEqual([
      {
        op: 'update',
        value: { rules: { ...rules, source: null, textRules: [] } },
        filters: [['id', DRAFT]],
      },
    ]);
  });

  it('refuses rules out of shape, and says when the draft isn’t found', async () => {
    await expect(
      saveDraftRules(DRAFT, { set: null, overrides: { tone: { value: 'x'.repeat(501) } } }),
    ).rejects.toThrow('invalid');
    await expect(saveDraftRules('d1', { set: null, overrides: {} })).rejects.toThrow('invalid');
    updated = null;
    await expect(saveDraftRules(DRAFT, { set: null, overrides: {} })).rejects.toThrow('not_found');
  });
});
