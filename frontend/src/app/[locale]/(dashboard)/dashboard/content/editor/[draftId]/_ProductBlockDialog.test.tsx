import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { BlockProductRead } from '@/lib/actions/shoppingPath';

const searchProductsForBlock = vi.fn();
const getProductsForBlock = vi.fn();
vi.mock('@/lib/actions/shoppingPath', () => ({
  searchProductsForBlock: (...args: unknown[]) => searchProductsForBlock(...args),
  getProductsForBlock: (...args: unknown[]) => getProductsForBlock(...args),
  searchCatalogProducts: vi.fn(),
  getDraftShoppingPath: vi.fn(),
  buildDraftShoppingPath: vi.fn(),
  saveDraftShoppingPath: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ProductBlockDialog } = await import('./_ProductBlockDialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** + Insert › Products (shopping path, part 5). */

const boot = (n: number, over: Partial<BlockProductRead> = {}): BlockProductRead => ({
  id: `p${n}`,
  title: `Boot ${n}`,
  url: `https://shop.example/products/p${n}`,
  image: null,
  price: 100 + n,
  salePrice: null,
  currency: 'USD',
  inStock: true,
  ...over,
});
const HITS = [1, 2, 3, 4, 5].map((n) => boot(n));

let container: HTMLElement;
let root: Root;
const onInsert = vi.fn();
const onClose = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ProductBlockDialog brandId="b1" onInsert={onInsert} onClose={onClose} />
      </NextIntlClientProvider>,
    );
  });
}
// The dialog portals to the body. A hit's button reads its name, then its price or why it can't go in.
const buttons = () => [...document.body.querySelectorAll('button')];
const button = (label: string) =>
  buttons().find((b) => b.textContent === label || b.getAttribute('aria-label') === label);
const hit = (title: string) =>
  buttons().find(
    (b) => b.getAttribute('aria-pressed') !== null && b.textContent?.startsWith(title),
  );
async function search(text: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}
const counter = () => document.body.querySelector('[aria-live="polite"]')!.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  searchProductsForBlock.mockReset().mockResolvedValue(HITS);
  getProductsForBlock
    .mockReset()
    .mockResolvedValue([boot(1, { image: 'https://cdn.example/p1.jpg', price: 189 }), boot(2)]);
  onInsert.mockReset();
  onClose.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('ProductBlockDialog', () => {
  it('finds products by name, picks up to four, and inserts them as a block', async () => {
    await render();
    await search('boot');
    expect(searchProductsForBlock).toHaveBeenCalledWith('b1', 'boot');
    // Each hit with its price.
    expect(hit('Boot 1')!.textContent).toBe('Boot 1$101.00');
    for (const n of [1, 2, 3, 4]) await act(async () => hit(`Boot ${n}`)!.click());
    // A fifth can't be picked.
    expect(hit('Boot 5')!.disabled).toBe(true);
    expect(counter()).toBe('4 of 4 picked');
    await act(async () => hit('Boot 4')!.click());
    await act(async () => hit('Boot 3')!.click());
    expect(counter()).toBe('2 of 4 picked');

    await act(async () => button('Insert')!.click());
    expect(getProductsForBlock).toHaveBeenCalledWith('b1', ['p1', 'p2']);
    const code = onInsert.mock.calls[0][0] as string;
    expect(code).toContain('href="https://shop.example/products/p1"');
    expect(code).toContain('$189.00');
    expect(code).toContain('Boot 2');
    expect(toast.warning).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('marks a sold-out product, and one with no page, and lets neither be picked', async () => {
    searchProductsForBlock.mockResolvedValue([
      boot(1, { inStock: false, price: null }),
      boot(2, { url: null }),
      boot(3, { url: 'http://shop.example/products/p3' }),
      boot(4),
    ]);
    await render();
    await search('boot');
    expect(hit('Boot 1')!.textContent).toBe('Boot 1Not in stock');
    expect(hit('Boot 1')!.disabled).toBe(true);
    expect(hit('Boot 2')!.textContent).toBe('Boot 2No page to link');
    expect(hit('Boot 2')!.disabled).toBe(true);
    expect(hit('Boot 3')!.disabled).toBe(true);
    expect(hit('Boot 4')!.disabled).toBe(false);
  });

  it('keeps the picked ones listed through a new search, each to unpick', async () => {
    await render();
    await search('boot');
    await act(async () => hit('Boot 1')!.click());
    searchProductsForBlock.mockResolvedValue([boot(7)]);
    await search('trail');
    expect(hit('Boot 1')).toBeUndefined();
    expect(counter()).toBe('1 of 4 picked');
    await act(async () => button('Remove Boot 1')!.click());
    expect(counter()).toBe('0 of 4 picked');
    expect(button('Insert')!.disabled).toBe(true);
  });

  it('leaves out one sold out since it was picked, and says so', async () => {
    getProductsForBlock.mockResolvedValue([boot(1), boot(2, { inStock: false, price: null })]);
    await render();
    await search('boot');
    for (const n of [1, 2, 3]) await act(async () => hit(`Boot ${n}`)!.click());
    await act(async () => button('Insert')!.click());
    // Boot 3 is gone from the catalog.
    expect(toast.warning).toHaveBeenCalledWith('Left out, not in stock now: Boot 2, Boot 3');
    const code = onInsert.mock.calls[0][0] as string;
    expect(code).toContain('Boot 1');
    expect(code).not.toContain('Boot 2');
    expect(onClose).toHaveBeenCalled();
  });

  it('inserts nothing when all are sold out now, and unpicks them', async () => {
    getProductsForBlock.mockResolvedValue([boot(1, { inStock: false, price: null })]);
    await render();
    await search('boot');
    await act(async () => hit('Boot 1')!.click());
    await act(async () => button('Insert')!.click());
    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith('Left out, not in stock now: Boot 1');
    expect(toast.error).not.toHaveBeenCalled();
    expect(counter()).toBe('0 of 4 picked');
  });

  it("says so when no product picked has a page, or the products can't be read", async () => {
    getProductsForBlock.mockResolvedValueOnce([boot(1, { url: null })]);
    await render();
    await search('boot');
    await act(async () => hit('Boot 1')!.click());
    await act(async () => button('Insert')!.click());
    expect(onInsert).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('These products have no page to link.');

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      getProductsForBlock.mockRejectedValueOnce(new Error('down'));
      await act(async () => button('Insert')!.click());
      expect(toast.error).toHaveBeenLastCalledWith("Couldn't read the products. Try again.");
    } finally {
      error.mockRestore();
    }
  });

  it('shows Inserting… while the products are read, and inserts nothing once cancelled', async () => {
    let answer!: (read: BlockProductRead[]) => void;
    getProductsForBlock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    await search('boot');
    await act(async () => hit('Boot 1')!.click());
    await act(async () => button('Insert')!.click());
    const insert = button('Inserting…')!;
    expect(insert.disabled).toBe(true);
    expect(insert.getAttribute('aria-busy')).toBe('true');
    await act(async () => button('Cancel')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => answer([boot(1)]));
    expect(onInsert).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('says a failed search as such, not as no product found', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      searchProductsForBlock.mockRejectedValue(new Error('down'));
      await render();
      await search('boot');
      expect(document.body.querySelector('[role="alert"]')!.textContent).toBe(
        "Couldn't search the catalog. Try again.",
      );
      expect(document.body.textContent).not.toContain('No product with that name.');
    } finally {
      error.mockRestore();
    }
  });
});
