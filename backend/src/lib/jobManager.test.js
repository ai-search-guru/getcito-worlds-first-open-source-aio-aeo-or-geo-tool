import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cancelling a waiting job, or one just claimed (2026-10-27): only while it
 * is still in that state, with why it was cancelled kept on the row.
 */

const updates = [];
let answer;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const update = { table, filters: [] };
      const chain = {
        update: (patch) => {
          update.patch = patch;
          updates.push(update);
          return chain;
        },
        eq: (column, value) => {
          update.filters.push([column, value]);
          return chain;
        },
        select: () => chain,
        then: (resolve, reject) => Promise.resolve(answer).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { cancelClaimedJob, cancelWaitingJob } = await import('./jobManager.js');

beforeEach(() => {
  updates.length = 0;
  answer = { data: [{ id: 'j1' }], error: null };
});

describe('cancelWaitingJob', () => {
  it('cancels a job only while it still waits, and keeps why', async () => {
    expect(await cancelWaitingJob('j1', 'subscription_inactive')).toBe(true);
    expect(updates).toEqual([
      {
        table: 'jobs',
        patch: expect.objectContaining({
          status: 'cancelled',
          failed_reason: 'subscription_inactive',
        }),
        filters: [
          ['id', 'j1'],
          ['status', 'waiting'],
        ],
      },
    ]);
  });

  it('says so when the job had already started or ended', async () => {
    answer = { data: [], error: null };
    expect(await cancelWaitingJob('j1', 'subscription_inactive')).toBe(false);
  });

  it('says it did not cancel when the write fails', async () => {
    answer = { data: null, error: { message: 'timeout' } };
    expect(await cancelWaitingJob('j1', 'subscription_inactive')).toBe(false);
  });
});

describe('cancelClaimedJob', () => {
  it('cancels a job this process has just claimed, and keeps why', async () => {
    expect(await cancelClaimedJob('j1', 'subscription_inactive')).toBe(true);
    expect(updates).toEqual([
      {
        table: 'jobs',
        patch: expect.objectContaining({
          status: 'cancelled',
          failed_reason: 'subscription_inactive',
        }),
        filters: [
          ['id', 'j1'],
          ['status', 'active'],
        ],
      },
    ]);
  });

  it('says so when the job was cancelled meanwhile, or the write fails', async () => {
    answer = { data: [], error: null };
    expect(await cancelClaimedJob('j1', 'subscription_inactive')).toBe(false);
    answer = { data: null, error: { message: 'timeout' } };
    expect(await cancelClaimedJob('j1', 'subscription_inactive')).toBe(false);
  });
});
