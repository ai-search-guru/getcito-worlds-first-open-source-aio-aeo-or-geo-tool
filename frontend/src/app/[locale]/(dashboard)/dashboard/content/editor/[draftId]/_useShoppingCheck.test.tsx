import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShoppingCheck } from '@/lib/content/shoppingCheck';

const getShoppingCheck = vi.fn();
vi.mock('@/lib/actions/shoppingPath', () => ({
  getShoppingCheck: (...args: unknown[]) => getShoppingCheck(...args),
}));

const { useShoppingCheck } = await import('./_useShoppingCheck');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The draft's shopping path against the catalog (shopping path, part 6):
 * read on a page that takes one, again on reload, the last read kept
 * meanwhile.
 */

const check = (title: string): ShoppingCheck => ({
  categories: [],
  products: [{ key: `shop.example/products/${title}`, title, state: 'ok', inPath: true }],
  site: null,
  merchantCenter: false,
});

let container: HTMLDivElement;
let root: Root;

function Probe(props: {
  draftId?: string;
  pageType?: string | null;
  siteType?: 'ecommerce' | 'b2b';
}) {
  const state = useShoppingCheck({
    draftId: props.draftId ?? 'd1',
    siteType: props.siteType ?? 'ecommerce',
    pageType: props.pageType === undefined ? 'buying_guide' : props.pageType,
  });
  return (
    <button
      type="button"
      data-check={JSON.stringify(state.check)}
      data-refreshing={String(state.refreshing)}
      onClick={state.reload}
    />
  );
}
const render = (props: Parameters<typeof Probe>[0] = {}) =>
  act(async () => root.render(<Probe {...props} />));
const probe = () => container.querySelector('button')!;
/** The hook's answer as the probe shows it; `reload` is its button. */
const read = {
  get check(): unknown {
    return JSON.parse(probe().dataset.check!);
  },
  get refreshing() {
    return probe().dataset.refreshing === 'true';
  },
  reload: () => probe().click(),
};

/** A read that lands when `resolve` is called. */
function pending() {
  let resolve!: (value: ShoppingCheck | null) => void;
  let reject!: (err: Error) => void;
  getShoppingCheck.mockImplementationOnce(
    () =>
      new Promise<ShoppingCheck | null>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    resolve: (value: ShoppingCheck | null) => act(async () => resolve(value)),
    reject: (err: Error) => act(async () => reject(err)),
  };
}

beforeEach(() => {
  getShoppingCheck.mockReset().mockResolvedValue(null);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('useShoppingCheck', () => {
  it("reads the draft's check, by the draft alone, 'reading' until it lands", async () => {
    const first = pending();
    await render();
    expect(read.check).toBe('reading');
    expect(read.refreshing).toBe(false);
    await first.resolve(check('Summit'));
    expect(read.check).toEqual(check('Summit'));
    expect(getShoppingCheck).toHaveBeenCalledWith('d1');
  });

  it('keeps the last read while it reads again, then shows the new one', async () => {
    getShoppingCheck.mockResolvedValueOnce(check('Summit'));
    await render();
    const again = pending();
    await act(async () => read.reload());
    expect(read.check).toEqual(check('Summit'));
    expect(read.refreshing).toBe(true);
    await again.resolve(check('Ridge'));
    expect(read.check).toEqual(check('Ridge'));
    expect(read.refreshing).toBe(false);

    // None kept as none: a draft without a path never shows 'reading' again.
    getShoppingCheck.mockResolvedValueOnce(null);
    await act(async () => read.reload());
    expect(read.check).toBeNull();
    const next = pending();
    await act(async () => read.reload());
    expect(read.check).toBeNull();
    expect(read.refreshing).toBe(true);
    await next.resolve(null);
    expect(read.refreshing).toBe(false);
  });

  it("says 'failed' when it can't be read, and reads again on reload", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = pending();
      await render();
      await first.reject(new Error('catalog down'));
      expect(read.check).toBe('failed');
      getShoppingCheck.mockResolvedValueOnce(check('Summit'));
      await act(async () => read.reload());
      expect(read.check).toEqual(check('Summit'));
    } finally {
      error.mockRestore();
    }
  });

  it("drops a read for another draft, and starts the new draft's from 'reading'", async () => {
    const old = pending();
    await render({ draftId: 'd1' });
    const now = pending();
    await render({ draftId: 'd2' });
    await old.resolve(check('Old'));
    expect(read.check).toBe('reading');
    await now.resolve(check('New'));
    expect(read.check).toEqual(check('New'));
    expect(getShoppingCheck.mock.calls).toEqual([['d1'], ['d2']]);
  });

  it('drops an earlier read that lands after a later one', async () => {
    const first = pending();
    await render();
    const second = pending();
    await act(async () => read.reload());
    await second.resolve(check('New'));
    await first.resolve(check('Old'));
    expect(read.check).toEqual(check('New'));
    expect(read.refreshing).toBe(false);
  });

  it('reads nothing on a page that takes no shopping path', async () => {
    await render({ siteType: 'b2b' });
    expect(read.check).toBeNull();
    await render({ pageType: 'product_page' });
    expect(read.check).toBeNull();
    await render({ pageType: null });
    expect(read.check).toBeNull();
    expect(getShoppingCheck).not.toHaveBeenCalled();
  });
});
