import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import { useAssetTypeLabel } from './useAssetTypeLabel';

const brandState = vi.hoisted(() => ({
  activeBrandId: 'brand-1' as string | null,
  brands: [{ id: 'brand-1', siteType: 'ecommerce' as string | undefined, industry: 'Software' }],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const TYPES = ['pillar_guide', 'product_page', 'alternatives', 'backlink', 'podcast'];

function Probe() {
  const label = useAssetTypeLabel();
  return <p>{TYPES.map((type) => label(type) ?? '—').join(' | ')}</p>;
}

function labels() {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe />
      </NextIntlClientProvider>,
    ),
  );
  const text = container.textContent;
  act(() => root.unmount());
  return text;
}

describe('useAssetTypeLabel', () => {
  it("names each type as the active brand's kind of site reads it", () => {
    expect(labels()).toBe('Buying guide | Product page | Alternatives page | Backlink | —');
  });

  it('reads older types for the site type the brand has, or its guess', () => {
    brandState.brands[0].siteType = undefined;
    // Software guesses B2B: an older product page is a feature page there.
    expect(labels()).toBe('How-to guide | Feature page | Alternatives page | Backlink | —');
  });
});
