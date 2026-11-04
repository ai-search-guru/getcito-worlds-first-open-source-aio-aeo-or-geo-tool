import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandFactsRead } from '@/lib/content/brandFacts';

const getBrandFacts = vi.fn();
vi.mock('@/lib/actions/brandFacts', () => ({
  getBrandFacts: (...args: unknown[]) => getBrandFacts(...args),
}));

const { useBrandFacts } = await import('./_useBrandFacts');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The brand's facts in the editor (Quality CE-047): read with phase 2, again
 * when the tab comes back (from Brand settings, where they're approved).
 */

const READ: BrandFactsRead = {
  facts: [],
  pages: [],
  checkedAt: null,
  recheckAt: null,
  paused: false,
  noDomain: false,
};
let container: HTMLDivElement;
let root: Root;

function Probe({ enabled = true }: { enabled?: boolean }) {
  const state = useBrandFacts('b1', enabled);
  return <pre>{state.status}</pre>;
}
const render = (enabled = true) => act(async () => root.render(<Probe enabled={enabled} />));
const status = () => container.querySelector('pre')!.textContent;

beforeEach(() => {
  getBrandFacts.mockReset().mockResolvedValue(READ);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('useBrandFacts', () => {
  it('reads once, and again when the tab comes back', async () => {
    await render();
    expect(status()).toBe('ready');
    expect(getBrandFacts).toHaveBeenCalledTimes(1);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(getBrandFacts).toHaveBeenCalledTimes(2);
  });

  it('keeps a read when a later one fails, says off when the API has them off, and reads nothing before phase 2', async () => {
    await render();
    getBrandFacts.mockResolvedValueOnce({ error: 'failed' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(status()).toBe('ready');
    getBrandFacts.mockResolvedValueOnce({ error: 'off' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(status()).toBe('off');

    act(() => root.unmount());
    root = createRoot(container);
    getBrandFacts.mockClear();
    await render(false);
    expect(status()).toBe('off');
    expect(getBrandFacts).not.toHaveBeenCalled();
  });

  it('fails, not loads for ever, when the action throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getBrandFacts.mockRejectedValueOnce(new Error('deploy skew'));
    await render();
    expect(status()).toBe('failed');
    error.mockRestore();
  });
});
