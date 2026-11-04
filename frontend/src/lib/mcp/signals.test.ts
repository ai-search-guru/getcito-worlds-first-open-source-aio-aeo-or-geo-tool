import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * list_signals returns each signal's raw row plus the detail the dashboard's
 * drawer shows (AC-001): where, change, evidence and used_by_actions, every
 * action a signal was linked to (AC-007). These pin that a kind this build
 * doesn't know still comes back as it always did, and that a failed actions
 * read costs used_by_actions, not the signals.
 */

let rows: Record<string, unknown[]> = {};
let errors: Record<string, { message: string } | null> = {};
let linkReads: string[][] = [];

function builder(table: string) {
  let ids: string[] | null = null;
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    in: (_column: string, values: string[]) => {
      ids = values;
      if (table === 'action_signals') linkReads.push(values);
      return chain;
    },
    range: () => chain,
    maybeSingle: async () => ({ data: table === 'brands' ? { id: 'b1' } : null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: { message: string } | null }) => void) => {
      const data = (rows[table] ?? []).filter(
        (row) =>
          table !== 'action_signals' || ids!.includes((row as { signal_id: string }).signal_id),
      );
      resolve({ data, error: errors[table] ?? null });
    },
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { listSignalsFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const row = (over: Record<string, unknown>) => ({
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: '2026-10-08T10:53:00+00:00',
  last_detected_at: '2026-10-09T10:53:00+00:00',
  resolved_at: null,
  previous_value: null,
  current_value: null,
  change_value: null,
  payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
  kpi_keys: [],
  action_id: 'a1',
  ...over,
});

beforeEach(() => {
  errors = {};
  linkReads = [];
  rows = {
    signals: [row({}), row({ id: 's2', kind: 'retired_kind', action_id: null, payload: {} })],
    prompts: [
      {
        id: 'p1',
        platforms: ['chatgpt-web'],
        regions: ['US'],
        topic_id: 't1',
        is_active: true,
        topics: { name: 'Coffee' },
      },
    ],
    // The latest link first: the current action, then a closed one before it.
    action_signals: [
      {
        signal_id: 's1',
        actions: { id: 'a1', action_no: 52, kind: 'recover_lost_citations', status: 'new' },
      },
      {
        signal_id: 's1',
        actions: { id: 'a0', action_no: 31, kind: 'recover_lost_citations', status: 'completed' },
      },
    ],
  };
});

describe('listSignalsFor', () => {
  it('adds where, change, evidence and the actions using each signal', async () => {
    const [known, unknown] = (await listSignalsFor(auth, { brandId: 'b1' }))!;
    expect(known).toMatchObject({
      id: 's1',
      action_id: 'a1',
      where: {
        prompt: { id: 'p1', text: 'Best coffee subscription?' },
        topic: 'Coffee',
        tracked_on: [{ slug: 'chatgpt-web', name: 'ChatGPT' }],
        tracked_in: [{ code: 'US', name: 'United States' }],
        lost_url: null,
        cited_now: null,
      },
      change: null,
      evidence: { links: [{ kind: 'prompt_answers', path: '/dashboard/prompts/p1' }] },
      used_by_actions: [
        { id: 'a1', action_no: 52, kind: 'recover_lost_citations', status: 'new' },
        { id: 'a0', action_no: 31, kind: 'recover_lost_citations', status: 'completed' },
      ],
    });
    // A kind this build has no copy for keeps its raw row.
    expect(unknown).toMatchObject({ id: 's2', kind: 'retired_kind', used_by_actions: [] });
    expect(unknown).not.toHaveProperty('where');
    // Only signals with an action are looked up: s2 has none.
    expect(linkReads).toEqual([['s1']]);
  });

  it("puts the signal's current action first when its link is older", async () => {
    rows.signals = [row({ action_id: 'a0' })];
    const [known] = (await listSignalsFor(auth, { brandId: 'b1' }))!;
    expect((known.used_by_actions as { id: string }[]).map((a) => a.id)).toEqual(['a0', 'a1']);
  });

  it('reads the links of a full page in chunks of 100 signals', async () => {
    rows.signals = Array.from({ length: 150 }, (_, i) => row({ id: `s${i + 1}` }));
    rows.action_signals.push({
      signal_id: 's150',
      actions: { id: 'a9', action_no: 77, kind: 'recover_lost_citations', status: 'new' },
    });
    const signals = (await listSignalsFor(auth, { brandId: 'b1', limit: 150 }))!;

    expect(linkReads.map((ids) => ids.length)).toEqual([100, 50]);
    expect(signals[0].used_by_actions).toHaveLength(2);
    expect(signals[149].used_by_actions).toEqual([
      { id: 'a9', action_no: 77, kind: 'recover_lost_citations', status: 'new' },
    ]);
    expect(signals[1].used_by_actions).toEqual([]);
  });

  it('still returns the signals when the actions read fails', async () => {
    errors.action_signals = { message: 'timeout' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [known] = (await listSignalsFor(auth, { brandId: 'b1' }))!;
    expect(known).toMatchObject({ id: 's1', used_by_actions: [] });
  });
});
