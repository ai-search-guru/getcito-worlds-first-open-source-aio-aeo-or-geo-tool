import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readAutoHandOff = vi.fn();
vi.mock('@/lib/content/agentRunsClient', () => ({
  readAutoHandOff: (...args: unknown[]) => readAutoHandOff(...args),
}));

const { useAutoHandOff } = await import('./_useAutoHandOff');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Quality's automatic hand-off (CE-051): once a draft its brand hands off,
 * when Quality is read and nothing holds Hand off; never again once the
 * draft had it, or when that can't be read.
 */

let container: HTMLDivElement;
let root: Root;
const run = vi.fn(async () => {});

function Probe({ due = true, ready = false, count = 3 }) {
  useAutoHandOff({ draftId: 'd1', brandId: 'b1', due, ready, count, run });
  return null;
}
const render = (props: { due?: boolean; ready?: boolean; count?: number } = {}) =>
  act(async () => root.render(<Probe {...props} />));

beforeEach(() => {
  readAutoHandOff.mockReset().mockResolvedValue(false);
  run.mockClear();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
});

describe('useAutoHandOff', () => {
  it('hands off once, as soon as Quality is read and nothing holds it', async () => {
    await render();
    expect(readAutoHandOff).toHaveBeenCalledWith('d1', 'b1');
    // Not ready yet (the reads, an open suggestion, the budget): it waits.
    expect(run).not.toHaveBeenCalled();
    await render({ ready: true });
    expect(run).toHaveBeenCalledTimes(1);
    await render({ ready: false });
    await render({ ready: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never runs on a draft that had it, when that can’t be read, or one the brand doesn’t hand off', async () => {
    readAutoHandOff.mockResolvedValue(true);
    await render({ ready: true });
    readAutoHandOff.mockResolvedValue(null);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ready: true });
    expect(run).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    readAutoHandOff.mockClear();
    await render({ due: false, ready: true });
    expect(readAutoHandOff).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('waits for the read of whether it had it when Quality is ready first', async () => {
    let read: (value: boolean) => void = () => {};
    readAutoHandOff.mockReturnValue(new Promise((resolve) => (read = resolve)));
    await render({ ready: true });
    expect(run).not.toHaveBeenCalled();
    await act(async () => read(false));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs none this session when there is nothing to fix the first time it may', async () => {
    await render({ ready: true, count: 0 });
    await render({ ready: true, count: 2 });
    expect(run).not.toHaveBeenCalled();
  });
});
