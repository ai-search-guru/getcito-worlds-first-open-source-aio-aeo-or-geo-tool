import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { productRows, type CatalogProductRow } from '@/lib/shopping/products';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ProductsTable } = await import('./_ProductsTable');

/** The Products table (ECOM-007). */

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

const product = (
  id: string,
  title: string,
  over: Partial<CatalogProductRow> = {},
): CatalogProductRow => ({
  id,
  title,
  url: null,
  productType: 'Backpacks',
  brand: 'Northwind',
  description: null,
  image: null,
  category: 'Bags > Backpacks',
  price: 119,
  currency: 'USD',
  inStock: true,
  hasGtin: false,
  ...over,
});

const rows = productRows(
  [product('p1', 'Ridge 30L Backpack'), product('p2', 'StormShell Jacket', { price: 189 })],
  [{ productId: 'p2', shelf: 'q1:copilot-web', rank: 1 }],
  [{ productId: 'p2', aiVisits: 402, orders: 38, revenue: 7200, currency: 'USD' }],
);

const views = () =>
  [...container.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent);
const bodyRows = () =>
  [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  );

describe('ProductsTable', () => {
  it("lists the catalog with each product's shelf, visits, orders and readiness", () => {
    render(<ProductsTable products={{ rows, total: 2 }} loading={false} />);
    expect(views()).toEqual([
      'All2',
      'Never shown1',
      'Shown, not clicked0',
      'Clicked, not bought0',
      'Top sellers from AI1',
    ]);
    expect(bodyRows()).toEqual([
      ['StormShell JacketBackpacks · $189', '1', '100%', '1.0', '402', '38', '$7,200', '40'],
      ['Ridge 30L BackpackBackpacks · $119', '0', '—', '—', '0', '0', '—', '40'],
    ]);
  });

  it('shows a view, and says when it has nothing', () => {
    render(<ProductsTable products={{ rows, total: 2 }} loading={false} />);
    const notBought = [...container.querySelectorAll('button[aria-pressed]')].find((b) =>
      b.textContent?.startsWith('Clicked, not bought'),
    ) as HTMLButtonElement;
    act(() => notBought.click());
    expect(container.textContent).toContain('No product had AI visits without an order.');
    const never = [...container.querySelectorAll('button[aria-pressed]')].find((b) =>
      b.textContent?.startsWith('Never shown'),
    ) as HTMLButtonElement;
    act(() => never.click());
    expect(bodyRows().map((row) => row[0])).toEqual(['Ridge 30L BackpackBackpacks · $119']);
  });

  it('links each product to its page', () => {
    render(<ProductsTable products={{ rows, total: 2 }} loading={false} />);
    expect(container.querySelector('a[href="/dashboard/shopping/products/p2"]')?.textContent).toBe(
      'StormShell Jacket',
    );
  });

  it('says when the catalog is larger than the table reads, and counts All and Never shown out of it', () => {
    expect(render(<ProductsTable products={{ rows, total: 2400 }} loading={false} />)).toContain(
      'Showing 2 of 2,400 products: every one AI showed or sent visits to, then the rest.',
    );
    expect(views()).toEqual([
      'All2,400',
      'Never shown2,399',
      'Shown, not clicked0',
      'Clicked, not bought0',
      'Top sellers from AI1',
    ]);
  });
});
