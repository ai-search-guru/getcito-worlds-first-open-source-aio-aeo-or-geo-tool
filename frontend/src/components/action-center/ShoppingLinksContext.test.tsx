import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ShoppingLinksContext } from './ShoppingLinksContext';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(payload: Record<string, unknown>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ShoppingLinksContext payload={payload} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ShoppingLinksContext', () => {
  it('opens the draft to swap them in, and names the page, what no longer sells and what to link instead', async () => {
    await render({
      draftId: 'd9',
      pageUrl: 'https://shop.example/blog/rain-jackets',
      products: [
        { id: 'p1', title: 'Storm Shell 2', state: 'sold_out' },
        { id: 'p2', title: 'Pack-Lite Jacket', state: 'refused' },
      ],
      swaps: [
        { id: 'p3', title: 'Storm Shell 3' },
        { id: 'p4', title: 'Pack-Lite Pro' },
      ],
    });
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/dashboard/content/editor/d9');
    expect(link.textContent).toContain('Swap in the editor');
    expect(container.textContent).toContain('/blog/rain-jackets');
    expect(container.textContent).toContain('Storm Shell 2Sold out');
    expect(container.textContent).toContain('Pack-Lite JacketRefused by Merchant Center');
    expect(container.textContent).toContain('Storm Shell 3 · Pack-Lite Pro');
    expect(container.textContent).toContain('or now with Check now on its task');
  });

  it('reads a payload of the wrong shape without breaking', async () => {
    await render({ products: 'none', swaps: [null, { title: 5 }] });
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain('Products it links');
    expect(container.textContent).not.toContain('In stock');
  });
});
