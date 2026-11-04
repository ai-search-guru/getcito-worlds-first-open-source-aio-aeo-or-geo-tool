import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * list_action_history says whether an action's outcome is the result or a
 * reading so far (learning B1): an action is read 7, 14 and 30 days after it
 * closed, and only the day-30 reading is final. It also gives its change net
 * of the control basket (learning B2) and why it was dismissed (learning A5).
 */

let actionRows: Record<string, unknown>[] = [];
/** A database without 00366: reading dismiss_reason fails with 42703. */
let without00366 = false;
const selected: string[] = [];

function builder(table: string) {
  let columns = '';
  const chain = {
    select: (cols: string) => {
      columns = cols;
      if (table === 'actions') selected.push(cols);
      return chain;
    },
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: { id: 'brand-1' }, error: null }),
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve(
        table === 'actions' && without00366 && columns.includes('dismiss_reason')
          ? {
              data: null,
              error: { code: '42703', message: 'column actions.dismiss_reason does not exist' },
            }
          : { data: table === 'actions' ? actionRows : [], error: null },
      ),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { listActionHistoryFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

function action(outcome: string | null, validation: Record<string, unknown> | null) {
  return {
    id: 'a1',
    action_no: 7,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'completed',
    outcome,
    validation,
    created_at: '2026-09-01T00:00:00Z',
    completed_at: '2026-09-10T00:00:00Z',
  };
}

async function row() {
  const rows = await listActionHistoryFor(auth, { brandId: 'brand-1' });
  return rows?.[0];
}

describe('listActionHistoryFor readings', () => {
  beforeEach(() => {
    actionRows = [];
  });

  it('is a reading so far until the day-30 one, on its latest day', async () => {
    actionRows = [
      action('improved', {
        readings: [
          { day: 7, outcome: 'no_meaningful_change' },
          { day: 14, outcome: 'improved' },
        ],
      }),
    ];
    expect(await row()).toMatchObject({ outcome: 'improved', final: false, reading_day: 14 });
  });

  it('is final once the day-30 reading is in', async () => {
    actionRows = [
      action('declined', {
        readings: [
          { day: 7, outcome: 'improved' },
          { day: 14, outcome: 'improved' },
          { day: 30, outcome: 'declined' },
        ],
        final: true,
      }),
    ];
    expect(await row()).toMatchObject({ outcome: 'declined', final: true, reading_day: 30 });
  });

  it('keeps the result of one measured once, before readings began', async () => {
    actionRows = [action('improved', { metrics: [] })];
    expect(await row()).toMatchObject({ final: true, reading_day: null });
  });

  it('is not final while its first reading is pending', async () => {
    actionRows = [action('pending_measurement', null)];
    expect(await row()).toMatchObject({ final: false, reading_day: null });
  });
});

describe('listActionHistoryFor results', () => {
  beforeEach(() => {
    actionRows = [];
  });

  it('gives its change net of the control basket, the metrics it can name', async () => {
    actionRows = [
      action('improved', {
        control: {
          basis: 'topics',
          prompts: 24,
          net: [
            { metric: 'visibility', net: 4.2, unit: 'points', control: { before: 30, after: 31 } },
            { metric: 'citations', net: 18.5, unit: 'percent' },
            { metric: 'sessions', net: 3, unit: 'sessions' },
          ],
        },
      }),
    ];
    expect((await row())?.net_of_control).toEqual({
      basis: 'topics',
      control_prompts: 24,
      metrics: [
        { metric: 'visibility', net: 4.2, unit: 'points' },
        { metric: 'citations', net: 18.5, unit: 'percent' },
      ],
    });
  });

  it('gives none when it could not be netted', async () => {
    actionRows = [action('improved', { metrics: [] })];
    expect((await row())?.net_of_control).toBeNull();
  });

  it('says why a dismissed one was turned down, and nothing it does not know', async () => {
    actionRows = [{ ...action(null, null), status: 'dismissed', dismiss_reason: 'already_done' }];
    expect(await row()).toMatchObject({ status: 'dismissed', dismiss_reason: 'already_done' });
    actionRows = [{ ...action(null, null), status: 'dismissed', dismiss_reason: 'bored' }];
    expect((await row())?.dismiss_reason).toBeNull();
  });

  it('gives no reason to one that is no longer dismissed', async () => {
    actionRows = [{ ...action('improved', null), dismiss_reason: 'not_now' }];
    expect((await row())?.dismiss_reason).toBeNull();
  });
});

describe('listActionHistoryFor without 00366', () => {
  beforeEach(() => {
    without00366 = true;
    selected.length = 0;
  });
  afterEach(() => {
    without00366 = false;
  });

  it('reads the rest, with no reason given', async () => {
    actionRows = [{ ...action(null, null), status: 'dismissed' }];
    expect(await row()).toMatchObject({ id: 'a1', status: 'dismissed', dismiss_reason: null });
    expect(selected).toHaveLength(2);
    expect(selected[1]).not.toContain('dismiss_reason');
  });
});
