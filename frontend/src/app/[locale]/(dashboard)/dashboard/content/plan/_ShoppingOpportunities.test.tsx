import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { CategoryPage } from '@/lib/catalogClient';
import type { ShoppingPlanDraft } from '@/lib/content/shoppingPlan';

/** Plan › Shopping opportunities (shopping path, part 7). */

const push = vi.hoisted(() => vi.fn());
const listCategoryPages = vi.hoisted(() => vi.fn());
const getShoppingPlan = vi.hoisted(() => vi.fn());
const createContentDraft = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/lib/catalogClient', () => ({ listCategoryPages }));
vi.mock('@/lib/actions/shoppingPlan', () => ({ getShoppingPlan }));
vi.mock('@/lib/actions/contentDrafts', () => ({ createContentDraft }));

const { ShoppingOpportunities } = await import('./_ShoppingOpportunities');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND = '33333333-3333-3333-3333-333333333333';

const category = (name: string, inStock: number, page = true): CategoryPage => ({
  name,
  products: inStock + 6,
  inStock,
  page: page ? { url: 'https://shop.example/c/x', title: name } : null,
  how: page ? 'address' : null,
});

const published = (id: string, over: Partial<ShoppingPlanDraft> = {}): ShoppingPlanDraft => ({
  id,
  title: 'Best rain jackets for 2026',
  status: 'published',
  categories: ['Outerwear > Rain Jackets'],
  shopping: {
    state: 'attention',
    readFrom: 'page',
    checkedAt: '2026-10-27T09:00:00Z',
    categories: 1,
    categoriesLinked: 0,
    products: 4,
    productsLinked: 2,
    bad: [
      { id: 'p1', title: 'Storm Shell 2', state: 'sold_out' },
      { id: 'p2', title: 'Pack-Lite Jacket', state: 'sold_out' },
    ],
  },
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render(hidden = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ShoppingOpportunities brandId={BRAND} hidden={hidden} />
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  push.mockReset();
  createContentDraft.mockReset();
  toastError.mockReset();
  listCategoryPages.mockReset().mockResolvedValue({
    ok: true,
    value: [
      category('Shoes > Hiking Boots', 18),
      category('Outerwear > Rain Jackets', 12),
      category('Tents', 5, false),
    ],
  });
  getShoppingPlan.mockReset().mockResolvedValue({
    drafts: [published('d1')],
    prompts: [
      { id: '44444444-4444-4444-4444-444444444444', text: 'best waterproof hiking boots' },
      { id: '55555555-5555-5555-5555-555555555555', text: 'hiking boots for wide feet' },
    ],
    products: 1240,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ShoppingOpportunities', () => {
  it('lists the guides its categories miss and the posts to fix, ranked, with why and the stock', async () => {
    await render();
    expect(container.textContent).toContain('Shopping opportunities');
    expect(container.textContent).toContain('Catalog: 1,240 products in 3 categories');
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent);
    // The post linking two sold-out products first, then the guides by their prompts and stock.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Existing post');
    expect(rows[0]).toContain('Best rain jackets for 2026');
    expect(rows[0]).toContain(
      'No link to the Rain Jackets page. 2 products it links are sold out.',
    );
    expect(rows[0]).toContain('18 products · 12 in stock');
    expect(rows[0]).toContain('Optimize');
    expect(rows[1]).toContain('How to choose hiking boots');
    expect(rows[1]).toContain('AI is asked about hiking boots in 2 of your prompts');
    expect(rows[2]).toContain('How to choose tents');
    expect(rows[2]).toContain('It has no category page to link');
    const optimize = container.querySelector('a[href="/dashboard/content/editor/d1"]');
    expect(optimize?.textContent).toBe('Optimize');
  });

  it("starts a buying guide as a draft from the category's first prompt, and opens it", async () => {
    createContentDraft.mockResolvedValue('new-draft');
    await render();
    await act(async () => button('Create')!.click());
    expect(createContentDraft).toHaveBeenCalledWith(BRAND, {
      method: 'create',
      title: 'How to choose hiking boots',
      pageType: 'buying_guide',
      typePicked: true,
      source: { kind: 'prompt', id: '44444444-4444-4444-4444-444444444444' },
    });
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/new-draft');
  });

  it('says when a guide could not be started, and lets it be tried again', async () => {
    createContentDraft.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    await act(async () => button('Create')!.click());
    expect(toastError).toHaveBeenCalledWith("Couldn't start the guide. Try again.");
    expect(button('Create')!.disabled).toBe(false);
  });

  it('opens the draft being written for a category instead of starting another', async () => {
    getShoppingPlan.mockResolvedValue({
      drafts: [
        published('d1', { categories: [], shopping: { state: 'none' } }),
        published('d2', { title: 'Hiking boots, a guide', status: 'draft', categories: [] }),
      ],
      prompts: [],
      products: 30,
    });
    await render();
    const open = container.querySelector('a[href="/dashboard/content/editor/d2"]');
    expect(open?.textContent).toBe('Open draft');
    expect(container.textContent).toContain('A draft for it is being written.');
  });

  it('says when there is nothing to do, and stays hidden without catalog categories', async () => {
    listCategoryPages.mockResolvedValue({ ok: true, value: [category('Socks', 1)] });
    getShoppingPlan.mockResolvedValue({ drafts: [], prompts: [], products: 1 });
    await render();
    expect(container.textContent).toContain('No shopping opportunities right now');

    listCategoryPages.mockResolvedValue({ ok: true, value: [] });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toBe('');

    listCategoryPages.mockResolvedValue({ ok: false, code: 'failed' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toBe('');
  });

  it('keeps what it read while hidden, and shows it again without reading it anew', async () => {
    await render(true);
    expect(container.textContent).toBe('');
    expect(getShoppingPlan).toHaveBeenCalledOnce();
    await render(false);
    expect(container.textContent).toContain('Shopping opportunities');
    expect(getShoppingPlan).toHaveBeenCalledOnce();
    expect(listCategoryPages).toHaveBeenCalledOnce();
  });
});
