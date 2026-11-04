import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_DAYS,
  EMAIL_SEGMENT,
  holdsEmail,
  eventLabel,
  eventRow,
  eventUrl,
  orderKey,
  orderRef,
} from './trafficEvents.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ID = 'Vq3xT0mZ8kLp2RwYbN5sQa';
const first = {
  s: 'chatgpt.com',
  u: 'https://acme.example/blog/crm?utm_source=chatgpt.com',
  at: NOW - DAY,
};

describe('holdsEmail', () => {
  it('reads a path segment once, however long: any sender’s address is read with it', () => {
    expect(holdsEmail('ann@example.com')).toBe(true);
    expect(holdsEmail('ann%40example.com')).toBe(true);
    // A malformed escape elsewhere in it: the @ is still read.
    expect(holdsEmail('ann%40example.com%E0')).toBe(true);
    expect(holdsEmail('ann%40example%2Ecom%E0')).toBe(true);
    expect(holdsEmail('@acme')).toBe(false);
    expect(holdsEmail('pricing')).toBe(false);
    const started = Date.now();
    for (const segment of ['a'.repeat(16_384), 'a.'.repeat(8_192), `x${'%40a'.repeat(4_000)}`]) {
      holdsEmail(segment);
    }
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('reads a long address of many short segments with malformed escapes fast', () => {
    const address = `https://acme.example/ann%40example%2Ecom/${'a%E0/'.repeat(3_200)}`;
    const started = Date.now();
    expect(eventUrl(address)).toMatch(/^https:\/\/acme\.example\/\[email\]\/a%E0\//);
    // A decode per segment took about 11 ms here; reading the escapes as they are, under 1.
    expect(Date.now() - started).toBeLessThan(8);
  });
});

describe('eventUrl', () => {
  it('keeps the origin and path, never the query string or the fragment', () => {
    expect(eventUrl('https://acme.example/thanks?email=ann@example.com#done')).toBe(
      'https://acme.example/thanks',
    );
    expect(eventUrl('javascript:alert(1)')).toBeNull();
    expect(eventUrl('not a url')).toBeNull();
  });

  it('keeps no email in the path: its segment goes as a placeholder, raw or encoded', () => {
    expect(eventUrl('https://acme.example/unsubscribe/ann@example.com')).toBe(
      `https://acme.example/unsubscribe/${EMAIL_SEGMENT}`,
    );
    expect(eventUrl('https://acme.example/account/ann%40example.com/orders')).toBe(
      `https://acme.example/account/${EMAIL_SEGMENT}/orders`,
    );
    expect(eventUrl('https://acme.example/account/ANN%40EXAMPLE.COM')).toBe(
      `https://acme.example/account/${EMAIL_SEGMENT}`,
    );
    // An encoded dot too.
    expect(eventUrl('https://acme.example/account/ann%40example%2Ecom')).toBe(
      `https://acme.example/account/${EMAIL_SEGMENT}`,
    );
    // A handle isn't an email: the page keeps its key.
    expect(eventUrl('https://acme.example/@acme/post')).toBe('https://acme.example/@acme/post');
    expect(eventUrl('https://acme.example/@acme.dev')).toBe('https://acme.example/@acme.dev');
    // The first visit's landing page is read the same way.
    expect(
      eventRow(
        'b1',
        {
          k: 'pv',
          id: ID,
          u: 'https://acme.example/u/ann@example.com',
          f: { ...first, u: 'https://acme.example/invite/bob%40example.com' },
        },
        NOW,
      ),
    ).toMatchObject({
      url: `https://acme.example/u/${EMAIL_SEGMENT}`,
      first_url: `https://acme.example/invite/${EMAIL_SEGMENT}`,
    });
  });
});

describe('eventLabel and orderRef', () => {
  it('keep a form’s or a call’s own name, never what looks like a person’s details', () => {
    expect(eventLabel('  pricing-demo ')).toBe('pricing-demo');
    expect(eventLabel('Sipariş #12')).toBe('Sipariş #12');
    expect(eventLabel('ann@example.com')).toBeNull();
    expect(eventLabel('+90 555 123 45 67')).toBeNull();
    expect(eventLabel('')).toBeNull();
  });

  it('keep an order’s id at the shop as it is, and nothing else', () => {
    expect(orderRef('#1001')).toBe('#1001');
    expect(orderRef('gid://shopify/Order/123456789')).toBe('gid://shopify/Order/123456789');
    expect(orderRef('a b')).toBeNull();
    expect(orderRef('x'.repeat(129))).toBeNull();
  });

  it('store an order’s id as a hash of the brand and the id: compared, never kept as it is', () => {
    const key = orderKey('b1', ' #1001 ');
    expect(key).toBe(createHash('sha256').update('b1:#1001').digest('hex'));
    expect(key).toHaveLength(64);
    // The same order counts once for its brand; another brand's is another.
    expect(orderKey('b1', '#1001')).toBe(key);
    expect(orderKey('b2', '#1001')).not.toBe(key);
    expect(orderKey('b1', 'a b')).toBeNull();
    expect(orderKey('b1', undefined)).toBeNull();
  });
});

describe('eventRow', () => {
  it('makes a journey pageview, credited to the first AI visit', () => {
    expect(
      eventRow(
        'b1',
        { k: 'pv', id: ID, u: 'https://acme.example/pricing?plan=pro', f: first },
        NOW,
      ),
    ).toEqual({
      brand_id: 'b1',
      visitor_id: ID,
      kind: 'page',
      url: 'https://acme.example/pricing',
      first_source: 'chatgpt.com',
      first_url: 'https://acme.example/blog/crm',
      first_at: new Date(NOW - DAY).toISOString(),
    });
  });

  it('makes a conversion with its goal, label, value and units; a call when it says no origin', () => {
    const row = eventRow(
      'b1',
      {
        k: 'cv',
        id: ID,
        u: 'https://acme.example/thanks',
        f: first,
        g: 'order',
        n: '  checkout  ',
        val: 129.5,
        cur: 'eur',
        q: 2,
        ref: 'order-1001',
      },
      NOW,
    );
    expect(row).toMatchObject({
      kind: 'conversion',
      goal: 'order',
      label: 'checkout',
      origin: 'call',
      value: 129.5,
      currency: 'EUR',
      units: 2,
      order_ref: orderKey('b1', 'order-1001'),
    });
    expect(
      eventRow(
        'b1',
        { k: 'cv', id: ID, u: 'https://acme.example/', f: first, g: 'demo', o: 'form' },
        NOW,
      ),
    ).toMatchObject({
      goal: 'demo',
      origin: 'form',
      value: null,
      currency: null,
      units: null,
      order_ref: null,
    });
  });

  it('keeps a currency only with an amount, and only as a three-letter code', () => {
    const cv = (extra) =>
      eventRow(
        'b1',
        { k: 'cv', id: ID, u: 'https://acme.example/', f: first, g: 'order', ...extra },
        NOW,
      );
    expect(cv({ cur: 'USD' }).currency).toBeNull();
    expect(cv({ val: 10, cur: 'EURO' }).currency).toBeNull();
    expect(cv({ val: 10, cur: ' usd ' }).currency).toBe('USD');
  });

  it('never dates the first visit after the event, with a browser clock running ahead', () => {
    expect(
      eventRow(
        'b1',
        { k: 'pv', id: ID, u: 'https://acme.example/', f: { ...first, at: NOW + 60 * 60 * 1000 } },
        NOW,
      ).first_at,
    ).toBe(new Date(NOW).toISOString());
  });

  it('takes a page whose ad tags make its address long: they go with the query string', () => {
    const long = `https://acme.example/pricing?${'utm_term=x&'.repeat(600)}`;
    expect(eventRow('b1', { k: 'pv', id: ID, u: long, f: first }, NOW).url).toBe(
      'https://acme.example/pricing',
    );
  });

  it('stores an older snippet’s host under the source list’s key', () => {
    expect(
      eventRow(
        'b1',
        { k: 'pv', id: ID, u: 'https://acme.example/', f: { ...first, s: 'chat.openai.com' } },
        NOW,
      ).first_source,
    ).toBe('chatgpt.com');
  });

  it('drops what it can’t credit to an AI visit, or that isn’t one', () => {
    const pv = (extra) =>
      eventRow('b1', { k: 'pv', id: ID, u: 'https://acme.example/', f: first, ...extra }, NOW);
    // Not a source on the list.
    expect(pv({ f: { ...first, s: 'google.com' } })).toBeNull();
    // A first visit past the window, or in the future.
    expect(pv({ f: { ...first, at: NOW - (ATTRIBUTION_DAYS + 1) * DAY } })).toBeNull();
    expect(pv({ f: { ...first, at: NOW + 2 * DAY } })).toBeNull();
    // A malformed visitor id, page, or a conversion without a goal.
    expect(pv({ id: 'short' })).toBeNull();
    expect(pv({ u: 'ftp://acme.example/' })).toBeNull();
    expect(
      eventRow('b1', { k: 'cv', id: ID, u: 'https://acme.example/', f: first }, NOW),
    ).toBeNull();
    expect(
      eventRow('b1', { k: 'cv', id: ID, u: 'https://acme.example/', f: first, g: 'refund' }, NOW),
    ).toBeNull();
    // Not a journey event at all.
    expect(
      eventRow('b1', { k: 'nf', id: ID, u: 'https://acme.example/', f: first }, NOW),
    ).toBeNull();
  });
});
