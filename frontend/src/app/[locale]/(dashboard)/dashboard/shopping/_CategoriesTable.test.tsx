import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { CategoryRow } from '@/lib/shopping/categories';

const sendShoppingActions = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/shopping', () => ({ sendShoppingActions }));
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

const { CategoriesTable } = await import('./_CategoriesTable');

/** The Categories table (ECOM-008). */

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

const row = (over: Partial<CategoryRow>): CategoryRow => ({
  id: 'shoes',
  name: 'Shoes > Trail running shoes',
  leaf: 'Trail running shoes',
  prompts: 14,
  promptIds: [],
  shelfShare: 0.31,
  productsOnShelf: 6,
  products: 24,
  topRival: { name: 'Summit Gear', domain: 'summitgear.example' },
  revenue: { value: 6100, currency: 'USD' },
  needsAttention: false,
  ...over,
});

describe('CategoriesTable', () => {
  it("lists each category's questions, share, products on shelf, top rival and AI revenue", () => {
    render(
      <CategoriesTable
        categories={[
          row({}),
          row({
            id: 'packs',
            leaf: 'Hiking backpacks',
            prompts: 11,
            shelfShare: 0.04,
            productsOnShelf: 1,
            products: 18,
            revenue: null,
            topRival: null,
            needsAttention: true,
          }),
        ]}
        loading={false}
        failed={false}
      />,
    );
    const cells = [...container.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(cells).toEqual([
      ['Trail running shoes14 shopping questions', '31%', '6 / 24', 'Summit Gear', '$6,100'],
      ['Hiking backpacks11 shopping questions · needs attention', '4%', '1 / 18', '—', '—'],
    ]);
  });

  it("shows a category's last done action under its name, 7 days on", () => {
    const done = {
      actionId: 'a9',
      actionNo: 9,
      completedAt: '2026-10-12T09:00:00Z',
      readyAt: '2026-10-19T09:00:00Z',
      before: { shelves: 5, on: 1 },
      after: { shelves: 6, on: 3 },
    };
    render(
      <CategoriesTable
        categories={[row({}), row({ id: 'packs', leaf: 'Hiking backpacks' })]}
        loading={false}
        failed={false}
        results={{
          'category:shoes': done,
          'category:packs': { ...done, actionId: 'a10', actionNo: 10, after: null },
        }}
      />,
    );
    const links = [...container.querySelectorAll('tbody a')].map((a) => [
      a.getAttribute('href'),
      a.textContent,
    ]);
    expect(links).toEqual([
      ['/dashboard/action-center/actions?action=a9', '#9: 1/5 → 3/6 shelves'],
      ['/dashboard/action-center/actions?action=a10', '#10 done · result Oct 19, 2026'],
    ]);
  });

  it('says a category whose shelves were not run after its action, or not before it, apart', () => {
    const done = {
      actionId: 'a9',
      actionNo: 9,
      completedAt: '2026-10-12T09:00:00Z',
      readyAt: '2026-10-19T09:00:00Z',
      before: { shelves: 5, on: 1 },
      after: { shelves: 0, on: 0 },
    };
    render(
      <CategoriesTable
        categories={[row({}), row({ id: 'packs', leaf: 'Hiking backpacks' })]}
        loading={false}
        failed={false}
        results={{
          'category:shoes': done,
          'category:packs': {
            ...done,
            actionId: 'a10',
            actionNo: 10,
            before: { shelves: 0, on: 0 },
            after: { shelves: 3, on: 2 },
          },
        }}
      />,
    );
    expect([...container.querySelectorAll('tbody a')].map((a) => a.textContent)).toEqual([
      '#9 done · not run in the 7 days after',
      '#10: new · 2/3 shelves',
    ]);
  });

  it('says a category whose answers were too many to read all is not compared', () => {
    render(
      <CategoriesTable
        categories={[row({})]}
        loading={false}
        failed={false}
        results={{
          'category:shoes': {
            actionId: 'a9',
            actionNo: 9,
            completedAt: '2026-10-12T09:00:00Z',
            readyAt: '2026-10-19T09:00:00Z',
            before: { shelves: 0, on: 0 },
            after: { shelves: 3, on: 2 },
            partial: true,
          },
        }}
      />,
    );
    const link = container.querySelector('tbody a')!;
    expect(link.textContent).toBe('#9 done · too many answers to compare');
    expect(link.className).toContain('text-muted-foreground');
  });

  it("plans a category's actions in a dialog, measured on its questions", async () => {
    sendShoppingActions.mockResolvedValue({ actionId: 'a1', actionNo: 302, created: true });
    render(
      <CategoriesTable
        brandId="b1"
        categories={[
          row({ promptIds: ['q1', 'q2'], needsAttention: true, leaf: 'Hiking backpacks' }),
        ]}
        loading={false}
        failed={false}
      />,
    );
    const plan = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Plan actions',
    )!;
    // Named for its row's category, the visible text first.
    expect(plan.getAttribute('aria-label')).toBe('Plan actions for Hiking backpacks');
    act(() => plan.click());
    expect(document.body.textContent).toContain('Category actions · Hiking backpacks');
    expect(document.body.textContent).toContain('Buying guide: how to choose hiking backpacks');
    const send = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Send 4 actions to Action Center',
    )!;
    await act(async () => send.click());
    expect(sendShoppingActions).toHaveBeenCalledWith(
      'b1',
      { type: 'category', id: 'shoes' },
      expect.arrayContaining([expect.objectContaining({ type: 'create_content', who: 'agent' })]),
      ['q1', 'q2'],
    );
  });

  it('says when the catalog has no categories, or they could not be read', () => {
    expect(render(<CategoriesTable categories={null} loading={false} failed={false} />)).toContain(
      'Your catalog has no categories yet.',
    );
    expect(render(<CategoriesTable categories={null} loading={false} failed />)).toContain(
      "Couldn't read your catalog's categories right now.",
    );
  });
});
