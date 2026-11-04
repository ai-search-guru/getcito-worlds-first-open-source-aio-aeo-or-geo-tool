import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Editing a task's details (AC-004): the fields merge into what the task
 * already carries, and the text is written only when it changed.
 */

let stored: Record<string, unknown> | null;
let updates: Record<string, unknown>[];
let events: Record<string, unknown>[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not']) chain[method] = () => chain;
      chain.maybeSingle = async () => ({
        data: stored === undefined ? null : { details: stored },
        error: null,
      });
      chain.update = (values: Record<string, unknown>) => {
        if (table === 'action_tasks') updates.push(values);
        return chain;
      };
      chain.insert = async (values: Record<string, unknown>) => {
        if (table === 'action_events') events.push(values);
        return { error: null };
      };
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null });
      return chain;
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { updateTaskDetails } = await import('./actionCenter');

const edit = {
  title: null,
  url: ' /pricing ',
  where: ' acme.example/pricing ',
  why: '',
  before: '',
  after: 'A table of plans and prices.',
  how: ['Add a table.', ''],
  doneWhen: 'Cited again within 14 days.',
  check: 'rerun' as const,
  type: 'content' as const,
  effort: '~1h',
  role: '',
};

beforeEach(() => {
  stored = null;
  updates = [];
  events = [];
});

describe('updateTaskDetails', () => {
  it("keeps an Improve task's body, platform and evidence", async () => {
    stored = {
      body: 'Lead with the table.',
      platform: 'chatgpt-web',
      platformLabel: 'ChatGPT',
      sources: [{ type: 'domain', ref: 'profound.com' }],
    };
    await updateTaskDetails('b1', 'a1', 't1', edit);

    expect(updates[0].details).toEqual({
      body: 'Lead with the table.',
      platform: 'chatgpt-web',
      platformLabel: 'ChatGPT',
      sources: [{ type: 'domain', ref: 'profound.com' }],
      url: '/pricing',
      where: 'acme.example/pricing',
      why: null,
      change: { before: null, after: 'A table of plans and prices.' },
      how: ['Add a table.'],
      doneWhen: 'Cited again within 14 days.',
      check: 'rerun',
      type: 'content',
      effort: '~1h',
      role: null,
    });
    // The text was not changed, so a library task keeps rendering from its template.
    expect(updates[0]).not.toHaveProperty('title');
    expect(events[0]).toMatchObject({ event: 'task_edited', data: { taskId: 't1', title: null } });
  });

  it("makes a template's details the person's once edited (AC-010)", async () => {
    stored = { doneWhen: 'The changed page is live', check: 'auto', source: 'template' };
    await updateTaskDetails('b1', 'a1', 't1', edit);
    // As written to the database: an undefined key isn't.
    expect(JSON.parse(JSON.stringify(updates[0].details))).not.toHaveProperty('source');
    expect(updates[0].details).toMatchObject({ check: 'rerun', url: '/pricing' });
  });

  it('writes a changed text', async () => {
    await updateTaskDetails('b1', 'a1', 't1', { ...edit, title: '  Add a table to /pricing ' });
    expect(updates[0].title).toBe('Add a table to /pricing');
  });

  it('refuses a malformed edit without touching the task', async () => {
    await expect(
      updateTaskDetails('b1', 'a1', 't1', { ...edit, how: 'Add a table.' as never }),
    ).rejects.toThrow('Invalid task details');
    expect(updates).toEqual([]);
  });
});
