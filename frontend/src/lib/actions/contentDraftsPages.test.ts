import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Library's Export (CE-002): each draft's page, of the brand, in the
 * order given, at most fifty a call since every page comes back whole.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let stored: Record<string, unknown>[];
let reads: { brand: unknown; ids: string[] }[];
// A database without 00448: a read of schema_left_out fails as Postgres says.
let before00448 = false;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const read = { brand: undefined as unknown, ids: [] as string[] };
      let columns = '';
      const chain: Record<string, unknown> = {
        select: (cols: string) => ((columns = cols), chain),
        eq: (col: string, v: unknown) => (col === 'brand_id' && (read.brand = v), chain),
        in: (_col: string, ids: string[]) => {
          read.ids = ids;
          reads.push(read);
          return chain;
        },
        then: (resolve: (r: unknown) => void) =>
          resolve(
            before00448 && columns.includes('schema_left_out')
              ? {
                  data: null,
                  error: {
                    code: '42703',
                    message: 'column content_drafts.schema_left_out does not exist',
                  },
                }
              : {
                  data: stored.filter((row) => read.ids.includes(row.id as string)),
                  error: null,
                },
          ),
      };
      return chain;
    },
  })),
}));

const { getContentDraftPages } = await import('./contentDrafts');

const page = (n: number) => ({
  id: id(n),
  title: `Draft ${n}`,
  body_html: `<h1>Draft ${n}</h1>`,
  source_url: null,
  author_id: null,
  reviewer_id: null,
  author_real_at: null,
  rules: null,
  page_type: 'guide',
  method: 'create',
  schema_left_out: false,
});

beforeEach(() => {
  stored = [page(1), page(2), page(3)];
  reads = [];
  before00448 = false;
});

describe('getContentDraftPages', () => {
  it('reads the pages before 00448 too, none left out', async () => {
    stored = [{ ...page(1), schema_left_out: undefined }];
    before00448 = true;
    const { pages } = await getContentDraftPages(BRAND, [id(1)]);
    expect(pages).toEqual([expect.objectContaining({ id: id(1), schemaLeftOut: false })]);
    // Asked once with the column, then again without it.
    expect(reads).toHaveLength(2);
  });

  it("reads the brand's pages in one call, in the order given, leaving out one gone", async () => {
    const { pages, rest } = await getContentDraftPages(BRAND, [id(3), id(9), id(1)]);
    expect(rest).toEqual([]);
    expect(pages.map((p) => p.title)).toEqual(['Draft 3', 'Draft 1']);
    expect(pages[0]).toEqual({
      id: id(3),
      title: 'Draft 3',
      bodyHtml: '<h1>Draft 3</h1>',
      sourceUrl: null,
      authorId: null,
      reviewerId: null,
      authorConfirmed: false,
      language: null,
      pageType: 'guide',
      isNew: true,
      schemaLeftOut: false,
    });
    expect(reads).toEqual([{ brand: BRAND, ids: [id(3), id(9), id(1)] }]);
  });

  it('gives the author and the language the draft’s own Language rule names', async () => {
    const rules = (language: unknown) => ({ set: null, overrides: { language } });
    stored = [
      {
        ...page(1),
        author_id: id(7),
        reviewer_id: id(8),
        author_real_at: '2026-10-24T10:00:00Z',
        rules: rules({ value: ' Turkish ' }),
      },
      // Off, or on without a value of its own: the brand's language.
      { ...page(2), rules: rules({ on: false, value: 'German' }) },
      { ...page(3), rules: rules({ on: true }) },
    ];
    const { pages } = await getContentDraftPages(BRAND, [id(1), id(2), id(3)]);
    expect(pages.map((p) => [p.authorId, p.reviewerId, p.authorConfirmed, p.language])).toEqual([
      [id(7), id(8), true, 'Turkish'],
      [null, null, false, null],
      [null, null, false, null],
    ]);
  });

  it('takes at most fifty ids a call, and only ids', async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => id(i + 1));
    expect((await getContentDraftPages(BRAND, fifty)).pages).toHaveLength(3);
    await expect(getContentDraftPages(BRAND, [...fifty, id(51)])).rejects.toThrow('invalid');
    await expect(getContentDraftPages(BRAND, ['d1'])).rejects.toThrow('invalid');
    await expect(getContentDraftPages('brand-1', [id(1)])).rejects.toThrow('invalid');
    expect(reads).toHaveLength(1);
  });

  it('stops at its response budget and hands back the rest, always one page at least', async () => {
    const big = (n: number) => ({ ...page(n), body_html: 'x'.repeat(1_200_000) });
    stored = [big(1), big(2), big(3), page(4)];
    // 2.4 MB fits; a third 1.2 MB page would pass the 3 MB budget.
    const first = await getContentDraftPages(BRAND, [id(1), id(2), id(3), id(4)]);
    expect(first.pages.map((p) => p.id)).toEqual([id(1), id(2)]);
    expect(first.rest).toEqual([id(3), id(4)]);
    // One page over the budget on its own still comes back.
    stored = [{ ...page(5), body_html: 'x'.repeat(3_500_000) }];
    expect((await getContentDraftPages(BRAND, [id(5)])).pages).toHaveLength(1);
  });
});
