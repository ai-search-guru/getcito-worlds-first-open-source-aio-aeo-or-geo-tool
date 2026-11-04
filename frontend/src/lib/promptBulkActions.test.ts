/**
 * promptBulkActions.test.ts  (PROMPT-006)
 *
 * The prompts table's bulk action bar: selecting the page, capping a bulk
 * "Suggest content", summing up how it went, and deleting in small batches.
 */

import { describe, expect, test } from 'vitest';
import type { ContentUsage } from '@/lib/contentUsage';
import {
  allSelected,
  bulkSuggestBlock,
  bulkSuggestSummary,
  deleteInBatches,
  emptyTally,
  PROMPT_DELETE_BATCH,
  runInTurn,
  tallyOutcome,
  toggleAll,
} from './promptBulkActions';
import type { PromptSuggestionOutcome } from '@/lib/contentJob';

const usage = (remaining: number, perRequest = 3, limit = 10): ContentUsage => ({
  plan: 'starter',
  planName: 'Starter',
  periodStart: null,
  periodEnd: null,
  opportunities: { used: limit - remaining, limit, remaining, perRequest },
  briefs: { used: 0, limit: 10, remaining: 10 },
});

describe('selecting the page', () => {
  test('the header selects every row on the page, then clears them', () => {
    const page = ['a', 'b', 'c'];
    const some = new Set(['a']);
    expect(allSelected(page, some)).toBe(false);
    const all = toggleAll(page, some);
    expect([...all]).toEqual(page);
    expect(allSelected(page, all)).toBe(true);
    expect(toggleAll(page, all).size).toBe(0);
  });

  test('an empty page is never "all selected"', () => {
    expect(allSelected([], new Set())).toBe(false);
  });
});

describe('bulkSuggestBlock', () => {
  test('allows up to what one "+ New" request may ask for', () => {
    expect(bulkSuggestBlock(3, usage(10))).toBeNull();
    expect(bulkSuggestBlock(4, usage(10))).toBe('Select up to 3 to suggest content');
  });

  test('never more than is left of the month', () => {
    expect(bulkSuggestBlock(2, usage(1))).toBe('Select up to 1 to suggest content');
    expect(bulkSuggestBlock(1, usage(0))).toBe('Monthly limit reached');
  });

  test('an unlimited plan still takes the per-request cap', () => {
    expect(bulkSuggestBlock(5, usage(-1, 5, -1))).toBeNull();
    expect(bulkSuggestBlock(6, usage(-1, 5, -1))).toBe('Select up to 5 to suggest content');
  });

  test('never blocks without an active plan: 0 of 0 is no plan, and the click opens its dialog', () => {
    expect(bulkSuggestBlock(1, { ...usage(0, 0, 0), noPlan: true })).toBeNull();
    // A read-only workspace reads the same, marked or not.
    expect(bulkSuggestBlock(1, usage(0, 0, 0), { isLocked: true })).toBeNull();
    expect(bulkSuggestBlock(1, usage(0, 0, 0))).toBe('Monthly limit reached');
  });

  test('waits for the quota before asking for anything', () => {
    expect(bulkSuggestBlock(1, null)).toBe('Checking your content quota…');
  });

  test("falls back to the smallest cap when the quota can't be read", () => {
    expect(bulkSuggestBlock(3, null, { unavailable: true })).toBeNull();
    expect(bulkSuggestBlock(4, null, { unavailable: true })).toBe(
      'Select up to 3 to suggest content',
    );
  });
});

describe('bulkSuggestSummary', () => {
  const run = (...outcomes: Parameters<typeof tallyOutcome>[1][]) => {
    const tally = emptyTally(outcomes.length);
    for (const o of outcomes) tallyOutcome(tally, o);
    return tally;
  };

  test('leads with what was written and lists the rest', () => {
    expect(
      bulkSuggestSummary(
        run(
          { kind: 'created', opportunityId: 'o1' },
          { kind: 'created', opportunityId: 'o2' },
          { kind: 'existing', opportunityId: 'o3' },
          { kind: 'nothing' },
        ),
      ),
    ).toEqual({
      tone: 'success',
      title: '2 content suggestions created',
      description: '1 already had one · 1 needs tracked answers and a prompt group first',
    });
  });

  test('says when every prompt already had one', () => {
    expect(
      bulkSuggestSummary(
        run({ kind: 'existing', opportunityId: 'o1' }, { kind: 'existing', opportunityId: 'o2' }),
      ),
    ).toMatchObject({ tone: 'info', title: 'These prompts already have content suggestions' });
  });

  test('counts the prompts the monthly limit stopped', () => {
    const tally = emptyTally(3);
    tallyOutcome(tally, { kind: 'created', opportunityId: 'o1' });
    tallyOutcome(tally, { kind: 'limited' });
    expect(bulkSuggestSummary(tally)).toEqual({
      tone: 'success',
      title: '1 content suggestion created',
      description: 'Monthly limit reached · 2 not started',
    });
  });

  test('reports a limit hit before anything as an error', () => {
    const tally = emptyTally(2);
    tallyOutcome(tally, { kind: 'limited' });
    expect(bulkSuggestSummary(tally)).toMatchObject({
      tone: 'error',
      title: 'Monthly content limit reached.',
    });
  });

  test('reports a run where everything failed as an error', () => {
    expect(
      bulkSuggestSummary(run({ kind: 'failed', message: 'x' }, { kind: 'failed', message: null })),
    ).toEqual({
      tone: 'error',
      title: "Couldn't write content suggestions",
      description: '2 failed',
    });
  });

  test('keeps jobs still being written apart from failures', () => {
    expect(bulkSuggestSummary(run({ kind: 'timeout' }, { kind: 'nothing' }))).toEqual({
      tone: 'info',
      title: 'No new content suggestions',
      description: '1 needs tracked answers and a prompt group first · 1 still being written',
    });
  });
});

