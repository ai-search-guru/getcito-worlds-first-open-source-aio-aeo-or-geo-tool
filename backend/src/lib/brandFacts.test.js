import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's facts (Quality spec §10, CE-047): read from its own pricing,
 * About and product pages, each kept only with its words on the page and its
 * value read from them by rule; an unchanged page isn't read by the model
 * again; a person approves each one.
 */

// The real client needs the service key; each test passes its own.
vi.mock('../config/supabase.js', () => ({ default: {} }));

let reserves;
let reserveError;
const charge = vi.fn();
const release = vi.fn();
const keep = vi.fn();
const generateObject = vi.fn();

vi.mock('./planGuard.js', async (importOriginal) => {
  const { PlanLimitError } = await importOriginal();
  return {
    PlanLimitError,
    reserveAiBudget: async (orgId, options) => {
      reserves.push({ orgId, ...options });
      if (reserveError) throw reserveError;
      return { charge, release, keep };
    },
  };
});
vi.mock('./aiProvider.js', () => ({ resolveModel: (id) => ({ id }) }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: (...args) => generateObject(...args),
}));

const { NoObjectGeneratedError } = await import('ai');
const { PlanLimitError } = await import('./planGuard.js');
const { PageFetchError } = await import('./safeFetch.js');
const {
  FACTS_HOLD_USD,
  RECHECK_MS,
  factText,
  factTextHash,
  findFactPages,
  keptFacts,
  parseFounded,
  parsePrice,
  parseTrial,
  readBrandFacts,
  refreshBrandFacts,
  setFactStatus,
} = await import('./brandFacts.js');

const NOW = Date.parse('2026-10-24T12:00:00Z');

