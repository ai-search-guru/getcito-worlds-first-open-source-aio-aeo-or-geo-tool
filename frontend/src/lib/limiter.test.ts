import { describe, expect, it } from 'vitest';
import { createLimiter } from './limiter';

/** createLimiter: at most `max` tasks at once, in the order they came. */

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createLimiter', () => {
  it('runs at most three at once, in order, and starts the next as one ends', async () => {
    const run = createLimiter(3);
    let running = 0;
    let most = 0;
    const started: number[] = [];
    const ends: (() => void)[] = [];
    const results = Array.from({ length: 7 }, (_, i) =>
      run(async () => {
        started.push(i);
        most = Math.max(most, ++running);
        await new Promise<void>((resolve) => ends.push(resolve));
        running--;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1, 2]);
    ends[1]();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    // A task arriving now waits behind those already waiting.
    const late = run(async () => {
      started.push(99);
      return 99;
    });
    for (let i = 0; i < 20 && started.length < 9; i++) {
      ends.forEach((end) => end());
      await tick();
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(await late).toBe(99);
    expect(started.indexOf(99)).toBe(7);
    expect(most).toBe(3);
  });

  it("frees a failed task's place", async () => {
    const run = createLimiter(1);
    await expect(run(async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(
      run(() => {
        throw new Error('at once');
      }),
    ).rejects.toThrow('at once');
    expect(await run(async () => 'next')).toBe('next');
  });
});
