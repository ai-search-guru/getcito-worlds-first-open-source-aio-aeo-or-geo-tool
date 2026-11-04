import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLUMNS_VIEW, toggleColumn } from '@/lib/promptTableColumns';

/** The Tracked Prompts table's column views, through RLS (PROMPT-015a, 00363). */

const BRAND = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

let rows: { user_id: string | null; columns: unknown }[];
let written: Record<string, unknown>[];
let refused: boolean;

function from() {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    or: () => q,
    delete: () => q,
    upsert: (row: Record<string, unknown>) => (written.push(row), q),
    then: (resolve: (v: unknown) => void) =>
      resolve(
        written.length
          ? { data: refused ? [] : [{ id: 'v1' }], error: null }
          : { data: rows, error: null },
      ),
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from,
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  })),
}));

const { getPromptTableViews, savePromptTableView } = await import('./promptTableViews');

beforeEach(() => {
  rows = [];
  written = [];
  refused = false;
});

describe('getPromptTableViews', () => {
  it("reads the person's view and the brand's", async () => {
    const brand = toggleColumn(DEFAULT_COLUMNS_VIEW, 'work', false);
    rows = [
      { user_id: null, columns: brand },
      {
        user_id: USER,
        columns: {
          order: ['volume', ...DEFAULT_COLUMNS_VIEW.order.filter((c) => c !== 'volume')],
          hidden: [],
        },
      },
    ];
    const views = await getPromptTableViews(BRAND);
    expect(views.brand).toEqual(brand);
    expect(views.mine?.order[0]).toBe('volume');
    await expect(getPromptTableViews('nope')).rejects.toThrow('invalid');
  });
});

describe('savePromptTableView', () => {
  it("saves the person's view, or the brand's with no user", async () => {
    expect(await savePromptTableView(BRAND, DEFAULT_COLUMNS_VIEW)).toEqual({ ok: true });
    expect(written[0]).toMatchObject({ brand_id: BRAND, user_id: USER, updated_by: USER });
    expect(await savePromptTableView(BRAND, DEFAULT_COLUMNS_VIEW, 'brand')).toEqual({ ok: true });
    expect(written[1]).toMatchObject({ brand_id: BRAND, user_id: null });
  });

  it("refuses what isn't a view, and says so when RLS refused the write", async () => {
    expect(await savePromptTableView(BRAND, { order: ['nope'], hidden: [] } as never)).toEqual({
      ok: false,
      error: 'invalid',
    });
    refused = true;
    expect(await savePromptTableView(BRAND, DEFAULT_COLUMNS_VIEW, 'brand')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
