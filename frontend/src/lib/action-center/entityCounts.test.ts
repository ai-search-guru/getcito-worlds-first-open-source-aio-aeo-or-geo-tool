import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  currentPriorityReason,
  currentTaskParams,
  readEntityCounts,
  removedTargets,
  withEntityCounts,
  withoutTargetIds,
  type EntityCountRow,
} from './entityCounts';
import { affectedOf } from './affected';

const row = (over: Partial<EntityCountRow> = {}): EntityCountRow => ({
  action_id: 'a1',
  entity_type: 'prompts',
  total: 13,
  removed: 1,
  removed_labels: ['best crm for agents'],
  removed_keys: ['p1'],
  ...over,
});

describe('withEntityCounts (AC-009)', () => {
  it('reads the count left, and says what was removed', () => {
    const payload = { targetEntity: 'prompts', targetCount: 13, promptCount: 13 };
    const now = withEntityCounts(payload, [row()]);
    expect(now).toMatchObject({
      targetCount: 12,
      promptCount: 12,
      createdTargetCount: 13,
      removedCount: 1,
      removedLabels: ['best crm for agents'],
    });
    expect(removedTargets(now)).toEqual({ count: 1, labels: ['best crm for agents'] });
  });

  it('leaves an action with nothing removed, or another list, as it was', () => {
    const payload = { targetEntity: 'prompts', targetCount: 13 };
    expect(withEntityCounts(payload, [row({ removed: 0 })])).toBe(payload);
    expect(withEntityCounts(payload, [row({ entity_type: 'pages' })])).toBe(payload);
    expect(withEntityCounts(payload, undefined)).toBe(payload);
    expect(removedTargets(payload)).toBeNull();
  });

  it('never counts below none', () => {
    const now = withEntityCounts({ targetEntity: 'prompts', targetCount: 2 }, [
      row({ removed: 5 }),
    ]);
    expect(now).toMatchObject({ targetCount: 0, removedCount: 2 });
  });
});

describe('currentTaskParams', () => {
  const payload = withEntityCounts({ targetEntity: 'prompts', targetCount: 13 }, [row()]);

  it('names the count left in a task that named the action’s', () => {
    expect(currentTaskParams({ count: 13, entity: 'prompts' }, payload)).toEqual({
      count: 12,
      entity: 'prompts',
    });
  });

  it('names no count once none is left, so the plain title reads', () => {
    const none = withEntityCounts({ targetEntity: 'prompts', targetCount: 1 }, [row({ total: 1 })]);
    expect(currentTaskParams({ count: 1, entity: 'prompts', page: '/x' }, none)).toEqual({
      page: '/x',
    });
  });

  it('keeps any other count as written', () => {
    const params = { count: 4, entity: 'pages' };
    expect(currentTaskParams(params, payload)).toBe(params);
    expect(currentTaskParams(undefined, payload)).toBeUndefined();
  });
});

describe('the affected list’s count', () => {
  it('counts as the action does, not as the signals now say', () => {
    const payload = withEntityCounts(
      {
        targetEntity: 'prompts',
        targetCount: 13,
        targets: [{ id: 'p2', label: 'one' }],
      },
      [row()],
    );
    expect(affectedOf([], payload).promptTotal).toBe(12);
  });

  it('lists none of what was removed, by its id', () => {
    const payload = withEntityCounts(
      {
        targetEntity: 'prompts',
        targetCount: 3,
        targets: [
          { id: 'p1', label: 'best crm for agents' },
          // Another prompt with the same text stays.
          { id: 'p3', label: 'best crm for agents' },
          { id: 'p2', label: 'crm pricing' },
        ],
      },
      [row({ total: 3 })],
    );
    const affected = affectedOf([], payload);
    expect(affected.prompts.map((p) => p.id)).toEqual(['p3', 'p2']);
    expect(affected.promptTotal).toBe(2);
  });

  it('lists none of what was removed where it lists prompts by text, by its label', () => {
    // A topic gap keeps its prompts by id and lists them as texts: 00244
    // keeps a removed one's text as its label.
    const payload = withEntityCounts(
      {
        targetEntity: 'prompts',
        targetCount: 2,
        promptIds: ['p1', 'p2'],
        targets: ['best crm for agents', 'crm pricing'],
      },
      [row({ total: 2 })],
    );
    expect(payload).toMatchObject({ removedKeys: ['p1'], removedLabels: ['best crm for agents'] });
    const affected = affectedOf([], payload);
    expect(affected.prompts.map((p) => p.text)).toEqual(['crm pricing']);
    expect(affected.promptTotal).toBe(1);
  });

  it('lists targets given as text, and shows no count with nothing behind it', () => {
    const named = affectedOf([], {
      targetEntity: 'prompts',
      targetCount: 2,
      targets: ['crm pricing', 'crm for agents'],
    });
    expect(named.prompts.map((p) => p.text)).toEqual(['crm pricing', 'crm for agents']);
    expect(named.promptTotal).toBe(2);
    const bare = affectedOf([], { targetEntity: 'prompts', targetCount: 9 });
    expect(bare.promptTotal).toBe(0);
  });
});

describe('readEntityCounts', () => {
  it('reads the counts in calls of 500, by action', async () => {
    const rpc = vi.fn(async (_fn: string, args: { p_action_ids: string[] }) => ({
      data: args.p_action_ids.slice(0, 1).map((id) => row({ action_id: id })),
      error: null,
    }));
    const ids = Array.from({ length: 501 }, (_, i) => `a${i}`);
    const counts = await readEntityCounts({ rpc } as unknown as SupabaseClient, ids);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_action_ids).toHaveLength(500);
    expect([...counts.keys()]).toEqual(['a0', 'a500']);
  });

  it('leaves the actions as created when the counts can’t be read', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'missing' },
    }));
    const counts = await readEntityCounts({ rpc } as unknown as SupabaseClient, ['a1']);
    expect(counts.size).toBe(0);
  });
});

describe('currentPriorityReason', () => {
  it('names the count left where the reason named the action’s', () => {
    const payload = withEntityCounts({ targetEntity: 'prompts', targetCount: 13 }, [row()]);
    const reason = { subject: { entity: 'prompts', count: 13 }, days: 2 };
    expect(currentPriorityReason(reason, payload)).toEqual({
      subject: { entity: 'prompts', count: 12 },
      days: 2,
    });
    const other = { subject: { entity: 'pages', count: 13 } };
    expect(currentPriorityReason(other, payload)).toBe(other);
    expect(currentPriorityReason(null, payload)).toBeNull();
  });
});

describe('withoutTargetIds', () => {
  it('drops a big group’s ids from a signal, and leaves the rest', () => {
    const row = { id: 's1', payload: { targets: [1], targetIds: ['a', 'b'] } };
    expect(withoutTargetIds(row)).toEqual({ id: 's1', payload: { targets: [1] } });
    const plain = { id: 's2', payload: { targets: [1] } };
    expect(withoutTargetIds(plain)).toBe(plain);
  });
});
