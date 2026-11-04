import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/** The Readiness tab (ECOM-015). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ReadinessTab } = await import('./_readiness');

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

describe('ReadinessTab', () => {
  it("shows the market, each channel's state and source, and the scored checklist with its fixes", () => {
    const onProducts = vi.fn();
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ReadinessTab
            market="europe"
            tracked={['chatgpt-shopping', 'copilot-web']}
            ownSlots={new Map([['copilot-web', 3]])}
            score={64}
            items={[
              { key: 'catalog', state: 'pass', values: { count: 320 } },
              { key: 'merchantCenter', state: 'fail', action: 'settings' },
              { key: 'firstWords', state: 'fail', values: { count: 132 }, action: 'products' },
              {
                key: 'wrongPrice',
                state: 'fail',
                values: {
                  count: 2,
                  product: 'Trail Runner X',
                  seen: 139,
                  yours: 129,
                  currency: 'USD',
                },
                action: 'products',
              },
            ]}
            onProducts={onProducts}
          />
        </NextIntlClientProvider>,
      );
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Market: Europe.');
    expect(text).toContain(
      'ChatGPT ShoppingTracked, yours not shownGoogle Shopping · via Merchant Center',
    );
    expect(text).toContain('Microsoft CopilotShowing your productsMicrosoft Merchant Center');
    expect(text).toContain('Google GeminiNot tracked');
    expect(text).toContain('AI shopping readiness64 / 100');
    expect(text).toContain('Catalog connected320 products from your feed, file or store.');
    expect(text).toContain('First 40 words of descriptions · 132 products');
    expect(text).toContain(
      'Wrong price in AI answers · 2 productsAI shows $139 for Trail Runner X, your price is $129.',
    );
    expect(container.querySelector('a[href="/dashboard/settings/integrations"]')?.textContent).toBe(
      'Connect',
    );
    act(() => (container.querySelector('button') as HTMLButtonElement).click());
    expect(onProducts).toHaveBeenCalled();
  });

  function renderTab(props: {
    loading?: boolean;
    unread?: ('sources' | 'products')[];
    channelsRead?: 'loading' | 'failed';
    items?: React.ComponentProps<typeof ReadinessTab>['items'];
  }) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ReadinessTab
            market="us"
            tracked={['copilot-web']}
            ownSlots={new Map()}
            score={80}
            items={[{ key: 'catalog', state: 'pass', values: { count: 320 } }]}
            onProducts={vi.fn()}
            {...props}
          />
        </NextIntlClientProvider>,
      );
    });
    return container.textContent ?? '';
  }

  it('waits for the sources and products it reads, without a score or checks', () => {
    const text = renderTab({ loading: true });
    expect(text).not.toContain('80 / 100');
    expect(text).not.toContain('Catalog connected');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("says what couldn't be read, and shows no score without it", () => {
    const text = renderTab({ unread: ['products'] });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Couldn't read your catalog's products right now, so their checks and the score wait until they can be. Try again in a moment.",
    );
    expect(text).not.toContain('80 / 100');
    expect(text).toContain('Catalog connected');
    expect(renderTab({})).toContain('AI shopping readiness80 / 100');
  });

  it('counts one product in the singular', () => {
    const text = renderTab({
      items: [
        { key: 'firstWords', state: 'warn', values: { count: 1 }, action: 'products' },
        {
          key: 'wrongPrice',
          state: 'fail',
          values: { count: 1, product: 'Trail Runner X', seen: 139, yours: 129, currency: 'USD' },
          action: 'products',
        },
        { key: 'resellerCheaper', state: 'fail', values: { count: 1 } },
      ],
    });
    expect(text).toContain('First 40 words of descriptions · 1 product');
    expect(text).toContain('Wrong price in AI answers · 1 product');
    expect(text).toContain('Reseller cheaper than you · 1 product');
    expect(text).not.toContain('1 products');
  });

  it("doesn't call a channel without the brand's products while every channel's shelves are read, or unread", () => {
    expect(renderTab({})).toContain('Microsoft CopilotTracked, yours not shown');
    const reading = renderTab({ channelsRead: 'loading' });
    expect(reading).not.toContain('Tracked, yours not shown');
    expect(reading).not.toContain('Not tracked');
    expect(renderTab({ channelsRead: 'failed' })).toContain("Microsoft CopilotCouldn't read");
  });
});
