import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const eq = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: (...args) => rpc(...args),
    from: () => ({ delete: () => ({ eq: (...args) => eq(...args) }) }),
  },
}));

const { RESULT_BATCH, deleteBrand, drainInBatches } = await import('./brandDelete.js');

describe('drainInBatches', () => {
  it('keeps deleting until a batch comes back empty', async () => {
    const batches = [5, 5, 2, 0];
    const deleteBatch = vi.fn(async () => batches.shift());
    expect(await drainInBatches(deleteBatch)).toBe(12);
    expect(deleteBatch).toHaveBeenCalledTimes(4);
  });
});

describe('deleteBrand', () => {
  it('deletes the answers in batches, then the brand row', async () => {
    const left = [RESULT_BATCH, 10, 0];
    rpc.mockImplementation(async () => ({ data: left.shift(), error: null }));
    eq.mockResolvedValue({ error: null });

    await deleteBrand('b1');

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('delete_brand_results_batch', {
      p_brand_id: 'b1',
      p_limit: RESULT_BATCH,
    });
    expect(eq).toHaveBeenCalledWith('id', 'b1');
  });

  it('runs one delete per brand however often it is asked', async () => {
    rpc.mockReset();
    let release;
    rpc.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ data: 0, error: null }))),
    );
    eq.mockResolvedValue({ error: null });

    const first = deleteBrand('b2');
    const second = deleteBrand('b2');
    expect(second).toBe(first);
    release();
    await first;
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('leaves the brand row alone when a batch fails', async () => {
    rpc.mockReset();
    eq.mockReset();
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    await expect(deleteBrand('b3')).rejects.toThrow('timeout');
    expect(eq).not.toHaveBeenCalled();
  });
});
