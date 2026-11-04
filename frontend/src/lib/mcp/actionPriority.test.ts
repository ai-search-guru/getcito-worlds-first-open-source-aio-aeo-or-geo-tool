import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * list_actions carries each action's priority (AC-006) and can list them in
 * the order to work on them.
 */

let orders: [string, Record<string, unknown> | undefined][] = [];
let entityCounts: unknown[] = [];

const ACTIONS = [
  {
    id: 'a1',
    action_no: 52,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'new',
    outcome: null,
    assignee_id: null,
    due_date: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-14T00:00:00Z',
    priority_score: 94,
    priority_level: 'critical',
    priority_reason: { change: 'lost', demand: 'high' },
  },
  {
    id: 'a2',
    action_no: 53,
    category: 'growth',
    kind: 'create_content_for_demand',
    impact: 'medium',
    status: 'new',
    outcome: null,
    assignee_id: null,
    due_date: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
    priority_score: null,
    priority_level: null,
    priority_reason: null,
  },
];

let actionRows: Record<string, unknown>[] = ACTIONS;
let taskRows: Record<string, unknown>[] = [];
/** What get_action's own row adds to the first action. */
let detail: Record<string, unknown> = {};
/** A database without 00366: reading dismiss_reason fails with 42703. */
let without00366 = false;

function builder(table: string) {
  let columns = '';
  const chain = {
    select: (cols: string) => {
      columns = cols;
      return chain;
    },
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: (column: string, options?: Record<string, unknown>) => {
      if (table === 'actions') orders.push([column, options]);
      return chain;
    },
    limit: () => chain,
    maybeSingle: async () =>
      table === 'actions' && without00366 && columns.includes('dismiss_reason')
        ? {
            data: null,
            error: { code: '42703', message: 'column actions.dismiss_reason does not exist' },
          }
        : {
            data:
              table === 'actions'
                ? { ...ACTIONS[0], brand_id: 'brand-1', payload: {}, ...detail }
                : { id: 'brand-1' },
            error: null,
          },
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({
        data: table === 'actions' ? actionRows : table === 'action_tasks' ? taskRows : [],
        error: null,
      }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    // The actions' list counts (AC-009): nothing removed unless a test says so.
    rpc: async () => ({ data: entityCounts, error: null }),
  },
}));

