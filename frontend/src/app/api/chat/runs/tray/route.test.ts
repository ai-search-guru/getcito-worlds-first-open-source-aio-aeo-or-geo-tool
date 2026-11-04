// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_RUN_STEP_SELECT } from '@/lib/chat/steps';

/**
 * GET /api/chat/runs/tray (Chat P0, D2): not there while the new Chat is off
 * for the workspace; the person's own Chat runs and the brand's Content Agent
 * runs, newest first — never another person's chat or another brand's draft —
 * with steps read by their member columns.
 */

const ORG = 'org-1';
const ME = 'user-1';
const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_BRAND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  selects: [] as { table: string; columns: string }[],
}));

/** A path into a row: "content_drafts.brand_id" reads the embedded draft. */
const get = (row: Row, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v as Row | null)?.[k], row);

/** Just enough of PostgREST: select, eq, in, order, limit, single. Row policies aren't modelled. */
function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let order: { key: string; ascending: boolean } | null = null;
  let limit = Infinity;
  const result = () => {
    let rows = (db.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    if (order) {
      const { key, ascending } = order;
      rows = [...rows].sort(
        (a, b) => String(get(a, key)).localeCompare(String(get(b, key))) * (ascending ? 1 : -1),
      );
    }
    return rows.slice(0, limit);
  };
  const q = {
    select: (columns: string) => {
      db.selects.push({ table, columns });
      return q;
    },
    eq: (key: string, value: unknown) => {
      filters.push((row) => get(row, key) === value);
      return q;
    },
    in: (key: string, values: unknown[]) => {
      filters.push((row) => values.includes(get(row, key)));
      return q;
    },
    order: (key: string, opts: { ascending: boolean }) => {
      order = { key, ascending: opts.ascending };
      return q;
    },
    limit: (n: number) => {
      limit = n;
      return q;
    },
    single: async () => ({ data: result()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: result(), error: null }).then(resolve),
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => query(table),
  }),
}));

const { GET } = await import('./route');

