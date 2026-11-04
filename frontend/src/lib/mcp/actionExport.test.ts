import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * get_action's Markdown and CSV (AC-005): the drawer's Copy Data and Export
 * CSV, read through an API key — nothing for another organization's action,
 * and the Affected list, its demand, the Why and a Content action's
 * opportunity worked out here as the drawer works them out.
 */

type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let reads: string[];
/** Tables whose reads fail. */
let failing: Set<string>;

/** A column, or a joined one ("brands.organization_id"), as PostgREST filters it. */
function valueOf(row: Row, column: string): unknown[] {
  const [head, tail] = column.split('.');
  if (!tail) return [row[head]];
  const joined = row[head];
  return (Array.isArray(joined) ? joined : [joined]).map((j) => (j as Row | null)?.[tail]);
}

function table(name: string) {
  reads.push(name);
  const tests: ((row: Row) => boolean)[] = [];
  let range: [number, number] | null = null;
  const result = () => {
    const found = (rows[name] ?? []).filter((row) => tests.every((test) => test(row)));
    return range ? found.slice(range[0], range[1] + 1) : found;
  };
  let head = false;
  const chain = {
    select: (_columns?: string, options?: { head?: boolean }) => {
      head = Boolean(options?.head);
      return chain;
    },
    eq: (column: string, value: unknown) => {
      tests.push((row) => valueOf(row, column).includes(value));
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      tests.push((row) => valueOf(row, column).some((v) => values.includes(v)));
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    is: () => chain,
    range: (from: number, to: number) => {
      range = [from, to];
      return chain;
    },
    maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) =>
      resolve(
        failing.has(name)
          ? { data: null, error: { message: `${name} unavailable` } }
          : head
            ? { data: null, count: result().length, error: null }
            : { data: result(), error: null },
      ),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: table,
    // The action's list counts (AC-009): nothing removed here.
    rpc: async () => ({ data: [], error: null }),
  },
}));

