import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

const listCatalogSources = vi.fn();
vi.mock('@/lib/actions/catalog', () => ({
  listCatalogSources: (...args: unknown[]) => listCatalogSources(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { CatalogNote } = await import('./_CatalogNote');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** #1270: My Products' note, for a brand with no catalog source yet. */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  listCatalogSources.mockReset().mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(brandId = 'b1') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CatalogNote brandId={brandId} />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('CatalogNote', () => {
  it('says what the table is and what a catalog adds, with the way to Settings, when the brand has none', async () => {
    const text = await render();
    expect(listCatalogSources).toHaveBeenCalledWith('b1');
    expect(text).toContain('These are your products as AI shopping cards showed them.');
    expect(text).toContain(
      "the Content Editor checks your product pages' price, GTIN and stock against it.",
    );
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Settings › Integrations');
    expect(link.getAttribute('href')).toBe('/dashboard/settings/integrations');
  });

  it('says nothing once the brand has a catalog source, or when they cannot be read', async () => {
    listCatalogSources.mockResolvedValue([{ id: 's1' }]);
    expect(await render()).toBe('');

    listCatalogSources.mockRejectedValue(new Error('read failed'));
    expect(await render('b2')).toBe('');
  });

  it("doesn't show one brand's answer for another while it reads", async () => {
    await render('b1');
    expect(container.textContent).not.toBe('');
    listCatalogSources.mockReturnValue(new Promise(() => {}));
    expect(await render('b2')).toBe('');
  });
});
