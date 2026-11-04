import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { ShoppingAiOrders, ShoppingShelf } from '@/lib/actions/shopping';
import { buildShelf, shelfStats, type ShelfCardRow } from '@/lib/shopping/shelf';

/** The Shelf's numbers and rows (ECOM-006). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ShelfFailed, ShelfKpis, ShelfRows } = await import('./_shelf');
const { priceText } = await import('@/lib/shopping/price');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

const card = (over: Partial<ShelfCardRow>): ShelfCardRow => ({
  prompt_result_id: 'r1',
  position: 0,
  created_at: new Date().toISOString(),
  platform: 'chatgpt-shopping',
  product_title: 'Summit Daypack 30 W',
  price_amount: 110,
  price_currency: 'USD',
  image_url: null,
  merchant_domain: 'summitgear.example',
  rating: 4.8,
  review_count: 2140,
  matched_brand_role: 'competitor',
  merchant_kind: 'reseller',
  marketplace: null,
  catalog_product_id: null,
  prompt_id: 'p1',
  prompt_text: 'lightweight 30L hiking backpack for women',
  ...over,
});

const cards = [
  card({}),
  card({ position: 1, product_title: 'TrailCo Lite 28', price_amount: 95 }),
  card({
    prompt_id: 'p2',
    prompt_text: 'best waterproof trail running shoes under $150',
    prompt_result_id: 'r2',
    product_title: 'Summit Peak GTX',
    price_amount: 139,
  }),
  card({
    prompt_id: 'p2',
    prompt_text: 'best waterproof trail running shoes under $150',
    prompt_result_id: 'r2',
    position: 1,
    product_title: 'Trail Runner X',
    price_amount: 129,
    matched_brand_role: 'own',
    merchant_kind: 'marketplace',
    marketplace: 'amazon',
    catalog_product_id: 'cp1',
  }),
];
const shelf: ShoppingShelf = {
  rows: buildShelf(cards),
  stats: shelfStats(cards),
  catalogProducts: 320,
};
const orders: ShoppingAiOrders = {
  orders: 152,
  previousOrders: 120,
  revenue: { value: 24_900, currency: 'USD' },
  previousRevenue: 19_000,
  channels: [
    { source: 'chatgpt.com', orders: 108 },
    { source: 'copilot.microsoft.com', orders: 44 },
  ],
};

describe('ShelfKpis', () => {
  it("shows the brand's shelf share, its products of the catalog's, AI revenue and the top channel", () => {
    const text = render(<ShelfKpis shelf={shelf} orders={orders} salesConnected />);
    expect(text).toContain('AI shelf share25%');
    expect(text).toContain('1 of 320');
    expect(text).toContain('$24.9k+31%');
    expect(text).toContain('152 orders from AI visits');
    expect(text).toContain('ChatGPT71% of AI orders');
  });

  it("waits for the brand's orders before its revenue and top channel, and shows a cut value whole on hover", () => {
    const text = render(<ShelfKpis shelf={shelf} orders={undefined} salesConnected />);
    expect(text).toContain('AI shelf share25%');
    // Not "No orders" while they're read, nor another brand's revenue.
    expect(text).not.toContain('No orders from AI visits yet');
    expect(text).not.toContain('$24.9k');
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    render(<ShelfKpis shelf={shelf} orders={orders} salesConnected />);
    expect(container.querySelector('span[title="$24.9k"]')?.textContent).toBe('$24.9k');
  });

  it('asks to connect sales without orders or a source, and names the channel showing the products', () => {
    const none = { ...orders, orders: 0, revenue: null, previousRevenue: null, channels: [] };
    const text = render(<ShelfKpis shelf={shelf} orders={none} salesConnected={false} />);
    expect(container.querySelector('a[href="/dashboard/traffic"]')?.textContent).toBe(
      'Connect to see sales',
    );
    expect(text).toContain('100% of your products on the shelf');
    expect(render(<ShelfKpis shelf={shelf} orders={none} salesConnected />)).toContain(
      'No orders from AI visits yet',
    );
  });
});

describe('ShelfRows', () => {
  it("lists the shelves the brand isn't on first, its products ringed with where they're sold", () => {
    const text = render(
      <ShelfRows
        shelf={shelf}
        platforms={['chatgpt-shopping']}
        platform="all"
        onPlatform={() => {}}
      />,
    );
    const rows = [
      ...container.querySelectorAll('section > div.rounded-xl, section [data-slot="card"]'),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(text.indexOf("You're not on this shelf")).toBeLessThan(text.indexOf('You: #2'));
    expect(text).toContain('2 · You');
    expect(text).toContain('via Amazon');
    expect(text).toContain('$129');
  });

  it('offers "Why not you?" on a shelf the brand isn’t on, opening its product on that shelf', () => {
    const ridge = {
      product: {
        id: 'ridge',
        title: 'Ridge 30L Hiking Backpack',
        url: null,
        productType: null,
        brand: null,
        description: null,
        image: null,
        category: 'Bags > Hiking backpacks',
        price: 119,
        currency: 'USD',
        inStock: true,
        hasGtin: true,
      },
      shelves: 0,
      winRate: null,
      avgRank: null,
      aiVisits: 0,
      orders: 0,
      revenue: null,
      currency: null,
      readiness: 64,
      missing: [],
      wrongPrice: null,
    };
    const text = render(
      <ShelfRows
        shelf={shelf}
        platforms={['chatgpt-shopping']}
        platform="all"
        onPlatform={() => {}}
        products={[ridge]}
      />,
    );
    expect(text).toContain('Yours, not here');
    const link = container.querySelector('a[href^="/dashboard/shopping/products/ridge"]')!;
    expect(link.textContent).toBe('Why not you?');
    // Its name for a screen reader starts with what it shows.
    expect(link.getAttribute('aria-label')).toBe(
      'Why not you? Open Ridge 30L Hiking Backpack beside the product AI picked on this shelf',
    );
    expect(link.getAttribute('href')).toBe(
      '/dashboard/shopping/products/ridge?prompt=p1&platform=chatgpt-shopping',
    );
    // Only where the brand is missing: the shoes shelf has its own.
    expect(container.querySelectorAll('a[href^="/dashboard/shopping/products/"]')).toHaveLength(1);
  });

  it('filters by channel through the page, and by the price of the shelf', () => {
    const onPlatform = vi.fn();
    render(
      <ShelfRows
        shelf={shelf}
        platforms={['chatgpt-shopping']}
        platform="all"
        onPlatform={onPlatform}
      />,
    );
    const chip = [...container.querySelectorAll('button[aria-pressed]')].find(
      (b) => b.textContent === 'ChatGPT Shopping' || b.textContent === 'chatgpt-shopping',
    ) as HTMLButtonElement;
    act(() => chip.click());
    expect(onPlatform).toHaveBeenCalledWith('chatgpt-shopping');
  });

  it("names the price bands in the shelves' own currency", async () => {
    const euro = buildShelf(cards.map((c) => ({ ...c, price_currency: 'EUR' })));
    render(
      <ShelfRows
        shelf={{ ...shelf, rows: euro }}
        platforms={[]}
        platform="all"
        onPlatform={() => {}}
      />,
    );
    const trigger = container.querySelector<HTMLElement>('[aria-label="Price"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.textContent),
    ).toEqual(['All', 'Under €50', '€50–€100', '€100–€200', '€200 and up']);
  });

  it('says when there is nothing to show', () => {
    expect(
      render(
        <ShelfRows
          shelf={{ ...shelf, rows: [] }}
          platforms={[]}
          platform="all"
          onPlatform={() => {}}
        />,
      ),
    ).toContain('No shopping answers in this period');
  });
});

describe('ShelfFailed', () => {
  it("says the shelves couldn't be read, and reads them again on Try again", () => {
    const onRetry = vi.fn();
    const text = render(<ShelfFailed onRetry={onRetry} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text).toContain("Couldn't read the shelves right now.");
    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('priceText', () => {
  it('writes whole prices without cents, others with', () => {
    expect(priceText(139, 'USD')).toBe('$139');
    expect(priceText(24.5, 'USD')).toBe('$24.50');
    expect(priceText(89, 'EUR')).toBe('€89');
    expect(priceText(10, 'XYZ1')).toBe('10 XYZ1');
  });
});
