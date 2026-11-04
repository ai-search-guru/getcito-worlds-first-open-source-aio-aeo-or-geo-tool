import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { ProductPromptMatch, ShoppingProduct } from '@/lib/actions/shopping';

/** #1282, part 1: an own product's match with each prompt, in its drawer. */

const getProductMatchScores = vi.fn();
vi.mock('@/lib/actions/shopping', () => ({
  getProductMatchScores: (...args: unknown[]) => getProductMatchScores(...args),
}));

const { ProductMatchScores } = await import('./product_match_scores');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getProductMatchScores.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function product(promptIds: string[]): ShoppingProduct {
  return {
    product_title: 'Trailrunner Waterproof Hiking Boot',
    product_brand: 'Acme',
    impressions: promptIds.length,
    platforms: ['chatgpt-shopping'],
    regions: ['US'],
    last_seen: '2026-10-20T10:00:00Z',
    last_price: null,
    price_currency: null,
    top_merchant: null,
    image_url: null,
    appearances: promptIds.map((id, i) => ({
      id: `a${i}`,
      prompt_id: id,
      prompt_text: 'Best waterproof hiking boots',
      created_at: '2026-10-20T10:00:00Z',
      region: 'US',
      platform: 'chatgpt-shopping',
      raw: null,
      merchant_url: null,
      merchant_domain: null,
    })),
  };
}

async function render(p: ShoppingProduct) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ProductMatchScores brandId="b1" filters={{ datePreset: '30d' }} product={p} />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('ProductMatchScores', () => {
  it("shows each prompt's score, the product shown first, and the missing words, as our estimate", async () => {
    const matches: ProductPromptMatch[] = [
      {
        promptId: 'p1',
        promptText: 'Best waterproof hiking boots',
        score: 62,
        missing: ['wet', 'rock'],
        top: { title: 'Summit Boot', score: 88, isThis: false },
      },
      {
        promptId: 'p2',
        promptText: 'Hiking boots for rain',
        score: 75,
        missing: [],
        top: { title: 'Trailrunner Waterproof Hiking Boot', score: 75, isThis: true },
      },
    ];
    getProductMatchScores.mockResolvedValue(matches);
    const text = await render(product(['p1', 'p2', 'p1']));

    expect(getProductMatchScores).toHaveBeenCalledWith(
      'b1',
      'Trailrunner Waterproof Hiking Boot',
      ['p1', 'p2'],
      { datePreset: '30d' },
    );
    expect(text).toContain('GetCito estimate');
    expect(text).toContain('This product 62');
    expect(text).toContain('Shown first 88');
    expect(text).toContain('Missing:wetrock');
    expect(text).toContain('Shown first in the latest answer');
  });

  it("says so when the read fails, and when there's no prompt to compare with", async () => {
    getProductMatchScores.mockRejectedValue(new Error('invalid'));
    expect(await render(product(['p1']))).toContain("Couldn't read the match right now.");
    expect(await render(product([]))).toContain('No prompt to compare with in this window.');
  });
});
