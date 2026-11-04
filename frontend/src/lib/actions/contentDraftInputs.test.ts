import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_INPUTS } from '@/lib/content/draftInputs';

/**
 * Brief › Your input (CE-048): kept per draft as the person gave it, read
 * and written through RLS as the draft is.
 */

const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';

let row: Record<string, unknown> | null;
let readError: { message: string } | null;
let upserts: { value: Record<string, unknown>; options: unknown }[];
let upsertError: { message: string } | null;
let filters: [string, unknown][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      expect(table).toBe('content_draft_inputs');
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push([col, v]), chain),
        maybeSingle: async () => ({ data: row, error: readError }),
        upsert: async (value: Record<string, unknown>, options: unknown) => {
          upserts.push({ value, options });
          return { error: upsertError };
        },
      };
      return chain;
    },
  })),
}));

const { getDraftInputs, saveDraftInputs } = await import('./contentDraftInputs');

beforeEach(() => {
  row = null;
  readError = null;
  upserts = [];
  upsertError = null;
  filters = [];
});

const quote = {
  name: 'Ada Lovelace',
  title: 'Head of Research, Acme',
  text: 'We cut our forecast misses in half.',
  sourceUrl: 'https://acme.example/talk',
};

describe('getDraftInputs', () => {
  it('reads none given as empty, and a kept row as given', async () => {
    expect(await getDraftInputs(DRAFT)).toEqual(NO_INPUTS);
    expect(filters).toEqual([['draft_id', DRAFT]]);

    row = { experience: 'We tested it.', data: [], getcito_data: [], quotes: [quote] };
    expect(await getDraftInputs(DRAFT)).toEqual({
      experience: 'We tested it.',
      data: [],
      getcitoData: [],
      quotes: [quote],
    });
  });

  it("keeps what still reads of a row, item by item, and says when it can't read", async () => {
    row = {
      experience: null,
      data: 'nope',
      getcito_data: [{ promptId: 'x' }],
      quotes: [quote, { ...quote, sourceUrl: 'ftp://a.example' }],
    };
    expect(await getDraftInputs(DRAFT)).toEqual({ ...NO_INPUTS, quotes: [quote] });
    readError = { message: 'denied' };
    await expect(getDraftInputs(DRAFT)).rejects.toThrow('denied');
    await expect(getDraftInputs('not-an-id')).rejects.toThrow('invalid');
  });
});

describe('saveDraftInputs', () => {
  it('keeps the whole input on the draft, by whom, an empty experience as none', async () => {
    const saved = await saveDraftInputs(DRAFT, {
      ...NO_INPUTS,
      quotes: [{ ...quote, name: ' Ada ' }],
    });
    expect(saved.quotes[0].name).toBe('Ada');
    expect(upserts).toEqual([
      {
        value: {
          draft_id: DRAFT,
          experience: null,
          data: [],
          getcito_data: [],
          quotes: [{ ...quote, name: 'Ada' }],
          updated_by: 'u1',
        },
        options: { onConflict: 'draft_id' },
      },
    ]);
  });

  it('keeps nothing that breaks the rules, and says when the write is refused', async () => {
    await expect(
      saveDraftInputs(DRAFT, { ...NO_INPUTS, quotes: [{ ...quote, sourceUrl: 'javascript:x' }] }),
    ).rejects.toThrow('invalid');
    await expect(saveDraftInputs('nope', NO_INPUTS)).rejects.toThrow('invalid');
    expect(upserts).toHaveLength(0);
    upsertError = { message: 'new row violates row-level security policy' };
    await expect(saveDraftInputs(DRAFT, NO_INPUTS)).rejects.toThrow('row-level security');
  });
});