/** The tables read, as rows; each write, as it was asked. */
function fakeDb(tables) {
  const writes = [];
  const reads = [];
  const db = {
    from: (table) => {
      reads.push(table);
      const q = { op: 'select', filters: [], payload: null, options: null };
      const done = () => {
        if (q.op === 'select') return { data: tables[table] ?? [], error: null };
        writes.push({
          table,
          op: q.op,
          payload: q.payload,
          filters: q.filters,
          options: q.options,
        });
        return { data: null, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
        in: (col, value) => (q.filters.push(['in', col, value]), chain),
        neq: (col, value) => (q.filters.push(['neq', col, value]), chain),
        not: (col, op, value) => (q.filters.push(['not', col, value]), chain),
        order: () => chain,
        update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
        delete: () => ((q.op = 'delete'), chain),
        upsert: (payload, options) => (
          (q.op = 'upsert'),
          (q.payload = payload),
          (q.options = options),
          chain
        ),
        single: async () => {
          if (q.op === 'update') {
            done();
            return { data: { id: 'f1', ...q.payload }, error: null };
          }
          return { data: tables[table], error: null };
        },
        maybeSingle: async () => {
          if (q.op === 'update') {
            done();
            return {
              data: tables[table] === null ? null : { id: 'f1', ...q.payload },
              error: null,
            };
          }
          return { data: tables[table] ?? null, error: null };
        },
        then: (resolve, reject) => Promise.resolve(done()).then(resolve, reject),
      };
      return chain;
    },
  };
  return { db, writes, reads };
}

const PRICING = `<html><head><title>Pricing · Ledgerly</title></head><body>
  <nav><a href="/">Home</a> Plans from $9</nav>
  <h1>Pricing</h1>
  <div class="card"><h3>Starter</h3><p>$19</p><p>per month</p></div>
  <div class="card"><h3>Pro</h3><p>$49 per month, billed monthly</p>
    <p style="display:none">$39 per month, billed annually</p></div>
  <p>Every plan comes with a 14-day free trial.</p>
  <p>Ledgerly is SOC 2 Type II certified.</p>
  <p>${'Forecast your cash for the next quarter with every account in one place. '.repeat(3)}</p>
  <script>window.price = "$1"</script>
  <footer>© 2026 Ledgerly</footer>
</body></html>`;
const ABOUT = `<title>About us · Ledgerly</title><h1>About Ledgerly</h1>
  <p>Ledgerly was founded in 2015 in Lisbon.</p>
  <p>${'We build forecasting for small finance teams who close the books themselves. '.repeat(3)}</p>`;

const answerFor = (facts) => ({ object: { facts }, usage: { inputTokens: 800, outputTokens: 60 } });

beforeEach(() => {
  reserves = [];
  reserveError = null;
  charge.mockReset();
  release.mockReset();
  keep.mockReset();
  generateObject.mockReset();
});

describe('reading a fact from its words', () => {
  it('reads a price with its currency, period, billing and seat, whichever side its mark is on', () => {
    expect(parsePrice('$49 per month, billed monthly')).toEqual({
      amount: 49,
      currency: 'USD',
      period: 'month',
      billed: 'monthly',
      per: null,
    });
    expect(parsePrice('€49,99 pro Monat')).toMatchObject({ amount: 49.99, currency: 'EUR' });
    expect(parsePrice('1 299 €')).toMatchObject({ amount: 1299, currency: 'EUR' });
    expect(parsePrice('$1,299.00 billed annually')).toMatchObject({
      amount: 1299,
      period: 'year',
      billed: 'annually',
    });
    expect(parsePrice('US$ 29 per user', ' a month')).toMatchObject({
      per: 'seat',
      period: 'month',
    });
    expect(parsePrice('₺499 aylık')).toMatchObject({ currency: 'TRY', period: 'month' });
    expect(parsePrice('199 TL')).toMatchObject({ currency: 'TRY', amount: 199 });
    // A space never groups a price written before its number.
    expect(parsePrice('$49 100 users')).toMatchObject({ amount: 49 });
    // The period after it is its own, not the next plan's.
    expect(parsePrice('$0', ' Pro $49/month').period).toBeNull();
    // A scale, or no price.
    expect(parsePrice('$5M ARR')).toBeNull();
    expect(parsePrice('$2 Million')).toBeNull();
    expect(parsePrice('49 teams')).toBeNull();
  });

  it('stores no wrong value: two prices, a saving, a discount, a dollar named by its code, a feature list', () => {
    expect(parsePrice('$490/yr ($49/mo)')).toBeNull();
    expect(parsePrice('$59 $49 /month')).toBeNull();
    expect(parsePrice('Save $120 a year')).toBeNull();
    expect(parsePrice('$10', ' off per month')).toBeNull();
    expect(parsePrice('was $59')).toBeNull();
    expect(parsePrice('$49 CAD per month')).toMatchObject({ currency: 'CAD', period: 'month' });
    expect(parsePrice('$29 AUD/mo')).toMatchObject({ currency: 'AUD', period: 'month' });
    // Its period is in the words right after it, not further on.
    expect(parsePrice('$299', ' Lifetime access Includes monthly updates').period).toBe('once');
    expect(parsePrice('$299', ' Includes all integrations and monthly updates').period).toBeNull();
    // What comes right after the quote: a code, a scale, "off".
    expect(parsePrice('$49', ' CAD per month')).toMatchObject({ currency: 'CAD', period: 'month' });
    expect(parsePrice('€49 EUR per month')).toMatchObject({ currency: 'EUR', period: 'month' });
    expect(parsePrice('$2', ' million to build it')).toBeNull();
    // The next card's "Save 20%" or "Off-the-shelf" isn't this price's.
    expect(parsePrice('$49 per month', ' Save 20% with yearly')).toMatchObject({ amount: 49 });
    expect(parsePrice('$19 per month', ' Off-the-shelf templates')).toMatchObject({ amount: 19 });
    expect(parsePrice('$29 per active user per month')).toMatchObject({
      period: 'month',
      per: 'seat',
    });
  });

  it('reads a trial in days or weeks, and a founding year only beside its word', () => {
    expect(parseTrial('14-day free trial')).toBe(14);
    expect(parseTrial('Try it free for 2 weeks')).toBe(14);
    expect(parseTrial('30 gün ücretsiz deneme')).toBe(30);
    expect(parseTrial('free forever')).toBeNull();
    // A trial word, and days that start a number.
    expect(parseTrial('30-day money-back guarantee')).toBeNull();
    expect(parseTrial('a free trial over 2014 days')).toBeNull();
    expect(parseFounded('Get started in 2026')).toBeNull();
    expect(parseFounded('Founded in 2015')).toBe(2015);
    expect(parseFounded('2015 yılında kuruldu')).toBe(2015);
    expect(parseFounded('In 2015 we shipped')).toBeNull();
  });
});

describe('factText', () => {
  it('reads the words without scripts, menus or footers, a block a line, a toggle’s prices too', () => {
    const text = factText(PRICING);
    expect(text).not.toContain('window.price');
    expect(text).not.toContain('Plans from $9');
    expect(text).not.toContain('© 2026');
    expect(text).toContain('Starter\n$19\nper month');
    expect(text).toContain('$39 per month, billed annually');
    expect(factTextHash(text)).toMatch(/^[0-9a-f]{16}$/);
    expect(factTextHash(text)).toBe(factTextHash(factText(PRICING)));
    expect(factTextHash(`${text}!`)).not.toBe(factTextHash(text));
    // A struck-through old price isn't the page's.
    expect(factText('<p>Pro <del>$59</del> $49 per month</p>')).toBe('Pro $49 per month');
  });

  it('counts a page’s words toward its length, not its indents', () => {
    const indented = `<body>${`<div>\n${' '.repeat(200)}<span>Feature</span>\n</div>`.repeat(400)}<p>Every plan has a 14-day free trial.</p></body>`;
    expect(factText(indented)).toContain('14-day free trial');
  });

  it('reads a page of many thousand blocks in one walk, fast', () => {
    const html = `<body>${'<div>Plan</div>'.repeat(100_000)}</body>`;
    const started = Date.now();
    const text = factText(html);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(text.length).toBeLessThanOrEqual(24_000);
  });
});

describe('keptFacts', () => {
  const text = factText(PRICING);

  it('keeps a fact only in the page’s own words, its value read from them, never the model’s', () => {
    const kept = keptFacts(text, {
      facts: [
        { kind: 'price', quote: '$49 per month, billed monthly', plan: 'Pro' },
        // Across a card's lines.
        { kind: 'price', quote: '$19 per month', plan: 'Starter' },
        { kind: 'trial', quote: '14-day free trial', plan: null },
        { kind: 'claim', quote: 'SOC 2 Type II certified', plan: null },
        // Not on the page as written.
        { kind: 'price', quote: '$59 per month', plan: 'Pro' },
        { kind: 'claim', quote: 'Trusted by 2,000 teams', plan: null },
        // No plan, a plan the page doesn't name, a kind it doesn't know.
        { kind: 'price', quote: '$39 per month, billed annually', plan: null },
        { kind: 'price', quote: '$39 per month, billed annually', plan: 'Enterprise' },
        { kind: 'rating', quote: 'SOC 2 Type II certified', plan: null },
      ],
    });
    expect(kept.map((f) => [f.kind, f.quote, f.value_key])).toEqual([
      ['price', '$49 per month, billed monthly', '49.00'],
      ['price', '$19 per month', '19.00'],
      ['trial', '14-day free trial', '14'],
      ['claim', 'SOC 2 Type II certified', 'claim'],
    ]);
    expect(kept[0].slot).toBe('price|pro|USD|month|monthly|');
    expect(kept[0].value).toEqual({
      plan: 'Pro',
      amount: 49,
      currency: 'USD',
      period: 'month',
      billed: 'monthly',
      per: null,
    });
    // Its plan as the page writes it, even when the model wrote it otherwise.
    expect(
      keptFacts(text, { facts: [{ kind: 'price', quote: '$19', plan: 'STARTER' }] })[0].value.plan,
    ).toBe('Starter');
  });

  it('reads a quote where it doesn’t run into a number, near its plan, and a Turkish plan as written', () => {
    const page = 'Basic\n$499 per year\nPro\n$49 per month\nEnterprise\n$1,299 per month';
    expect(
      keptFacts(page, { facts: [{ kind: 'price', quote: '$49 per month', plan: 'Pro' }] })[0],
    ).toMatchObject({
      slot: 'price|pro|USD|month||',
      value_key: '49.00',
    });
    // "$1,2" isn't a price the page gives.
    expect(
      keptFacts(page, { facts: [{ kind: 'price', quote: '$1,2', plan: 'Enterprise' }] }),
    ).toEqual([]);
    const tr = 'İletişim\nİşletme ₺499/ay\nProfesyonel ₺999/ay';
    expect(
      keptFacts(tr, {
        facts: [
          { kind: 'price', quote: '₺499/ay', plan: 'İşletme' },
          { kind: 'price', quote: '₺999/ay', plan: 'Profesyonel' },
        ],
      }).map((f) => [f.value.plan, f.slot]),
    ).toEqual([
      ['İşletme', `price|${'İşletme'.toLowerCase()}|TRY|month||`],
      ['Profesyonel', 'price|profesyonel|TRY|month||'],
    ]);
  });

  it('reads a plan’s name as whole words, and no dollar of another mark as one', () => {
    expect(
      keptFacts('Product\nStarter $19 per month', {
        facts: [{ kind: 'price', quote: '$19 per month', plan: 'Pro' }],
      }),
    ).toEqual([]);
    expect(
      keptFacts('Pro\nC$49 per month', {
        facts: [{ kind: 'price', quote: '$49 per month', plan: 'Pro' }],
      }),
    ).toEqual([]);
    expect(
      keptFacts('Pro\n1 299 € par mois', {
        facts: [{ kind: 'price', quote: '299 € par mois', plan: 'Pro' }],
      }),
    ).toEqual([]);
  });

  it('finds words copied with straight marks, and keeps each fact once', () => {
    const curly = 'Ledgerly is the world’s first forecasting app — “built for finance teams”.';
    expect(
      keptFacts(curly, {
        facts: [
          { kind: 'claim', quote: "the world's first forecasting app", plan: null },
          { kind: 'claim', quote: 'the world’s first forecasting app', plan: null },
        ],
      }).map((f) => f.quote),
    ).toEqual(['the world’s first forecasting app']);
  });
});

describe('findFactPages', () => {
  const brand = {
    id: 'b1',
    site_type: 'b2b',
    domains: [{ domain: 'ledgerly.example', is_primary: true }],
  };

  it('takes the page list’s pages, the About page Site trust found, else the usual addresses', async () => {
    const { db } = fakeDb({
      site_pages: [
        {
          url: 'https://ledgerly.example/blog/pricing-news',
          title: 'Our pricing news',
          fetch_status: 200,
        },
        { url: 'https://ledgerly.example/pricing', title: 'Pricing · Ledgerly', fetch_status: 200 },
      ],
      site_trust: { checks: { about: { ok: true, url: 'https://ledgerly.example/company' } } },
    });
    const fetcher = vi.fn(async (url) => {
      if (url.endsWith('/pricing')) return { url, html: PRICING };
      if (url.endsWith('/company')) return { url, html: ABOUT };
      if (url.endsWith('/product'))
        return { url: 'https://ledgerly.example/', html: '<title>Ledgerly</title>' };
      if (url.endsWith('/features'))
        return { url, html: '<title>Features · Ledgerly</title><h1>Features</h1>' };
      throw new PageFetchError('http_error', '404', { status: 404 });
    });
    const pages = await findFactPages(brand, { db, fetcher });
    expect(pages.map((p) => [p.kind, p.status, p.url])).toEqual([
      ['pricing', 'ok', 'https://ledgerly.example/pricing'],
      ['about', 'ok', 'https://ledgerly.example/company'],
      // /product lands on the home page: not a product page.
      ['product', 'ok', 'https://ledgerly.example/features'],
    ]);
  });

  it('falls back to the usual addresses when a listed page is gone, and never reads the home page as one', async () => {
    const { db } = fakeDb({
      site_pages: [
        {
          url: 'https://ledgerly.example/old-pricing',
          title: 'Pricing · Ledgerly',
          fetch_status: 200,
        },
      ],
      site_trust: null,
    });
    const HOME = '<title>Ledgerly — plan your cash</title><h1>Plan your cash</h1>';
    const fetcher = vi.fn(async (url) => {
      if (url.endsWith('/old-pricing'))
        throw new PageFetchError('http_error', '404', { status: 404 });
      if (url.endsWith('/plans')) return { url, html: PRICING };
      // A site that answers every other address with its home page.
      return { url, html: HOME };
    });
    const pages = await findFactPages(brand, { db, fetcher });
    expect(pages.map((p) => [p.kind, p.status, p.url])).toEqual([
      ['pricing', 'ok', 'https://ledgerly.example/plans'],
      ['about', 'not_found', null],
      ['product', 'not_found', null],
    ]);
    // /pricing answered with the home page: not read as the pricing page.
    expect(fetcher.mock.calls.map(([url]) => url)).toContain('https://ledgerly.example/pricing');
  });

  it('reads nothing off the brand’s site, says a bot wall, and skips a shop’s product page', async () => {
    const { db } = fakeDb({ site_pages: [], site_trust: null });
    const fetcher = vi.fn(async (url) => {
      if (url.endsWith('/pricing'))
        return { url: 'https://elsewhere.example/pricing', html: PRICING };
      if (url.endsWith('/plans')) throw new PageFetchError('http_error', '403', { status: 403 });
      if (url.endsWith('/about')) return { url, html: '<title>Just a moment...</title>' };
      throw new PageFetchError('http_error', '404', { status: 404 });
    });
    const pages = await findFactPages({ ...brand, site_type: 'ecommerce' }, { db, fetcher });
    expect(pages.map((p) => [p.kind, p.status])).toEqual([
      ['pricing', 'blocked'],
      ['about', 'blocked'],
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).not.toContain(
      'https://ledgerly.example/product',
    );
  });
});

describe('refreshBrandFacts', () => {
  const base = (over = {}) => ({
    brands: { id: 'b1', site_type: 'b2b' },
    brand_domains: [{ domain: 'ledgerly.example', is_primary: true }],
    site_pages: [
      { url: 'https://ledgerly.example/pricing', title: 'Pricing · Ledgerly', fetch_status: 200 },
      { url: 'https://ledgerly.example/about', title: 'About us · Ledgerly', fetch_status: 200 },
    ],
    site_trust: null,
    brand_fact_pages: [],
    brand_facts: [],
    ...over,
  });
  const fetcher = vi.fn(async (url) => {
    if (url.endsWith('/pricing')) return { url, html: PRICING };
    if (url.endsWith('/about')) return { url, html: ABOUT };
    throw new PageFetchError('http_error', '404', { status: 404 });
  });
  const refresh = (db) => refreshBrandFacts('b1', { orgId: 'o1', now: NOW, db, fetcher });
  const writesOf = (writes, table, op) => writes.filter((w) => w.table === table && w.op === op);

  beforeEach(() => {
    generateObject.mockImplementation(async ({ prompt }) =>
      prompt.startsWith('Page: pricing')
        ? answerFor([
            { kind: 'price', quote: '$49 per month, billed monthly', plan: 'Pro' },
            { kind: 'trial', quote: '14-day free trial', plan: null },
          ])
        : answerFor([{ kind: 'founded', quote: 'founded in 2015', plan: null }]),
    );
  });

  it('reads each page’s facts as pending, on the budget as quality, and keeps the pages’ hashes', async () => {
    const { db, writes } = fakeDb(base());
    expect(await refresh(db)).toEqual({ noDomain: false, paused: false });
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(generateObject.mock.calls[0][0].system).toContain('not instructions to you');
    expect(generateObject.mock.calls[0][0].prompt).toMatch(
      /^Page: pricing page of ledgerly\.example\n\n/,
    );
    expect(reserves).toEqual([
      expect.objectContaining({ orgId: 'o1', feature: 'quality', holdUsd: FACTS_HOLD_USD }),
      expect.objectContaining({ orgId: 'o1', feature: 'quality', holdUsd: FACTS_HOLD_USD }),
    ]);
    expect(reserves[0].draftId).toBeUndefined();
    const [inserted] = writesOf(writes, 'brand_facts', 'upsert');
    expect(inserted.payload.map((f) => [f.kind, f.value_key, f.status, f.source_kind])).toEqual([
      ['price', '49.00', 'pending', 'pricing'],
      ['trial', '14', 'pending', 'pricing'],
      ['founded', '2015', 'pending', 'about'],
    ]);
    expect(inserted.options).toEqual({
      onConflict: 'brand_id,slot,value_key',
      ignoreDuplicates: true,
    });
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    expect(pages.payload.map((p) => [p.kind, p.status, p.text_hash])).toEqual([
      ['pricing', 'ok', factTextHash(factText(PRICING))],
      ['about', 'ok', factTextHash(factText(ABOUT))],
      ['product', 'not_found', null],
    ]);
  });

  it('sends no unchanged page to the model, and keeps its facts as seen', async () => {
    const { db, writes } = fakeDb(
      base({
        brand_fact_pages: [
          { kind: 'pricing', text_hash: factTextHash(factText(PRICING)), status: 'ok' },
          { kind: 'about', text_hash: factTextHash(factText(ABOUT)), status: 'ok' },
        ],
        brand_facts: [
          {
            id: 'a',
            slot: 'trial',
            value_key: '14',
            quote: '14-day free trial',
            status: 'approved',
            source_kind: 'pricing',
          },
        ],
      }),
    );
    await refresh(db);
    expect(generateObject).not.toHaveBeenCalled();
    expect(writesOf(writes, 'brand_facts', 'update')[0]).toMatchObject({
      payload: { gone_at: null },
      filters: [['in', 'id', ['a']]],
    });
  });

  it('keeps a changed value as a new pending fact, marks the approved one gone, and drops a gone pending one', async () => {
    const { db, writes } = fakeDb(
      base({
        brand_facts: [
          // The page said $59 before; it says $49 now.
          {
            id: 'old',
            slot: 'price|pro|USD|month|monthly|',
            value_key: '59.00',
            quote: '$59 per month',
            status: 'approved',
            source_kind: 'pricing',
          },
          {
            id: 'p',
            slot: 'trial',
            value_key: '30',
            quote: '30-day free trial',
            status: 'pending',
            source_kind: 'pricing',
          },
          // The model passed over it, but the page still says it.
          {
            id: 'kept',
            slot: 'claim|x',
            value_key: 'claim',
            quote: 'SOC 2 Type II certified',
            status: 'approved',
            source_kind: 'pricing',
          },
        ],
      }),
    );
    await refresh(db);
    expect(writesOf(writes, 'brand_facts', 'upsert')[0].payload.map((f) => f.value_key)).toEqual([
      '49.00',
      '14',
      '2015',
    ]);
    expect(writesOf(writes, 'brand_facts', 'update')).toEqual([
      expect.objectContaining({
        payload: { last_seen_at: expect.any(String), gone_at: null },
        filters: [['in', 'id', ['kept']]],
      }),
      expect.objectContaining({
        payload: { gone_at: expect.any(String) },
        filters: [['in', 'id', ['old']]],
      }),
    ]);
    expect(writesOf(writes, 'brand_facts', 'delete')[0].filters).toEqual([['in', 'id', ['p']]]);
  });

  it('stops at a spent budget, keeping the hash it had, and reads the page again next time', async () => {
    reserveError = new PlanLimitError('used up', 429);
    const { db, writes } = fakeDb(base());
    expect(await refresh(db)).toEqual({ noDomain: false, paused: true });
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    expect(pages.payload.slice(0, 2).map((p) => p.text_hash)).toEqual([null, null]);
    expect(writesOf(writes, 'brand_facts', 'upsert')).toEqual([]);
  });

  it('reads a missed page whose text changes by the model once an hour at most too', async () => {
    const recent = new Date(NOW - 10 * 60_000).toISOString();
    const { db, writes } = fakeDb(
      base({
        brand_fact_pages: [
          {
            kind: 'pricing',
            text_hash: 'aaaaaaaaaaaaaaaa',
            status: 'missed',
            extracted_at: recent,
          },
        ],
      }),
    );
    await refresh(db);
    expect(generateObject.mock.calls.map(([c]) => c.prompt.slice(0, 13))).toEqual([
      'Page: about p',
    ]);
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    expect(pages.payload[0]).toMatchObject({
      kind: 'pricing',
      status: 'missed',
      text_hash: 'aaaaaaaaaaaaaaaa',
      extracted_at: recent,
    });
  });

  it('charges an answer that missed the schema and reads that page again after a day; a timeout keeps its hold', async () => {
    generateObject.mockImplementation(async ({ prompt }) => {
      if (prompt.startsWith('Page: pricing')) {
        throw new NoObjectGeneratedError({
          message: 'no object',
          text: '{}',
          response: {},
          usage: { inputTokens: 800, outputTokens: 5 },
          finishReason: 'stop',
        });
      }
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    const { db, writes } = fakeDb(base());
    await refresh(db);
    expect(charge).toHaveBeenCalledWith({ inputTokens: 800, outputTokens: 5 });
    expect(keep).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(2);
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    expect(pages.payload.slice(0, 2).map((p) => [p.kind, p.status])).toEqual([
      ['pricing', 'missed'],
      ['about', 'failed'],
    ]);

    // Within the day, the missed page isn't sent again; after it, it is.
    const hash = factTextHash(factText(PRICING));
    const missed = (at) =>
      fakeDb(
        base({
          brand_fact_pages: [
            { kind: 'pricing', text_hash: hash, status: 'missed', extracted_at: at },
          ],
        }),
      );
    generateObject.mockReset().mockResolvedValue(answerFor([]));
    await refresh(missed(new Date(NOW - 3_600_000).toISOString()).db);
    expect(generateObject.mock.calls.map(([c]) => c.prompt.slice(0, 13))).toEqual([
      'Page: about p',
    ]);
    generateObject.mockClear();
    await refresh(missed(new Date(NOW - 2 * 86_400_000).toISOString()).db);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('keeps a fact the model passed over while a page has it, across a card’s lines or on another page', async () => {
    const product =
      '<title>Product · Ledgerly</title><h1>Product</h1><p>Start with a 14-day free trial.</p>' +
      `<p>${'Forecast every account in one place, every week of the year. '.repeat(4)}</p>`;
    const { db, writes } = fakeDb(
      base({
        site_pages: [
          {
            url: 'https://ledgerly.example/pricing',
            title: 'Pricing · Ledgerly',
            fetch_status: 200,
          },
          {
            url: 'https://ledgerly.example/product',
            title: 'Product · Ledgerly',
            fetch_status: 200,
          },
        ],
        brand_facts: [
          // "$19" and "per month" are a card's two lines.
          {
            id: 'starter',
            kind: 'price',
            slot: 'price|starter|USD|month||',
            value: { plan: 'Starter' },
            value_key: '19.00',
            quote: '$19 per month',
            status: 'approved',
            source_kind: 'pricing',
          },
          // Read from the pricing page, which says it no more; the product page does.
          {
            id: 'trial',
            kind: 'trial',
            slot: 'trial',
            value: { days: 14 },
            value_key: '14',
            quote: 'Start with a 14-day free trial',
            status: 'approved',
            source_kind: 'pricing',
          },
        ],
      }),
    );
    const fetch2 = vi.fn(async (url) => {
      if (url.endsWith('/pricing')) return { url, html: PRICING };
      if (url.endsWith('/product')) return { url, html: product };
      throw new PageFetchError('http_error', '404', { status: 404 });
    });
    generateObject.mockResolvedValue(answerFor([]));
    await refreshBrandFacts('b1', { orgId: 'o1', now: NOW, db, fetcher: fetch2 });
    const updates = writes.filter((w) => w.table === 'brand_facts' && w.op === 'update');
    expect(updates).toEqual([
      expect.objectContaining({
        payload: { last_seen_at: expect.any(String), gone_at: null },
        filters: [['in', 'id', ['starter', 'trial']]],
      }),
    ]);
  });

  it('says a page read again after a wall is read, and reads it then', async () => {
    const hash = factTextHash(factText(PRICING));
    const { db, writes } = fakeDb(
      base({
        brand_fact_pages: [
          { kind: 'pricing', text_hash: hash, status: 'blocked', extracted_at: null },
        ],
      }),
    );
    await refresh(db);
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    expect(pages.payload[0]).toMatchObject({ kind: 'pricing', status: 'ok' });
  });

  it('reads a changed page by the model once an hour at most', async () => {
    const recent = new Date(NOW - 10 * 60_000).toISOString();
    const { db, writes } = fakeDb(
      base({
        brand_fact_pages: [
          { kind: 'pricing', text_hash: 'aaaaaaaaaaaaaaaa', status: 'ok', extracted_at: recent },
        ],
      }),
    );
    await refresh(db);
    expect(generateObject.mock.calls.map(([c]) => c.prompt.slice(0, 13))).toEqual([
      'Page: about p',
    ]);
    // Its old hash kept: read after the hour.
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    expect(pages.payload[0]).toMatchObject({ kind: 'pricing', text_hash: 'aaaaaaaaaaaaaaaa' });
  });

  it('writes no page’s hash when its facts couldn’t be written', async () => {
    const { db, writes } = fakeDb(base());
    const failing = {
      from: (table) => {
        const chain = db.from(table);
        if (table !== 'brand_facts') return chain;
        return {
          ...chain,
          upsert: () => ({ then: (resolve) => resolve({ error: { message: 'too long' } }) }),
        };
      },
    };
    await expect(refresh(failing)).rejects.toThrow('too long');
    expect(writesOf(writes, 'brand_fact_pages', 'upsert')).toEqual([]);
  });

  it('leaves a short page’s facts as they are, read after read', async () => {
    const SHORT = '<title>Pricing · Ledgerly</title><h1>Pricing</h1><p>Loading…</p>';
    const hash = factTextHash(factText(SHORT));
    const { db, writes } = fakeDb(
      base({
        brand_fact_pages: [{ kind: 'pricing', text_hash: hash, status: 'ok' }],
        brand_facts: [
          {
            id: 'pro',
            kind: 'price',
            slot: 'price|pro|USD|month||',
            value: { plan: 'Pro' },
            value_key: '49.00',
            quote: '$49 per month',
            status: 'approved',
            source_kind: 'pricing',
          },
          {
            id: 'trial',
            kind: 'trial',
            slot: 'trial',
            value: { days: 14 },
            value_key: '14',
            quote: '14-day free trial',
            status: 'rejected',
            source_kind: 'pricing',
          },
        ],
      }),
    );
    const short = vi.fn(async (url) => {
      if (url.endsWith('/pricing')) return { url, html: SHORT };
      throw new PageFetchError('http_error', '404', { status: 404 });
    });
    await refreshBrandFacts('b1', { orgId: 'o1', now: NOW, db, fetcher: short });
    expect(writes.filter((w) => w.table === 'brand_facts')).toEqual([]);
  });

  it('keeps no missed answer’s hash past a failed read, and makes a failing page wait the hour', async () => {
    const hash = factTextHash(factText(PRICING));
    const walled = vi.fn(async (url) => {
      if (url.endsWith('/pricing')) throw new PageFetchError('http_error', '403', { status: 403 });
      throw new PageFetchError('http_error', '404', { status: 404 });
    });
    const missed = fakeDb(
      base({
        brand_fact_pages: [
          {
            kind: 'pricing',
            text_hash: hash,
            status: 'missed',
            extracted_at: new Date(NOW).toISOString(),
          },
        ],
      }),
    );
    await refreshBrandFacts('b1', { orgId: 'o1', now: NOW, db: missed.db, fetcher: walled });
    expect(writesOf(missed.writes, 'brand_fact_pages', 'upsert')[0].payload[0]).toMatchObject({
      status: 'blocked',
      text_hash: null,
    });

    generateObject.mockRejectedValue(new Error('provider down'));
    const { db, writes } = fakeDb(base());
    await refresh(db);
    expect(writesOf(writes, 'brand_fact_pages', 'upsert')[0].payload[0]).toMatchObject({
      status: 'failed',
      extracted_at: new Date(NOW).toISOString(),
    });
  });

  it('makes room for new facts from the ones going, keeps a full page’s old hash, and lets a kind no longer read go', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      kind: 'claim',
      slot: `claim|${i}`,
      value_key: 'claim',
      quote: `An old claim number ${i}`,
      status: i === 0 ? 'pending' : 'approved',
      source_kind: 'about',
    }));
    const { db, writes } = fakeDb(
      base({
        brands: { id: 'b1', site_type: 'ecommerce' },
        brand_fact_pages: [{ kind: 'pricing', text_hash: 'aaaaaaaaaaaaaaaa', status: 'ok' }],
        brand_facts: many,
      }),
    );
    await refresh(db);
    // c0 (pending, gone from the About page) makes room for one: the price.
    expect(writesOf(writes, 'brand_facts', 'delete')[0].filters).toEqual([['in', 'id', ['c0']]]);
    expect(writesOf(writes, 'brand_facts', 'upsert')[0].payload.map((f) => f.value_key)).toEqual([
      '49.00',
    ]);
    const [pages] = writesOf(writes, 'brand_fact_pages', 'upsert');
    // The trial didn't fit: the pricing page keeps its old hash, to be read again.
    expect(pages.payload.find((p) => p.kind === 'pricing').text_hash).toBe('aaaaaaaaaaaaaaaa');
    // Nor did the About page's founding year: it had no hash, and has none.
    expect(pages.payload.find((p) => p.kind === 'about').text_hash).toBeNull();
    // A shop's product page isn't looked for: its row goes.
    expect(writesOf(writes, 'brand_fact_pages', 'delete')[0].filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['not', 'kind', '(pricing,about)'],
    ]);
  });

  it('reads nothing for a brand with no domain', async () => {
    const { db } = fakeDb(base({ brand_domains: [] }));
    expect(await refresh(db)).toEqual({ noDomain: true, paused: false });
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe('readBrandFacts', () => {
  const tables = (over = {}) => ({
    brands: { id: 'b1', site_type: 'b2b' },
    brand_domains: [],
    brand_fact_pages: [
      {
        kind: 'pricing',
        url: 'https://ledgerly.example/pricing',
        status: 'ok',
        checked_at: new Date(NOW - 60_000).toISOString(),
      },
    ],
    brand_facts: [
      {
        id: 'a',
        kind: 'price',
        slot: 'price|pro|USD|month||',
        value: { amount: 49 },
        value_key: '49.00',
        quote: '$49',
        source_url: 'u',
        source_kind: 'pricing',
        status: 'approved',
        gone_at: '2026-10-20T00:00:00Z',
      },
      {
        id: 'b',
        kind: 'price',
        slot: 'price|pro|USD|month||',
        value: { amount: 59 },
        value_key: '59.00',
        quote: '$59',
        source_url: 'u',
        source_kind: 'pricing',
        status: 'pending',
        gone_at: null,
      },
    ],
    ...over,
  });

  it('answers as kept, each pending fact with the approved one it would replace', async () => {
    const { db } = fakeDb(tables());
    const read = await readBrandFacts('b1', { orgId: 'o1', now: NOW, db });
    expect(read.facts.map((f) => [f.id, f.status, f.gone, f.replaces?.id ?? null])).toEqual([
      ['a', 'approved', true, null],
      ['b', 'pending', false, 'a'],
    ]);
    expect(read.recheckAt).toBe(new Date(NOW - 60_000 + RECHECK_MS).toISOString());
    // Asked again within RECHECK_MS: still as kept, no read of the site.
    const { db: again } = fakeDb(tables());
    const fetcher = vi.fn();
    await readBrandFacts('b1', { orgId: 'o1', now: NOW, db: again, refresh: true, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never reads the site once the plan has ended: as kept, if anything is', async () => {
    const fetcher = vi.fn();
    const empty = fakeDb(tables({ brand_fact_pages: [], brand_facts: [], brand_domains: [] }));
    const none = await readBrandFacts('b1', {
      orgId: 'o1',
      now: NOW,
      db: empty.db,
      fetcher,
      keptOnly: true,
    });
    expect(none).toMatchObject({ facts: [], pages: [], checkedAt: null, noDomain: false });
    expect(empty.reads).not.toContain('brand_domains');

    const stale = fakeDb(
      tables({
        brand_fact_pages: [
          {
            kind: 'pricing',
            url: null,
            status: 'failed',
            checked_at: new Date(NOW - 60 * 60_000).toISOString(),
          },
        ],
      }),
    );
    const kept = await readBrandFacts('b1', {
      orgId: 'o1',
      now: NOW,
      db: stale.db,
      fetcher,
      refresh: true,
      keptOnly: true,
    });
    expect(kept.facts.map((f) => f.id)).toEqual(['a', 'b']);
    expect(stale.reads).not.toContain('brand_domains');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the site on the first ask, two asks at once once', async () => {
    const { db, reads } = fakeDb(tables({ brand_fact_pages: [], brand_domains: [] }));
    const [one, two] = await Promise.all([
      readBrandFacts('b1', { orgId: 'o1', now: NOW, db }),
      readBrandFacts('b1', { orgId: 'o1', now: NOW, db }),
    ]);
    expect(one.noDomain).toBe(true);
    expect(two.noDomain).toBe(true);
    expect(reads.filter((t) => t === 'brand_domains')).toHaveLength(1);
  });

  it('reads a page that didn’t answer again at the next ask, after a few minutes', async () => {
    const failed = (minutes) =>
      tables({
        brand_domains: [],
        brand_fact_pages: [
          {
            kind: 'pricing',
            url: null,
            status: 'failed',
            checked_at: new Date(NOW - minutes * 60_000).toISOString(),
          },
        ],
      });
    const soon = fakeDb(failed(2));
    await readBrandFacts('b1', { orgId: 'o1', now: NOW, db: soon.db });
    expect(soon.reads).not.toContain('brand_domains');
    const later = fakeDb(failed(11));
    await readBrandFacts('b1', { orgId: 'o1', now: NOW, db: later.db });
    expect(later.reads).toContain('brand_domains');
  });

  it('answers as kept without waiting on the site while a failed page is read again', async () => {
    const hanging = fakeDb(
      tables({
        brand_domains: [{ domain: 'ledgerly.example', is_primary: true }],
        brand_fact_pages: [
          {
            kind: 'pricing',
            url: null,
            status: 'failed',
            checked_at: new Date(NOW - 20 * 60_000).toISOString(),
          },
        ],
      }),
    );
    const never = vi.fn(() => new Promise(() => {}));
    const read = await readBrandFacts('b1', {
      orgId: 'o1',
      now: NOW + 1,
      db: hanging.db,
      fetcher: never,
    });
    expect(read.facts).toHaveLength(2);
  });
});

describe('setFactStatus', () => {
  it('approves as the member who did, and drops the approved ones in its slot gone from the site', async () => {
    const { db, writes } = fakeDb({});
    const fact = { id: 'f1', brand_id: 'b1', kind: 'price', slot: 'price|pro|USD|month||' };
    expect(await setFactStatus(fact, 'approved', 'u1', { db, now: NOW })).toEqual({
      id: 'f1',
      status: 'approved',
      reviewedAt: new Date(NOW).toISOString(),
    });
    expect(writes[0]).toMatchObject({
      op: 'update',
      payload: { status: 'approved', reviewed_by: 'u1' },
    });
    expect(writes[1]).toMatchObject({
      op: 'delete',
      filters: expect.arrayContaining([
        ['eq', 'slot', fact.slot],
        ['neq', 'id', 'f1'],
        ['not', 'gone_at', null],
      ]),
    });
    // A fact a read removed meanwhile.
    const { db: gone } = fakeDb({ brand_facts: null });
    await expect(
      setFactStatus(fact, 'approved', 'u1', { db: gone, now: NOW }),
    ).rejects.toMatchObject({
      status: 404,
    });
    // A rejection drops nothing.
    const { db: db2, writes: w2 } = fakeDb({});
    await setFactStatus(fact, 'rejected', 'u1', { db: db2, now: NOW });
    expect(w2.map((w) => w.op)).toEqual(['update']);
  });
});
