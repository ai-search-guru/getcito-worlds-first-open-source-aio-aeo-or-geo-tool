import { runInNewContext } from 'vm';
import { describe, expect, it } from 'vitest';
import { QUEUE_STUB, shopifyPixelCode, trackingSnippetTag } from './conversionTracking';

const API = 'https://api.getcito.test';
const VISITOR = {
  id: 'Vq3xT0mZ8kLp2RwYbN5sQa',
  f: { s: 'chatgpt.com', u: 'https://shop.example/products/mug', at: 1_790_000_000_000 },
};

describe('trackingSnippetTag', () => {
  it('is the tag as it always was without conversions, and follows AI visitors with them', () => {
    expect(trackingSnippetTag(API, 'abc123')).toBe(
      '<script src="https://api.getcito.test/t.js" data-t="abc123" defer></script>',
    );
    // With the queue stub above it: the tag is deferred, the site's calls come first.
    expect(trackingSnippetTag(API, 'abc123', 'wait')).toBe(
      `${QUEUE_STUB}\n<script src="https://api.getcito.test/t.js" data-t="abc123" data-c="1" data-consent="wait" defer></script>`,
    );
    expect(trackingSnippetTag(null, 'abc123')).toBeNull();
    expect(trackingSnippetTag(API, undefined)).toBeNull();
  });
});

/**
 * Runs the pixel as Shopify would (its analytics and browser APIs), fires a
 * checkout_completed event, and returns what it sent to the API.
 */
async function completeCheckout({
  stored = VISITOR as unknown,
  checkout = {} as Record<string, unknown>,
} = {}) {
  const code = shopifyPixelCode(API, 'abc123')!;
  const handlers: Record<string, (event: unknown) => Promise<void>> = {};
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  runInNewContext(code, {
    analytics: {
      subscribe: (name: string, fn: (event: unknown) => Promise<void>) => (handlers[name] = fn),
    },
    browser: {
      localStorage: {
        getItem: async (key: string) =>
          key === 'getcito_v' && stored ? JSON.stringify(stored) : null,
      },
    },
    fetch: (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve();
    },
    JSON,
    Number,
    String,
  });
  await handlers.checkout_completed({
    data: {
      checkout: {
        totalPrice: { amount: 129.5, currencyCode: 'EUR' },
        lineItems: [{ quantity: 2 }, { quantity: 1 }],
        order: { id: 'gid://shopify/OrderIdentity/1001' },
        token: 'tok-1',
        ...checkout,
      },
    },
    context: { document: { location: { origin: 'https://shop.example' } } },
  });
  return sent;
}

describe('shopifyPixelCode', () => {
  it('sends the order, its value, currency and units, by the visitor id the snippet kept', async () => {
    expect(await completeCheckout()).toEqual([
      {
        url: 'https://api.getcito.test/track/abc123',
        body: {
          k: 'cv',
          g: 'order',
          o: 'shopify',
          id: VISITOR.id,
          f: VISITOR.f,
          // Never the thank-you page's own address: its path carries the order's token.
          u: 'https://shop.example/checkout',
          q: 3,
          val: 129.5,
          cur: 'EUR',
          ref: 'gid://shopify/OrderIdentity/1001',
        },
      },
    ]);
  });

  it('sends nothing for a visitor the snippet didn’t follow', async () => {
    expect(await completeCheckout({ stored: null })).toEqual([]);
    expect(await completeCheckout({ stored: { id: VISITOR.id } })).toEqual([]);
  });

  it('leaves out an amount that isn’t a number, and an order ref without the order’s id: never the token', async () => {
    const [{ body }] = await completeCheckout({
      checkout: { totalPrice: { amount: 'n/a' }, order: undefined },
    });
    expect(body).not.toHaveProperty('val');
    expect(body).not.toHaveProperty('cur');
    expect(body).not.toHaveProperty('ref');
    expect(JSON.stringify(body)).not.toContain('tok-1');
  });

  it('leaves out an amount or units the server wouldn’t take, and still sends the order', async () => {
    const [{ body }] = await completeCheckout({
      checkout: {
        totalPrice: { amount: 2e9, currencyCode: 'IDR' },
        lineItems: [{ quantity: 200000 }],
      },
    });
    expect(body).not.toHaveProperty('val');
    expect(body).not.toHaveProperty('q');
    expect(body).toMatchObject({ g: 'order', cur: 'IDR', ref: 'gid://shopify/OrderIdentity/1001' });
  });

  it('is null without an API URL or a tracking code', () => {
    expect(shopifyPixelCode(null, 'abc123')).toBeNull();
    expect(shopifyPixelCode(API, '')).toBeNull();
  });
});
