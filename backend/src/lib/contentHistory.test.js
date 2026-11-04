import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../config/supabase.js', () => ({ default: { rpc: (...a) => rpc(...a) } }));
const warn = vi.fn();
vi.mock('./logger.js', () => ({ logger: { warn: (...a) => warn(...a) } }));

const { pruneContentVersions, MAX_VERSION_PRUNE_CALLS, VERSION_PRUNE_BATCH } =
  await import('./contentHistory.js');

const NOW = Date.parse('2026-10-21T10:00:00.000Z');

beforeEach(() => {
  rpc.mockReset();
  warn.mockReset();
});

describe('pruneContentVersions', () => {
  it('deletes versions older than 90 days in batches until a call deletes fewer', async () => {
    rpc
      .mockResolvedValueOnce({ data: VERSION_PRUNE_BATCH, error: null })
      .mockResolvedValueOnce({ data: 12, error: null });
    await pruneContentVersions(NOW);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('content_draft_versions_prune', {
      p_before: '2026-07-23T10:00:00.000Z',
      p_limit: VERSION_PRUNE_BATCH,
    });
  });

  it('stops after its call budget, and on an error', async () => {
    rpc.mockResolvedValue({ data: VERSION_PRUNE_BATCH, error: null });
    await pruneContentVersions(NOW);
    expect(rpc).toHaveBeenCalledTimes(MAX_VERSION_PRUNE_CALLS);
    expect(warn).toHaveBeenCalledWith(
      { calls: MAX_VERSION_PRUNE_CALLS },
      '[content-history] prune stopped early; the rest goes tomorrow',
    );

    rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await pruneContentVersions(NOW);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