const { exportActionFor } = await import('./actionExport');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const actionRow = (over: Row = {}): Row => ({
  id: 'a1',
  action_no: 52,
  brand_id: 'b1',
  brands: { organization_id: 'org-1' },
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  payload: {},
  kpi_keys: [],
  assignee_id: null,
  due_date: null,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
  priority_score: 84,
  priority_level: 'high',
  priority_reason: null,
  priority_updated_at: null,
  ...over,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/');
  reads = [];
  failing = new Set();
  rows = {
    actions: [actionRow()],
    action_tasks: [
      {
        id: 't1',
        action_id: 'a1',
        position: 1,
        task_key: null,
        title: 'Add a 2026 table to /pricing',
        status: 'todo',
        skip_reason: null,
        title_params: {},
        depends_on: [],
        details: { where: 'acme.example/pricing', how: ['Add a table.'], type: 'content' },
      },
    ],
    signals: [
      {
        id: 's1',
        brand_id: 'b1',
        category: 'citation',
        kind: 'lost_citations',
        impact: 'high',
        status: 'new',
        source: ['ai_results'],
        detected_at: '2026-10-09T00:00:00Z',
        last_detected_at: '2026-10-09T00:00:00Z',
        resolved_at: null,
        previous_value: null,
        current_value: null,
        change_value: null,
        payload: {
          promptId: 'p1',
          promptText: 'Best coffee subscription?',
          lostUrls: [{ url: 'https://acme.example/pricing', position: 2 }],
          citedNow: [{ url: 'https://beanbox.example/guide', position: 1 }],
        },
        kpi_keys: [],
        action_id: 'a1',
        action_signals: [{ action_id: 'a1' }],
      },
    ],
    action_events: [
      {
        id: 'e1',
        action_id: 'a1',
        event: 'created',
        data: {},
        actor_id: null,
        created_at: '2026-10-10T00:00:00Z',
      },
    ],
    kpi_definitions: [],
    prompts: [
      {
        id: 'p1',
        text: 'Best coffee subscription?',
        prompt_sets: { brand_id: 'b1' },
        platforms: ['chatgpt-web'],
        regions: ['US'],
        topic_id: null,
        is_active: true,
        topics: null,
      },
    ],
    prompt_volumes: [
      {
        prompt_id: 'p1',
        est_ai_volume: 5500,
        google_volumes: { a: 10_000, b: 12_200, c: 14_000 },
        ai_volume_multiplier: '0.450',
        keywords: ['a', 'b', 'c'],
        // Recent, so the confidence doesn't drop for its age whenever this runs.
        fetched_at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
      },
    ],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('exportActionFor', () => {
  it('writes the action as Copy Data does: every tab, the Affected list with its demand', async () => {
    const exported = await exportActionFor(auth, 'a1', 'markdown');
    expect(exported?.fileName).toBe('action-AC-52.md');
    const md = exported!.body;

    expect(md).toMatch(/^# .+ \(AC-52\)\n/);
    expect(md).toContain('Priority: 84 (High) · Category: Recover · Status: New');
    // The list's tags: the signals that support it now.
    expect(md).toMatch(/^Tags: 1 signal$/m);
    expect(md).toContain('Link: https://app.example.com/dashboard/action-center/actions?action=a1');
    expect(md).toContain('## Affected (1)');
    expect(md).toContain('Best coffee subscription?');
    // An estimate: its range and how sure (PROMPT-013).
    expect(md).toContain('4.1–6.9k (estimate, High confidence)');
    expect(md).toContain('## Tasks (1)\n1. Add a 2026 table to /pricing (To Do)');
    expect(md).toContain('## Signals (1)');
    // The Why in the action's own terms, from its signal, with the day in UTC.
    expect(md).toMatch(/Why: .*Oct 9/);
  });

  it("gives the Why the demand of a signal's prompt the action didn't keep", async () => {
    rows.actions = [actionRow({ payload: { targetEntity: 'prompts', targetCount: 1 } })];
    // What the action kept (00244): p1 alone.
    rows.action_entities = [
      {
        action_id: 'a1',
        entity_type: 'prompts',
        entity_key: 'p1',
        label: 'Best coffee subscription?',
        removed_at: null,
      },
    ];
    // A signal about a prompt the action never kept: not listed, but the Why names it.
    const [first] = rows.signals;
    rows.signals.push({
      ...first,
      id: 's2',
      payload: {
        promptId: 'p2',
        promptText: 'Coffee delivery near me',
        lostUrls: [{ url: 'https://acme.example/delivery', position: 3 }],
      },
    });
    rows.prompts.push({ ...rows.prompts[0], id: 'p2', text: 'Coffee delivery near me' });
    rows.prompt_volumes.push({ ...rows.prompt_volumes[0], prompt_id: 'p2' });

    const md = (await exportActionFor(auth, 'a1', 'markdown'))!.body;
    // The list is what it kept…
    expect(md).toContain('## Affected (1)\n- Best coffee subscription? · 4.1–6.9k');
    expect(md).not.toMatch(/^- Coffee delivery near me/m);
    // …and the Why, told from both signals, sums both prompts' demand.
    expect(md).toMatch(/^Why: 2 prompts \(8\.2–13\.8k AI searches a month, estimated\)/m);
  });

  it("still writes the action when its prompts' demand can't be read, without it", async () => {
    failing.add('prompt_volumes');
    const md = (await exportActionFor(auth, 'a1', 'markdown'))!.body;
    expect(md).toContain('Best coffee subscription?');
    expect(md).not.toContain('(estimate,');
  });

  it('dates the goal by its due date on a server east of UTC', async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'Europe/Istanbul';
    try {
      rows.actions = [actionRow({ due_date: '2026-11-09' })];
      const md = (await exportActionFor(auth, 'a1', 'markdown'))!.body;
      expect(md).toMatch(/^Goal: .* by Nov 9\.$/m);
    } finally {
      process.env.TZ = zone;
    }
  });

  it('writes the CSV with a row per affected item, task and signal', async () => {
    const exported = await exportActionFor(auth, 'a1', 'csv');
    expect(exported?.fileName).toBe('action-AC-52.csv');
    const lines = exported!.body.split('\n');
    expect(lines[0]).toMatch(/^section,action,ref,title,/);
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual([
      'affected',
      'task',
      'signal',
    ]);
  });

  it("says nothing of another organization's action, and reads nothing more", async () => {
    expect(
      await exportActionFor({ ...auth, organizationId: 'org-2' }, 'a1', 'markdown'),
    ).toBeNull();
    expect(reads).toEqual(['actions']);
    expect(await exportActionFor({ ...auth, organizationId: null }, 'a1', 'csv')).toBeNull();
  });

  it('lists what a Content action was sent from: its opportunity, prompts and kept queries', async () => {
    rows.actions = [
      actionRow({
        kind: 'content_opportunity',
        category: 'growth',
        payload: { opportunityId: 'o1' },
      }),
    ];
    rows.signals = [];
    rows.content_opportunities = [
      {
        id: 'o1',
        brand_id: 'b1',
        title: 'Coffee subscription guide',
        decision: 'create',
        brief: null,
        source_data: { targetPages: [{ url: 'https://acme.example/subscriptions', title: '' }] },
        cluster_id: 'c1',
        related_cluster_ids: [],
        prompt_id: null,
      },
    ];
    rows.prompt_cluster_members = [
      { cluster_id: 'c1', prompts: { id: 'p1', text: 'Best coffee subscription?' } },
    ];
    rows.prompt_cluster_queries = [
      {
        cluster_id: 'c1',
        query: 'coffee subscription',
        times_searched: 3,
        included: true,
        reason: '',
      },
      {
        cluster_id: 'c1',
        query: 'free coffee',
        times_searched: 1,
        included: false,
        reason: 'off-topic',
      },
    ];

    const md = (await exportActionFor(auth, 'a1', 'markdown'))!.body;
    expect(md).toContain('Coffee subscription guide');
    expect(md).toContain('https://app.example.com/dashboard/content/o1');
    expect(md).toContain('https://acme.example/subscriptions');
    expect(md).toContain('Best coffee subscription?');
    expect(md).toContain('coffee subscription');
    expect(md).not.toContain('free coffee');
  });

  it("says the opportunity can't be read when it is gone", async () => {
    rows.actions = [actionRow({ kind: 'content_opportunity', payload: { opportunityId: 'o9' } })];
    const md = (await exportActionFor(auth, 'a1', 'markdown'))!.body;
    expect(md).toContain(
      'Content opportunity: The opportunity this action was sent from is no longer available.',
    );
    expect(md).not.toContain('/dashboard/content/o9');
  });
});
