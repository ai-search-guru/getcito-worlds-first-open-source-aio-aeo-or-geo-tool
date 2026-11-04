import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('./logger.js', () => ({ default: logger, logger }));
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { checkPromptUsageCounters } = await import('./promptUsageCounters.js');

const client = (result) => ({ rpc: vi.fn(async () => result) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkPromptUsageCounters', () => {
  it('logs and returns the brands whose counters drifted', async () => {
    const row = {
      brand_id: 'b1',
      stored_active: 3,
      stored_paused: 0,
      stored_locations: 3,
      actual_active: 4,
      actual_paused: 0,
      actual_locations: 5,
    };
    const db = client({ data: [row], error: null });

    await expect(checkPromptUsageCounters(db)).resolves.toEqual([row]);
    expect(db.rpc).toHaveBeenCalledWith('repair_prompt_usage_counters');
    expect(logger.warn).toHaveBeenCalledWith(
      { drifted: 1, rows: [row] },
      expect.stringContaining('drifted'),
    );
  });

  it('says so when every counter matches', async () => {
    await expect(checkPromptUsageCounters(client({ data: [], error: null }))).resolves.toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('match'));
  });

  it('fails loudly when the check itself fails', async () => {
    await expect(
      checkPromptUsageCounters(client({ data: null, error: { message: 'timeout' } })),
    ).rejects.toThrow('timeout');
  });
});