const get_ = (search = `?brand=${BRAND}`) =>
  GET(new Request(`http://localhost/api/chat/runs/tray${search}`));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  db.user = { id: ME };
  db.selects = [];
  db.tables = {
    profiles: [
      { id: ME, organization_id: ORG },
      { id: 'user-2', organization_id: ORG },
    ],
    chat_conversations: [
      {
        id: 'chat-mine',
        user_id: ME,
        organization_id: ORG,
        title: 'Action Center tasks',
        last_message_at: minutesAgo(1),
      },
      {
        id: 'chat-mine-2',
        user_id: ME,
        organization_id: ORG,
        title: 'Weekly report',
        last_message_at: minutesAgo(30),
      },
      {
        id: 'chat-theirs',
        user_id: 'user-2',
        organization_id: ORG,
        title: 'Their secret chat',
        last_message_at: minutesAgo(2),
      },
      {
        id: 'chat-elsewhere',
        user_id: ME,
        organization_id: 'org-2',
        title: 'Another workspace',
        last_message_at: minutesAgo(3),
      },
    ],
    chat_runs: [
      {
        id: 'run-1',
        conversation_id: 'chat-mine',
        status: 'waiting',
        created_at: minutesAgo(5),
        finished_at: null,
      },
      {
        id: 'run-2',
        conversation_id: 'chat-mine-2',
        status: 'done',
        created_at: minutesAgo(40),
        finished_at: minutesAgo(35),
      },
      {
        id: 'run-3',
        conversation_id: 'chat-theirs',
        status: 'running',
        created_at: minutesAgo(1),
        finished_at: null,
      },
      {
        id: 'run-4',
        conversation_id: 'chat-elsewhere',
        status: 'running',
        created_at: minutesAgo(1),
        finished_at: null,
      },
    ],
    chat_run_steps: [
      {
        id: 's1',
        run_id: 'run-1',
        position: 1,
        kind: 'read',
        status: 'done',
        label: 'Read Action Center',
        tool: 'list_actions',
        debug_json: {},
      },
      {
        id: 's2',
        run_id: 'run-1',
        position: 2,
        kind: 'write',
        status: 'waiting',
        label: 'Change one cited passage',
        tool: 'update_draft',
        debug_json: {},
      },
      {
        id: 's3',
        run_id: 'run-3',
        position: 1,
        kind: 'read',
        status: 'running',
        label: 'Read their data',
        tool: 'x',
        debug_json: {},
      },
    ],
    content_agent_runs: [
      {
        id: 'crun-1',
        kind: 'fix',
        steps: [
          { key: 'read_rules', count: 3 },
          { key: 'write_changes', count: null },
        ],
        step: 1,
        started_at: minutesAgo(2),
        finished_at: null,
        stopped_at: null,
        outcome: null,
        draft_id: 'draft-1',
        content_drafts: { title: 'Pricing FAQ', brand_id: BRAND },
      },
      {
        id: 'crun-2',
        kind: 'fix',
        steps: [{ key: 'read_rules', count: 3 }],
        step: 0,
        started_at: minutesAgo(1),
        finished_at: null,
        stopped_at: null,
        outcome: null,
        draft_id: 'draft-2',
        content_drafts: { title: 'Another brand’s draft', brand_id: OTHER_BRAND },
      },
    ],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/chat/runs/tray', () => {
  it.each([undefined, '', 'false'])('is not found with CHAT_AGENTIC=%s', async (value) => {
    vi.stubEnv('CHAT_AGENTIC', value);
    const res = await get_();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, failure: 'not_found', error: 'Not found' });
    // Nothing of Chat is read while it is off.
    expect(db.selects.map((s) => s.table)).toEqual(['profiles']);
  });

  it("is not found for a workspace Chat isn't on for", async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-9');
    expect((await get_()).status).toBe(404);
  });

  it('asks the signed-out to sign in', async () => {
    db.user = null;
    const res = await get_();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, failure: 'session', error: 'Unauthorized' });
  });

  it('refuses a brand that is no id', async () => {
    const res = await get_('?brand=not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, failure: 'failed', error: 'Invalid brand' });
  });

  it("shows the person's own runs and the brand's, newest first, and no one else's", async () => {
    const res = await get_();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.runs.map((r: Row) => [r.title, r.state, r.href])).toEqual([
      ['Pricing FAQ', 'running', '/dashboard/content/editor/draft-1'],
      ['Action Center tasks', 'needsYou', '/dashboard/chat/chat-mine'],
      ['Weekly report', 'done', '/dashboard/chat/chat-mine-2'],
    ]);
    expect([body.running, body.needsYou]).toEqual([1, 1]);
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('Their secret chat');
    expect(wire).not.toContain('Read their data');
    expect(wire).not.toContain('Another workspace');
    expect(wire).not.toContain('Another brand');
    expect(body.runs[1]).toMatchObject({
      step: 2,
      steps: 2,
      stepLabel: 'Change one cited passage',
    });
  });

  it('reads steps by their member columns, never * or the tool', async () => {
    await get_();
    const steps = db.selects.find((s) => s.table === 'chat_run_steps')!;
    expect(steps.columns).toBe(CHAT_RUN_STEP_SELECT);
    for (const { columns } of db.selects) {
      expect(columns).not.toContain('*');
      expect(columns).not.toMatch(/\btool\b|debug_json/);
    }
    const wire = JSON.stringify(await (await get_()).json());
    expect(wire).not.toMatch(/list_actions|update_draft|debug/);
  });

  it('says a read that failed, or threw, as plain JSON', async () => {
    const tables = db.tables;
    db.tables = new Proxy(tables, {
      get: (target, table: string) => {
        if (table === 'chat_runs') throw new Error('connection reset');
        return target[table];
      },
    });
    const res = await get_();
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      ok: false,
      failure: 'failed',
      error: 'Failed to read runs',
    });
    db.tables = tables;
  });

  it('shows only Chat runs without a brand', async () => {
    const body = await (await get_('')).json();
    expect(body.runs.map((r: Row) => r.href)).toEqual([
      '/dashboard/chat/chat-mine',
      '/dashboard/chat/chat-mine-2',
    ]);
    expect(db.selects.some((s) => s.table === 'content_agent_runs')).toBe(false);
  });
});
