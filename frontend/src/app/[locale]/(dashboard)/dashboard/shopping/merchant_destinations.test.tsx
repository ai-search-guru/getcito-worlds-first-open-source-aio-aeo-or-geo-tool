import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { toMerchantSplit } from '@/lib/shoppingMerchantSplit';
import { detectResellerPriceAlerts } from '@/lib/shoppingResellerPriceAlert';
import { MerchantSplitCard } from './merchant_split_card';
import { ResellerPriceAlerts } from './reseller_price_alerts';

/**
 * #1277: the Overview tab's "Where AI sends shoppers" split and the
 * "Resellers cheaper than you" list.
 */

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

describe('MerchantSplitCard', () => {
  it('lists each destination with its cards and share, and the unclassified apart', () => {
    const split = toMerchantSplit({
      own_store_cards: 1,
      amazon_cards: 300,
      walmart_cards: 0,
      ebay_cards: 0,
      other_marketplace_cards: 99,
      reseller_cards: 600,
      unclassified_cards: 12,
    });
    const text = render(<MerchantSplitCard split={split} loading={false} />);

    expect(text).toContain('Where AI sends shoppers');
    expect(text).toContain('Your store1 card<1%');
    expect(text).toContain('Amazon300 cards30%');
    expect(text).toContain('Walmart0 cards0%');
    expect(text).toContain('Other resellers600 cards60%');
    expect(text).toContain('12 cards have no merchant link and are not in the split.');
    // Only destinations with cards are drawn in the bar.
    expect(container.querySelectorAll('[role="img"] > span')).toHaveLength(4);
  });

  it('says so when no card links to a merchant', () => {
    const text = render(<MerchantSplitCard split={toMerchantSplit(null)} loading={false} />);
    expect(text).toContain('No cards for your products link to a merchant in this window.');
    expect(container.querySelector('[role="img"]')).toBeNull();
  });
});

describe('ResellerPriceAlerts', () => {
  it('shows both prices and opens both links in a new tab', () => {
    const alerts = detectResellerPriceAlerts([
      {
        merchantKind: 'own',
        marketplace: null,
        merchantDomain: 'acme.example',
        merchantUrl: 'https://acme.example/runner',
        listingId: null,
        productTitle: 'Acme Runner',
        priceAmount: 120,
        priceCurrency: 'USD',
      },
      {
        merchantKind: 'marketplace',
        marketplace: 'amazon',
        merchantDomain: 'amazon.com',
        merchantUrl: 'https://www.amazon.com/dp/B000000001',
        listingId: 'B000000001',
        productTitle: 'Acme Runner',
        priceAmount: 99,
        priceCurrency: 'USD',
      },
    ]);
    const text = render(<ResellerPriceAlerts alerts={alerts} loading={false} />);

    expect(text).toContain('Acme Runner');
    expect(text).toContain('18% lower');
    expect(text).toContain('$120.00');
    expect(text).toContain('$99.00');
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://acme.example/runner',
      'https://www.amazon.com/dp/B000000001',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('says so when no reseller undercuts the store', () => {
    expect(render(<ResellerPriceAlerts alerts={[]} loading={false} />)).toContain(
      'No reseller undercuts your store in this window.',
    );
  });
});