describe('runInTurn', () => {
  test('asks for one prompt at a time, in order', async () => {
    const log: string[] = [];
    const tally = await runInTurn(['a', 'b'], async (item) => {
      log.push(`start ${item}`);
      await Promise.resolve();
      log.push(`end ${item}`);
      return { kind: 'created', opportunityId: `o-${item}` };
    });
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(tally.created).toEqual(['o-a', 'o-b']);
  });

  test.each<[string, PromptSuggestionOutcome, string]>([
    ['the monthly limit', { kind: 'limited' }, 'Monthly content limit reached.'],
    ['a job that outlives the wait', { kind: 'timeout' }, 'No new content suggestions'],
  ])('stops at %s', async (_name, stop, title) => {
    const seen: number[] = [];
    const tally = await runInTurn([1, 2, 3], async (item) => {
      seen.push(item);
      return item === 1 ? { kind: 'created', opportunityId: 'o1' } : stop;
    });
    expect(seen).toEqual([1, 2]);
    expect(bulkSuggestSummary(tally).description).toBe(
      stop.kind === 'limited'
        ? 'Monthly limit reached · 2 not started'
        : '1 still being written · 1 not started',
    );
    expect(bulkSuggestSummary({ ...tally, created: [] }).title).toBe(title);
  });
});

describe('deleteInBatches', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

  test('deletes a few prompts per call, one call after another', async () => {
    const log: string[] = [];
    const progress: number[] = [];
    const result = await deleteInBatches(
      ids,
      async (batch) => {
        log.push(`start ${batch.join(',')}`);
        await Promise.resolve();
        log.push(`end ${batch.join(',')}`);
        return { deletedIds: batch };
      },
      (done) => progress.push(done),
    );
    expect(PROMPT_DELETE_BATCH).toBe(3);
    expect(log).toEqual([
      'start p1,p2,p3',
      'end p1,p2,p3',
      'start p4,p5,p6',
      'end p4,p5,p6',
      'start p7',
      'end p7',
    ]);
    expect(progress).toEqual([3, 6, 7]);
    expect(result).toEqual({ deletedIds: ids, keptIds: [], failed: false });
  });

  test('stops at a failed call: earlier batches stay deleted, the rest is kept', async () => {
    const asked: string[][] = [];
    const progress: number[] = [];
    const result = await deleteInBatches(
      ids,
      async (batch) => {
        asked.push(batch);
        return asked.length === 2
          ? { error: 'canceling statement due to statement timeout' }
          : { deletedIds: batch };
      },
      (done) => progress.push(done),
    );
    // The third batch is never asked for.
    expect(asked).toEqual([
      ['p1', 'p2', 'p3'],
      ['p4', 'p5', 'p6'],
    ]);
    expect(progress).toEqual([3]);
    expect(result).toEqual({
      deletedIds: ['p1', 'p2', 'p3'],
      keptIds: ['p4', 'p5', 'p6', 'p7'],
      failed: true,
    });
  });

  test('a call that throws counts as a failed call', async () => {
    const result = await deleteInBatches(ids, async () => {
      throw new Error('network');
    });
    expect(result).toEqual({ deletedIds: [], keptIds: ids, failed: true });
  });

  test('keeps prompts RLS left out and carries on', async () => {
    const result = await deleteInBatches(ids, async (batch) => ({
      deletedIds: batch.filter((id) => id !== 'p2'),
    }));
    expect(result).toEqual({
      deletedIds: ['p1', 'p3', 'p4', 'p5', 'p6', 'p7'],
      keptIds: ['p2'],
      failed: false,
    });
  });

  test('makes no call for an empty list', async () => {
    let calls = 0;
    const result = await deleteInBatches([], async () => {
      calls += 1;
      return { deletedIds: [] };
    });
    expect(calls).toBe(0);
    expect(result).toEqual({ deletedIds: [], keptIds: [], failed: false });
  });
});
