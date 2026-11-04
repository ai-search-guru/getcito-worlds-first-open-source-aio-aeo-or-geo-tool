import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ShoppingProductDetail } from '@/lib/actions/shopping';

/** A product's page (ECOM-011). */

const getShoppingProductDetail = vi.hoisted(() => vi.fn());
const getProductAiSays = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/actions/shopping', () => ({ getShoppingProductDetail, getProductAiSays }));
// The query the page opens with: the Shelf's "Why not you?" names a shelf.
const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ productId: 'p1' }),
  useSearchParams: () => new URLSearchParams(query.value),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (s: { activeBrandId: string }) => unknown) =>
    select({ activeBrandId: 'b1' }),
}));
vi.mock('@/hooks/useFeatureGate', () => ({
  useFeatureGate: () => ({ canUse: () => gate.allowed }),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: ShoppingProductPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gate.allowed = true;
  getShoppingProductDetail.mockReset();
  getProductAiSays.mockReset().mockResolvedValue({ answers: 0, quotes: [], sources: [] });
  query.value = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ShoppingProductPage />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

const line = {
  promptId: 'q1',
  promptText: 'lightweight 30L hiking backpack for women',
  platform: 'chatgpt-shopping',
  rank: null,
  winner: {
    title: 'Summit Daypack 30 W',
    price: 110,
    currency: 'USD',
    rating: 4.8,
    reviews: 2140,
    merchant: 'summitgear.example',
    image: null,
  },
  score: 41,
  winnerScore: 88,
  missing: ['women', 'lightweight'],
};
const detail: ShoppingProductDetail = {
  product: {
    id: 'p1',
    title: 'Ridge 30L Backpack',
    url: 'https://northwind.example/products/ridge-30',
    productType: 'Backpacks',
    brand: 'Northwind',
    description: null,
    image: null,
    category: 'Bags > Hiking backpacks',
    price: 119,
    currency: 'USD',
    inStock: true,
    hasGtin: false,
  },
  readiness: { score: 48, missing: ['gtin', 'description'], unknown: [] },
  shelves: [
    line,
    {
      ...line,
      promptId: 'q2',
      promptText: 'durable daypack',
      rank: 1,
      winner: null,
      winnerScore: null,
      score: 60,
      missing: [],
    },
  ],
  focus: line,
  comparison: [
    {
      key: 'score',
      you: '41',
      winner: '88',
      state: 'missing',
      note: { key: 'missingWords', values: { words: 'women, lightweight' } },
    },
    { key: 'price', you: '$119', winner: '$110', state: 'match', note: { key: 'close' } },
    { key: 'gtin', you: null, winner: null, state: 'missing' },
  ],
  ai: { visits: 4, orders: 0, revenue: null, currency: null },
  result: null,
};

describe('ShoppingProductPage', () => {
  it('shows the product, where it shows, and why AI picked another one', async () => {
    getShoppingProductDetail.mockResolvedValue(detail);
    const text = await render();
    expect(getShoppingProductDetail).toHaveBeenCalledWith('b1', 'p1', { datePreset: '30d' }, null);
    expect(text).toContain('Ridge 30L Backpack');
    expect(text).toContain('$119 · Hiking backpacks · On 1 of 2 shelves · Readiness 48');
    expect(text).toContain(
      '“lightweight 30L hiking backpack for women” · ChatGPT Shopping picked Summit Daypack 30 W',
    );
    const rows = [...container.querySelectorAll('table')[0].querySelectorAll('tbody tr')].map(
      (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    // Each row's state in words too, beside its icon.
    expect(rows).toEqual([
      ['Match with the question, missing', '41', '88', 'Missing: women, lightweight'],
      ['Price, in place', '$119', '$110', 'Close'],
      ['GTIN in the feed, missing', '✕', '—', ''],
    ]);
    expect(
      [...container.querySelectorAll('table')[0].querySelectorAll('.sr-only')].map(
        (span) => span.textContent,
      ),
    ).toEqual([', missing', ', in place', ', missing']);
    expect(text).toContain('Not on the shelf');
    expect(text).toContain('Missing: a GTIN (−20)');
    expect(container.querySelector('a[href="/dashboard/shopping?tab=products"]')).not.toBeNull();
    // Actions to get on the shelf, from what it misses beside the winner (ECOM-013).
    expect(text).toContain('Actions to get on the shelf');
    expect(text).toContain('Send 4 actions to Action Center');
  });

  it('asks for the shelf the Shelf’s "Why not you?" opened it on', async () => {
    query.value = 'prompt=q9&platform=gemini-web';
    getShoppingProductDetail.mockResolvedValue(detail);
    await render();
    expect(getShoppingProductDetail).toHaveBeenCalledWith(
      'b1',
      'p1',
      { datePreset: '30d' },
      { promptId: 'q9', platform: 'gemini-web' },
    );
  });

  const result = {
    actionId: 'a7',
    actionNo: 7,
    completedAt: '2026-10-12T09:00:00Z',
    readyAt: '2026-10-19T09:00:00Z',
    before: { shelves: 3, on: 0 },
    after: { shelves: 4, on: 2 },
  };

  it('shows what its last done action did, 7 days on', async () => {
    getShoppingProductDetail.mockResolvedValue({ ...detail, result });
    const text = await render();
    expect(text).toContain('After action #7');
    expect(text).toContain('On more of its shelves');
    expect(text).toContain(
      'In the 7 days after it was done, on 2 of 4 shelves. In the 7 days before, on 0 of 3.',
    );
    expect(
      container.querySelector('a[href="/dashboard/action-center/actions?action=a7"]')?.textContent,
    ).toBe('Open the action');
  });

  it('says new, not better, when none of its shelves was read the week before', async () => {
    getShoppingProductDetail.mockResolvedValue({
      ...detail,
      result: { ...result, before: { shelves: 0, on: 0 } },
    });
    const text = await render();
    expect(text).toContain('New: nothing to compare');
    expect(text).not.toContain('On more of its shelves');
    expect(text).toContain(
      'In the 7 days after it was done, on 2 of 4 shelves. None of its shelves was read in the 7 days before.',
    );
  });

  it('says when a done action’s result shows', async () => {
    getShoppingProductDetail.mockResolvedValue({ ...detail, result: { ...result, after: null } });
    const text = await render();
    expect(text).toContain('Done Oct 12, 2026. Its result shows on Oct 19, 2026, 7 days on.');
    expect(text).not.toContain('On more of its shelves');
  });

  it('quotes what AI says about it, with the sources the answers cited (ECOM-012)', async () => {
    getShoppingProductDetail.mockResolvedValue(detail);
    getProductAiSays.mockResolvedValue({
      answers: 3,
      quotes: [
        {
          text: 'The Ridge 30L Backpack is tougher, with a lifetime warranty.',
          platform: 'chatgpt-shopping',
          at: '2026-10-27T08:00:00Z',
          promptText: 'best 30L hiking backpack',
        },
      ],
      sources: [
        {
          url: 'https://outdoorgear.example/best',
          domain: 'outdoorgear.example',
          title: 'Best packs',
          answers: 2,
        },
      ],
    });
    const text = await render();
    expect(getProductAiSays).toHaveBeenCalledWith('b1', 'p1', { datePreset: '30d' });
    expect(text).toContain('What AI says');
    expect(text).toContain("the last 30 days' 3 answers that showed it");
    expect(text).toContain('The Ridge 30L Backpack is tougher, with a lifetime warranty.');
    expect(text).toContain('ChatGPT Shopping · “best 30L hiking backpack” · Oct 27, 2026');
    expect(container.querySelector('a[href="https://outdoorgear.example/best"]')?.textContent).toBe(
      'Best packs',
    );
    expect(text).toContain('2 answers');
  });

  it('says when no answer showed it', async () => {
    getShoppingProductDetail.mockResolvedValue(detail);
    expect(await render()).toContain('No answer showed it in the last 30 days.');
  });

  it('keeps the page when what AI says could not be read', async () => {
    getShoppingProductDetail.mockResolvedValue(detail);
    getProductAiSays.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = await render();
    expect(text).toContain('Ridge 30L Backpack');
    expect(text).toContain("Couldn't read what AI says right now.");
  });

  it('says when the product is gone, or locked', async () => {
    getShoppingProductDetail.mockResolvedValue(null);
    expect(await render()).toContain("This product isn't in your catalog anymore.");
    gate.allowed = false;
    expect(await render()).toContain('Product Visibility comes with the Growth plan.');
  });

  it('reads nothing while the plan locks the page', async () => {
    gate.allowed = false;
    expect(await render()).toContain('Product Visibility comes with the Growth plan.');
    expect(getShoppingProductDetail).not.toHaveBeenCalled();
    expect(getProductAiSays).not.toHaveBeenCalled();
  });
});
