import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ShoppingChoices, ShoppingPath } from '@/lib/content/shoppingPath';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const getDraftShoppingPath = vi.fn();
const buildDraftShoppingPath = vi.fn();
const saveDraftShoppingPath = vi.fn();
const searchCatalogProducts = vi.fn();
vi.mock('@/lib/actions/shoppingPath', () => ({
  getDraftShoppingPath: (...args: unknown[]) => getDraftShoppingPath(...args),
  buildDraftShoppingPath: (...args: unknown[]) => buildDraftShoppingPath(...args),
  saveDraftShoppingPath: (...args: unknown[]) => saveDraftShoppingPath(...args),
  searchCatalogProducts: (...args: unknown[]) => searchCatalogProducts(...args),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ShoppingPathSection, priceText } = await import('./_ShoppingPath');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Brief › Shopping path (shopping path, part 3). */

const product = (
  id: string,
  title: string,
  extra: Partial<ShoppingPath['products'][number]> = {},
) => ({
  id,
  title,
  url: `https://shop.example/products/${id}`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 9,
  ...extra,
});

const PATH: ShoppingPath = {
  version: 1,
  builtAt: '2026-10-27T12:00:00.000Z',
  pageType: 'buying_guide',
  categories: [
    {
      name: 'Shoes > Hiking Boots',
      url: 'https://shop.example/collections/hiking-boots',
      title: 'Hiking boots',
    },
  ],
  products: [
    product('p1', 'Summit GTX Boot'),
    product('p2', 'Ridge Light Hiker', {
      price: 149,
      salePrice: 129,
      availability: 'limited_availability',
      issues: [{ code: 'missing_gtin', attribute: 'gtin' }],
    }),
  ],
  leftOut: [{ id: 'p3', title: 'Canyon Low WP', reason: 'sold_out' }],
  locked: [],
  removed: [],
  added: [],
};

let container: HTMLDivElement;
let root: Root;
// The path as saved: each save writes the choices and a new savedAt, as the action does.
let stored: ShoppingPath;
let saves: number;
const openUpgrade = vi.fn();

/** `isLocked`: a read-only workspace (plan not active). */
async function render(onPathChange?: () => void, isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ShoppingPathSection
            draftId="d1"
            brandId="b1"
            pageType="buying_guide"
            onPathChange={onPathChange}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );

beforeEach(() => {
  getDraftShoppingPath.mockReset().mockResolvedValue({ path: PATH });
  buildDraftShoppingPath.mockReset().mockResolvedValue({ path: PATH });
  stored = PATH;
  saves = 0;
  saveDraftShoppingPath
    .mockReset()
    .mockImplementation(async (_id: string, _read: unknown, choices: ShoppingChoices) => {
      saves += 1;
      stored = {
        ...stored,
        ...choices,
        products: stored.products.filter((p) => !choices.removed.includes(p.id)),
        savedAt: `2026-10-27T13:00:0${saves}.000Z`,
      };
      return { path: stored };
    });
  searchCatalogProducts.mockReset().mockResolvedValue([]);
  toast.error.mockReset();
  openUpgrade.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('priceText', () => {
  it('writes a price in its currency, the sale price first, and none without one', () => {
    expect(priceText({ price: 189, salePrice: null, currency: 'USD' })).toBe('$189.00');
    expect(priceText({ price: 149, salePrice: 129, currency: 'EUR' })).toBe('€129.00');
    expect(priceText({ price: null, salePrice: null, currency: 'USD' })).toBeNull();
    expect(priceText({ price: 10, salePrice: null, currency: 'XX1' })).toBe('10 XX1');
    // A price of 0 is none; a sale price is one only under the price, or alone.
    expect(priceText({ price: 0, salePrice: null, currency: 'USD' })).toBeNull();
    expect(priceText({ price: 149, salePrice: 0, currency: 'USD' })).toBe('$149.00');
    expect(priceText({ price: 149, salePrice: 149, currency: 'USD' })).toBe('$149.00');
    expect(priceText({ price: 149, salePrice: 159, currency: 'USD' })).toBe('$149.00');
    expect(priceText({ price: null, salePrice: 129, currency: 'USD' })).toBe('$129.00');
  });
});

describe('ShoppingPathSection', () => {
  it('shows the category page, the products with their stock, issues and place, and those left out', async () => {
    await render();
    expect(getDraftShoppingPath).toHaveBeenCalledWith('d1');
    const text = container.textContent ?? '';
    expect(text).toContain('Shoes > Hiking Boots');
    expect(text).toContain('/collections/hiking-boots');
    expect(text).toContain('In the intro, and again at the end');
    expect(text).toContain('2 products in the page');
    expect(text).toContain('Summit GTX Boot');
    expect(text).toContain('$189.00');
    expect(text).toContain('$129.00');
    expect(text).toContain('Low stock');
    expect(text).toContain('1 Merchant Center issue: gtin');
    expect(text).toContain('Top picks #1');
    expect(text).toContain('Top picks #2');
    expect(text).toContain('Canyon Low WP · not in stock');
  });

  it('picks from the catalog the first time, and says when a draft takes none', async () => {
    getDraftShoppingPath.mockResolvedValue({ path: null });
    await render();
    await act(async () => button('Pick from the catalog')!.click());
    expect(buildDraftShoppingPath).toHaveBeenCalledWith('d1', 'b1');
    expect(container.textContent).toContain('Summit GTX Boot');

    act(() => root.unmount());
    root = createRoot(container);
    buildDraftShoppingPath.mockResolvedValue({ path: null, reason: 'no_catalog' });
    await render();
    await act(async () => button('Pick from the catalog')!.click());
    expect(container.textContent).toContain("There's no catalog to pick from yet.");
  });

  it('locks a product, removes one, and swaps one for the next best', async () => {
    await render();
    const lock = () => button('Lock Summit GTX Boot')!;
    expect(lock().getAttribute('aria-pressed')).toBe('false');
    expect(lock().title).toBe('Lock Summit GTX Boot');
    await act(async () => lock().click());
    // The choices alone, over the path as read.
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      { builtAt: PATH.builtAt, savedAt: null },
      { locked: ['p1'], removed: [], added: [] },
    );
    // One name; its state pressed, and the tooltip says what a click does.
    expect(lock().getAttribute('aria-pressed')).toBe('true');
    expect(lock().title).toBe('Unlock Summit GTX Boot');

    await act(async () => button('Remove Ridge Light Hiker from the page')!.click());
    // Over the change just saved.
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      { builtAt: PATH.builtAt, savedAt: '2026-10-27T13:00:01.000Z' },
      { locked: ['p1'], removed: ['p2'], added: [] },
    );
    expect(container.textContent).not.toContain('Ridge Light Hiker');
    expect(buildDraftShoppingPath).not.toHaveBeenCalled();

    await act(async () => button('Swap Summit GTX Boot for another product')!.click());
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      { builtAt: PATH.builtAt, savedAt: '2026-10-27T13:00:02.000Z' },
      { locked: [], removed: ['p2', 'p1'], added: [] },
    );
    expect(buildDraftShoppingPath).toHaveBeenCalledWith('d1', 'b1');
  });

  it('tells the editor of each change saved or picked, and one made meanwhile; not of one that failed', async () => {
    const onPathChange = vi.fn();
    await render(onPathChange);
    expect(onPathChange).not.toHaveBeenCalled();
    await act(async () => button('Remove Ridge Light Hiker from the page')!.click());
    expect(onPathChange).toHaveBeenCalledTimes(1);
    await act(async () => button('Pick again')!.click());
    expect(onPathChange).toHaveBeenCalledTimes(2);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      saveDraftShoppingPath.mockRejectedValueOnce(new Error('denied'));
      await act(async () => button('Lock Summit GTX Boot')!.click());
      buildDraftShoppingPath.mockResolvedValueOnce({ error: 'failed' });
      await act(async () => button('Pick again')!.click());
      expect(onPathChange).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }

    saveDraftShoppingPath.mockResolvedValueOnce({ error: 'changed' });
    await act(async () => button('Lock Summit GTX Boot')!.click());
    expect(onPathChange).toHaveBeenCalledTimes(3);
  });

  it('puts a change back when it can’t be saved', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      saveDraftShoppingPath.mockRejectedValueOnce(new Error('denied'));
      await render();
      await act(async () => button('Remove Ridge Light Hiker from the page')!.click());
      expect(toast.error).toHaveBeenCalledWith("Couldn't save the change. Try again.");
      expect(container.textContent).toContain('Ridge Light Hiker');
    } finally {
      error.mockRestore();
    }
  });

  it('reads the path again when it changed since it was read, and saves nothing over it', async () => {
    saveDraftShoppingPath.mockResolvedValueOnce({ error: 'changed' });
    const now = { ...PATH, builtAt: '2026-10-27T12:30:00.000Z', products: [PATH.products[1]] };
    await render();
    getDraftShoppingPath.mockResolvedValue({ path: now });
    await act(async () => button('Lock Summit GTX Boot')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "The shopping path changed meanwhile. It's shown as it is now: make your change again.",
    );
    expect(getDraftShoppingPath).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Summit GTX Boot');
    expect(container.textContent).toContain('Ridge Light Hiker');
  });

  it('keeps a swap saved when the new pick fails, and says why', async () => {
    buildDraftShoppingPath.mockResolvedValueOnce({ error: 'rate_limited' });
    await render();
    await act(async () => button('Swap Summit GTX Boot for another product')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      'Too many picks in a short time. Try again in a few minutes.',
    );
    // The removal is saved, and shown: the next change is made over it.
    expect(container.textContent).not.toContain('Summit GTX Boot');
    await act(async () => button('Lock Ridge Light Hiker')!.click());
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      { builtAt: PATH.builtAt, savedAt: '2026-10-27T13:00:01.000Z' },
      { locked: ['p2'], removed: ['p1'], added: [] },
    );

    buildDraftShoppingPath.mockResolvedValueOnce({ error: 'failed' });
    await act(async () => button('Pick again')!.click());
    expect(toast.error).toHaveBeenLastCalledWith(
      "Couldn't pick from the catalog. Try again in a moment.",
    );
  });

  it('reads the path again when another pick changed it meanwhile', async () => {
    buildDraftShoppingPath.mockResolvedValueOnce({ error: 'changed' });
    await render();
    await act(async () => button('Pick again')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "The shopping path changed meanwhile. It's shown as it is now: make your change again.",
    );
    expect(getDraftShoppingPath).toHaveBeenCalledTimes(2);
  });

  it('adds a product found in the catalog, then picks again with it kept', async () => {
    vi.useFakeTimers();
    try {
      searchCatalogProducts.mockResolvedValue([
        { id: 'p9', title: 'Alpine Pro Leather', url: 'https://shop.example/products/p9' },
      ]);
      await render();
      await act(async () => button('Add product')!.click());
      const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'alpine');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(searchCatalogProducts).toHaveBeenCalledWith('b1', 'alpine');
      await act(async () => button('Add Alpine Pro Leather')!.click());
      expect(saveDraftShoppingPath).toHaveBeenCalledWith(
        'd1',
        { builtAt: PATH.builtAt, savedAt: null },
        { locked: [], removed: [], added: ['p9'] },
      );
      expect(buildDraftShoppingPath).toHaveBeenCalledWith('d1', 'b1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when the catalog can’t be searched', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      searchCatalogProducts.mockRejectedValue(new Error('boom'));
      await render();
      await act(async () => button('Add product')!.click());
      const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'alpine');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(container.textContent).toContain("Couldn't search the catalog. Try again.");
      expect(container.textContent).not.toContain('No product with that name.');
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it('says why products are left out, a reason added since in general words', async () => {
    getDraftShoppingPath.mockResolvedValue({
      path: {
        ...PATH,
        leftOut: [
          { id: 'p4', title: null, reason: 'gone' },
          { id: 'p4', title: 'Trail Mid', reason: 'recalled' },
        ],
      },
    });
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Untitled product · no longer in the catalog');
    expect(text).toContain("Trail Mid · can't be linked");
  });

  it('offers a new pick when nothing matched the topic, or the kept path can’t be read', async () => {
    getDraftShoppingPath.mockResolvedValue({ path: null });
    buildDraftShoppingPath.mockResolvedValue({ path: null, reason: 'no_match' });
    await render();
    await act(async () => button('Pick from the catalog')!.click());
    expect(container.textContent).toContain("Nothing in your catalog matches this page's topic.");
    expect(button('Pick from the catalog')).toBeDefined();

    act(() => root.unmount());
    root = createRoot(container);
    getDraftShoppingPath.mockResolvedValue({ path: null, unreadable: true });
    await render();
    expect(container.textContent).toContain("The saved shopping path can't be read.");
    expect(button('Pick from the catalog')).toBeDefined();
  });

  it("says so when the path can't be read, and reads it again", async () => {
    getDraftShoppingPath.mockResolvedValueOnce(null);
    await render();
    expect(container.textContent).toContain("Couldn't read the shopping path.");
    await act(async () => button('Try again')!.click());
    expect(getDraftShoppingPath).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Summit GTX Boot');
  });

  it('shows the path on a read-only workspace, and each change or pick opens the upgrade dialog', async () => {
    const onPathChange = vi.fn();
    await render(onPathChange, true);
    expect(container.textContent).toContain('Summit GTX Boot');
    const clicks = [
      'Lock Summit GTX Boot',
      'Swap Summit GTX Boot for another product',
      'Remove Ridge Light Hiker from the page',
      'Pick again',
      'Add product',
    ];
    for (const label of clicks) {
      await act(async () => button(label)!.click());
    }
    expect(openUpgrade).toHaveBeenCalledTimes(clicks.length);
    expect(openUpgrade).toHaveBeenCalledWith('Changing the shopping path needs a plan');
    expect(saveDraftShoppingPath).not.toHaveBeenCalled();
    expect(buildDraftShoppingPath).not.toHaveBeenCalled();
    expect(onPathChange).not.toHaveBeenCalled();
    // Nothing changed on the page, and Add product's search stays closed.
    expect(button('Lock Summit GTX Boot')!.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('Ridge Light Hiker');
    expect(container.querySelector('input[type="search"]')).toBeNull();

    // Nor is a first pick made.
    act(() => root.unmount());
    root = createRoot(container);
    getDraftShoppingPath.mockResolvedValue({ path: null });
    await render(undefined, true);
    await act(async () => button('Pick from the catalog')!.click());
    expect(openUpgrade).toHaveBeenCalledTimes(clicks.length + 1);
    expect(buildDraftShoppingPath).not.toHaveBeenCalled();
  });
});
