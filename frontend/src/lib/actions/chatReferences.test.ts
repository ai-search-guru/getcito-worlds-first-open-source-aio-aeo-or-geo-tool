// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The composer's @ search (W1-12): the brand's prompts, pages and open tasks
 * by name, with the person's session, as values (never thrown).
 */

/** Each table's answer, and every filter asked of it. */
const db = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  orgId: 'org-1',
  brand: { id: 'b1' } as { id: string } | null,
  rows: {} as Record<string, unknown[]>,
  error: null as { message: string } | null,
  calls: [] as [string, string, unknown[]][],
}));

function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'ilike', 'or']) {
    q[method] = (...args: unknown[]) => {
      db.calls.push([table, method, args]);
      return q;
    };
  }
  q.maybeSingle = async () => ({
    data:
      table === 'profiles' ? { organization_id: db.orgId } : table === 'brands' ? db.brand : null,
  });
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: db.rows[table] ?? [], error: db.error });
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: query,
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: query } }));

const { searchChatReferences } = await import('./chatReferences');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  db.user = { id: 'u1' };
  db.brand = { id: 'b1' };
  db.error = null;
  db.calls = [];
  db.rows = {
    prompts: [{ id: 'p1', text: 'Best AEO tools for agencies' }],
    site_pages: [{ url: 'https://www.getcito.com/pricing/', title: 'Pricing' }],
    action_tasks: [
      { id: 't1', task_key: null, title: 'Add an FAQ block to /pricing', title_params: {} },
      { id: 't2', task_key: null, title: 'Refresh the AEO guide', title_params: {} },
    ],
  };
});

describe('searchChatReferences', () => {
  it('lists the brand’s matches by name, a source at a time', async () => {
    const result = await searchChatReferences('b1', 'pricing');
    expect(result).toEqual({
      ok: true,
      references: [
        { type: 'prompt', id: 'p1', label: 'Best AEO tools for agencies' },
        { type: 'page', id: 'https://www.getcito.com/pricing/', label: 'getcito.com/pricing' },
        { type: 'task', id: 't1', label: 'Add an FAQ block to /pricing' },
      ],
    });
    // Prompts and pages are matched in the query, tasks by their written titles.
    expect(db.calls).toContainEqual(['prompts', 'ilike', ['text', '%pricing%']]);
    // The brand is the prompt set's: prompts has no brand_id column.
    expect(db.calls).toContainEqual(['prompts', 'eq', ['prompt_sets.brand_id', 'b1']]);
    expect(db.calls).not.toContainEqual(['prompts', 'eq', ['brand_id', 'b1']]);
    expect(db.calls).toContainEqual([
      'site_pages',
      'or',
      ['url.ilike.%pricing%,title.ilike.%pricing%'],
    ]);
    expect(db.calls).toContainEqual(['action_tasks', 'eq', ['actions.brand_id', 'b1']]);
  });

  it('makes a search safe for the filters', async () => {
    await searchChatReferences('b1', 'a,b) or (x%');
    expect(db.calls).toContainEqual(['prompts', 'ilike', ['text', '%a b or x%']]);
  });

  it('writes a template task’s title from its key', async () => {
    db.rows.action_tasks = [{ id: 't3', task_key: 'validate', title: null, title_params: {} }];
    const result = await searchChatReferences('b1', '');
    expect(result.ok && result.references.find((r) => r.type === 'task')?.label).toBeTruthy();
  });

  it('answers a refusal as a value: no session, Chat off, another brand, a failed read', async () => {
    db.user = null;
    expect(await searchChatReferences('b1', '')).toEqual({ ok: false, failure: 'session' });
    db.user = { id: 'u1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await searchChatReferences('b1', '')).toEqual({ ok: false, failure: 'chat_off' });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    db.brand = null;
    expect(await searchChatReferences('b2', '')).toEqual({ ok: false, failure: 'not_found' });
    db.brand = { id: 'b1' };
    db.error = { message: 'boom' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await searchChatReferences('b1', '')).toEqual({ ok: false, failure: 'failed' });
  });
});