const { getActionFor, listActionsFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

describe('listActionsFor', () => {
  beforeEach(() => {
    orders = [];
    entityCounts = [];
    actionRows = ACTIONS;
  });

  it('gives each action its priority, or null before it is scored', async () => {
    const rows = await listActionsFor(auth, { brandId: 'brand-1' });
    expect(rows?.map((r) => r.priority)).toEqual([
      {
        score: 94,
        level: 'critical',
        reason: { change: 'lost', demand: 'high' },
        // A reason from before the factors were kept has no confidence.
        confidence: null,
        confidence_note: null,
        confidence_score: null,
      },
      null,
    ]);
    // Highest priority first, unscored ones last, as the app lists them.
    expect(orders).toEqual([
      ['priority_score', { ascending: false, nullsFirst: false }],
      ['updated_at', { ascending: false }],
    ]);
  });

  it('names the count left in a reason that named the action’s, as get_action does (AC-009)', async () => {
    actionRows = [
      {
        ...ACTIONS[0],
        priority_reason: { subject: { entity: 'prompts', count: 13 }, days: 2 },
        target_entity: 'prompts',
        target_count: 13,
      },
    ];
    entityCounts = [
      { action_id: 'a1', entity_type: 'prompts', total: 13, removed: 1, removed_labels: ['x'] },
    ];
    const rows = await listActionsFor(auth, { brandId: 'brand-1' });
    expect(rows?.[0].priority?.reason).toEqual({
      subject: { entity: 'prompts', count: 12 },
      days: 2,
    });
  });

  it('says how sure the score is as a level and why, keeping the raw factor, and which are stale', async () => {
    actionRows = [
      {
        ...ACTIONS[0],
        priority_reason: { kinds: 1, sources: 1, factors: { confidence: 0.3 } },
        stale_at: '2026-10-31T03:00:00Z',
      },
      { ...ACTIONS[1], status: 'on_hold', stale_at: '2026-10-31T03:00:00Z' },
    ];
    const rows = await listActionsFor(auth, { brandId: 'brand-1' });
    expect(rows?.[0].priority).toMatchObject({
      confidence: 'low',
      confidence_note: 'one kind of finding from one source',
      confidence_score: 0.3,
      reason: { factors: { confidence: 0.3 } },
    });
    expect(rows?.map((r) => [r.stale, r.stale_at])).toEqual([
      [true, '2026-10-31T03:00:00Z'],
      // Only a New action is stale.
      [false, null],
    ]);
  });

  it('lists the most recently updated first when asked', async () => {
    await listActionsFor(auth, { brandId: 'brand-1', sort: 'updated' });
    expect(orders).toEqual([['updated_at', { ascending: false }]]);
  });
});

describe('getActionFor', () => {
  it("gives each task the exact page, the change and how it's checked (AC-010)", async () => {
    taskRows = [
      {
        id: 't1',
        position: 1,
        task_key: null,
        title: 'Add an H2 to /blog/tracking',
        status: 'todo',
        details: {
          url: '/blog/tracking',
          change: { before: null, after: 'H2 "How accurate is AI search tracking?"' },
          doneWhen: 'H2 present · answer under 60 words · page re-fetched',
          check: 'auto',
        },
      },
    ];
    try {
      const action = await getActionFor(auth, 'a1');
      expect(action?.tasks[0].details).toMatchObject({
        url: '/blog/tracking',
        change: { before: null, after: 'H2 "How accurate is AI search tracking?"' },
        done_when: 'H2 present · answer under 60 words · page re-fetched',
        check: 'auto',
      });
    } finally {
      taskRows = [];
    }
  });

  it("gives a library task its template's Done when (AC-010)", async () => {
    taskRows = [
      {
        id: 't2',
        position: 1,
        task_key: 'refresh_content',
        title: null,
        status: 'todo',
        details: { check: 'auto', source: 'template' },
      },
      {
        id: 't3',
        position: 2,
        task_key: 'analyze_citations',
        title: null,
        status: 'todo',
        details: null,
      },
    ];
    try {
      const action = await getActionFor(auth, 'a1');
      expect(action?.tasks[0].details).toMatchObject({
        check: 'auto',
        done_when:
          'The page has its new facts and date, or its draft is marked ready in the Content Editor',
      });
      // The analysis has no template.
      expect(action?.tasks[1].details).toBeNull();
    } finally {
      taskRows = [];
    }
  });

  it('gives a task planned while its template was Automatic its Manual check (AC-010)', async () => {
    taskRows = [
      {
        id: 't4',
        position: 1,
        task_key: 'improve_cta_path',
        title: null,
        status: 'todo',
        details: { check: 'auto', source: 'template' },
      },
    ];
    try {
      const action = await getActionFor(auth, 'a1');
      expect(action?.tasks[0].details).toMatchObject({ check: 'manual' });
    } finally {
      taskRows = [];
    }
  });

  it('gives a closed action its change net of the control and why it was dismissed', async () => {
    detail = {
      status: 'completed',
      outcome: 'improved',
      validation: {
        control: {
          basis: 'brand',
          prompts: 40,
          net: [{ metric: 'mentions', net: 2.5, unit: 'points' }],
        },
      },
      dismiss_reason: null,
    };
    try {
      expect(await getActionFor(auth, 'a1')).toMatchObject({
        net_of_control: {
          basis: 'brand',
          control_prompts: 40,
          metrics: [{ metric: 'mentions', net: 2.5, unit: 'points' }],
        },
        dismiss_reason: null,
      });
      detail = { status: 'dismissed', validation: null, dismiss_reason: 'wrong_data' };
      expect(await getActionFor(auth, 'a1')).toMatchObject({
        net_of_control: null,
        dismiss_reason: 'wrong_data',
      });
      // A reason left from an earlier dismissal is not read once it moved on.
      detail = { status: 'in_progress', validation: null, dismiss_reason: 'wrong_data' };
      expect(await getActionFor(auth, 'a1')).toMatchObject({ dismiss_reason: null });
    } finally {
      detail = {};
    }
  });

  it('reads the action on a database without 00366, with no reason given', async () => {
    without00366 = true;
    detail = { status: 'dismissed', validation: null };
    try {
      expect(await getActionFor(auth, 'a1')).toMatchObject({
        id: 'a1',
        status: 'dismissed',
        dismiss_reason: null,
      });
    } finally {
      without00366 = false;
      detail = {};
    }
  });

  it('gives the action its priority', async () => {
    const action = await getActionFor(auth, 'a1');
    expect(action?.priority).toEqual({
      score: 94,
      level: 'critical',
      reason: { change: 'lost', demand: 'high' },
      confidence: null,
      confidence_note: null,
      confidence_score: null,
    });
  });
});
