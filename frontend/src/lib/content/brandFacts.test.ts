import { describe, expect, it } from 'vitest';
import {
  brandFactsPath,
  factMismatches,
  factValueText,
  pagePrices,
  priceRanges,
  type BrandFact,
} from './brandFacts';

/** A brand fact's value as a person reads it (Quality CE-047). */
describe('factValueText', () => {
  it('writes a price in its currency, a trial’s days, a year, and a claim’s words', () => {
    const price = (amount: number, currency: string) => ({
      plan: 'Pro',
      amount,
      currency,
      period: 'month' as const,
      billed: null,
      per: null,
    });
    expect(factValueText('price', price(49, 'USD'))).toBe('$49');
    expect(factValueText('price', price(49.99, 'EUR'))).toBe('€49.99');
    expect(factValueText('price', price(499, 'TRY'))).toMatch(/^TRY\s499$/);
    expect(factValueText('trial', { days: 14 })).toBe('14');
    expect(factValueText('founded', { year: 2015 })).toBe('2015');
    expect(factValueText('claim', {}, 'SOC 2 certified')).toBe('SOC 2 certified');
    expect(brandFactsPath('b1')).toBe('/dashboard/brands/b1/settings?tab=facts');
  });
});

const approved = (over: Partial<BrandFact>): BrandFact => ({
  id: 'f',
  kind: 'price',
  value: {
    plan: 'Pro',
    amount: 49,
    currency: 'USD',
    period: 'month',
    billed: 'monthly',
    per: null,
  },
  quote: '$49 per month',
  sourceUrl: 'https://ledgerly.example/pricing',
  sourceKind: 'pricing',
  status: 'approved',
  reviewedAt: null,
  firstSeenAt: '2026-10-24T00:00:00Z',
  gone: false,
  replaces: null,
  ...over,
});
const price = (plan: string, amount: number, billed: 'monthly' | 'annually' | null = null) =>
  approved({
    id: `${plan}-${amount}`,
    value: { plan, amount, currency: 'USD', period: 'month', billed, per: null },
  });
const FACTS = [
  price('Free', 0),
  price('Starter', 19, 'monthly'),
  price('Starter', 15, 'annually'),
  price('Pro', 49, 'monthly'),
  price('Pro', 39, 'annually'),
  price('Team', 99),
  price('Business', 199),
  price('Growth', 299),
  approved({ id: 'trial', kind: 'trial', value: { days: 14 }, quote: '14-day free trial' }),
  approved({
    id: 'year',
    kind: 'founded',
    value: { year: 2015 },
    quote: 'Founded in 2015',
    sourceKind: 'about',
  }),
  // Not approved, or gone from the site: never compared.
  approved({
    id: 'p',
    status: 'pending',
    value: { plan: 'Pro', amount: 59, currency: 'USD', period: 'month', billed: null, per: null },
  }),
  approved({
    id: 'g',
    gone: true,
    value: { plan: 'Pro', amount: 69, currency: 'USD', period: 'month', billed: null, per: null },
  }),
];
const check = (sentences: string[], facts = FACTS) =>
  factMismatches({
    sentences,
    facts,
    brandName: 'Ledgerly',
    competitorDomains: ['northwind.example'],
  });

describe('pagePrices', () => {
  it('reads a price with its currency and period, and no scale, range or "off"', () => {
    expect(
      pagePrices('Pro costs $49 per month, or €45/mo in Europe.').map((p) => [p.text, p.period]),
    ).toEqual([
      ['$49', 'month'],
      ['€45', 'month'],
    ]);
    expect(pagePrices('Plans start at $19 a month.')[0]).toMatchObject({ amount: 19, from: true });
    expect(
      pagePrices('Teams raised $2M, get $5 off, paying $10–$20 or between $30 and $40.'),
    ).toEqual([]);
    expect(pagePrices('Pro coûte de 49 € à 99 € par mois, ou 49 TL ile 99 TL arası.')).toEqual([]);
    expect(pagePrices('1 299 € par an')[0]).toMatchObject({ amount: 1299, period: 'year' });
    // A dash after a plan's name isn't a range.
    expect(pagePrices('Pro – $49 per month')[0]).toMatchObject({ amount: 49 });
    expect(pagePrices('Since 2019 199 € per month')[0]).toMatchObject({ amount: 199 });
    // A currency after an amount isn't the next one's: "Ridge 28 $129" is $129;
    // one after its own amount stays with it.
    expect(pagePrices('Ridge 28 $129').map((p) => p.amount)).toEqual([129]);
    expect(pagePrices('129,00 € 159,00 €').map((p) => p.amount)).toEqual([129, 159]);
    expect(pagePrices('Pro 49 € 10 Nutzer').map((p) => p.amount)).toEqual([49]);
    // A code after a sign says whose dollar it is.
    expect(pagePrices('$129.00 CAD')[0]).toMatchObject({
      text: '$129.00 CAD',
      amount: 129,
      currency: 'CAD',
    });
    // With its ends, a range is read as two prices, for priceRanges' readers.
    expect(pagePrices('Ridge 28 – $129').map((p) => p.amount)).toEqual([]);
    expect(pagePrices('Ridge 28 – $129', { rangeEnds: true }).map((p) => p.amount)).toEqual([129]);
  });
});

describe('priceRanges', () => {
  it('reads a range’s two ends in one currency, and whether it is written as ranges are', () => {
    const ends = (sentence: string) =>
      priceRanges(sentence).map((r) => [r.low, r.high, r.currency, r.sure]);
    expect(ends('Paying $10–$20 or between $30 and $40.')).toEqual([
      [10, 20, 'USD', true],
      [30, 40, 'USD', true],
    ]);
    expect(ends('From $119-139, or 119–139 € in Europe.')).toEqual([
      [119, 139, 'USD', true],
      [119, 139, 'EUR', true],
    ]);
    expect(ends('De 49 € à 99 €, ou 49 TL ile 99 TL.')).toEqual([
      [49, 99, 'EUR', true],
      [49, 99, 'TRY', true],
    ]);
    // One currency with a spaced dash or a word may be a range, or a price beside a number.
    expect(ends('Preis: 119 – 139 €, $119 to 139, 999 - 1.299 TL')).toEqual([
      [119, 139, 'EUR', false],
      [119, 139, 'USD', false],
      [999, 1299, 'TRY', false],
    ]);
    // A name's number before a price, a number after one with a word: no range.
    expect(ends('Ridge 28 – $129')).toEqual([]);
    expect(ends('Only $19 - 100% organic cotton')).toEqual([]);
    expect(ends('$25-30-day returns, $5 a 12-pack')).toEqual([]);
    expect(ends('$129 – 150 reviews, €20 – 30 Tage Rückgaberecht')).toEqual([]);
    expect(ends('Kids 10-12 $129')).toEqual([]);
    // Two currencies, a scale, high before low: no range.
    expect(ends('$10–€20')).toEqual([]);
    expect(ends('Raised $1–$2M')).toEqual([]);
    expect(ends('$129 – 2 colors')).toEqual([]);
  });
});

describe('factMismatches', () => {
  it('names a plan’s price that differs, against any of its approved ones', () => {
    expect(check(['Ledgerly Pro costs $59 per month.'])).toEqual({
      compared: 1,
      mismatches: [
        {
          kind: 'price',
          page: '$59',
          fact: '$49',
          source: 'pricing',
          sentence: 'Ledgerly Pro costs $59 per month.',
        },
      ],
    });
    expect(
      check([
        'Ledgerly Pro is $49 per month.',
        'The Pro plan is $39/mo billed annually.',
        'The Starter plan is $19/month and the Pro plan $49/month.',
        'Ledgerly starts at $19 per month.',
      ]),
    ).toEqual({ compared: 5, mismatches: [] });
    expect(check(['The Pro plan costs $45 a month billed annually.']).mismatches[0]).toMatchObject({
      page: '$45',
      fact: '$39',
    });
  });

  it('cries no wolf on everyday copy', () => {
    expect(
      check([
        'Pro tip: budget $100 a month for ads.',
        'Our team spent $5,000 a month on ads.',
        'For a small business, expect to pay $30 per month for hosting.',
        'Growth agencies charge $5,000 a month.',
        'Get a free consultation worth $200.',
        'Start free, then pay $49 per month for Pro.',
        'Upgrades are pro-rated, so you pay $12 a month.',
        'We spent $2,000 a month on ads before switching.',
        'Most of our clients budget $1,000 a month for SEO.',
        'If you hire an agency, expect to pay $3,000 per month; with us it is less.',
        'Unlike Profound, which charges $499 a month, we start at $79.',
        'Pro is now $39/month (was $49).',
        'Ledgerly Pro: $39 a month instead of $49.',
        'Ledgerly Pro is €49 per month, €58.31 incl. VAT.',
        'The Pro plan includes $50 a month in ad credits.',
        'A 5-person team on Pro pays $245 a month.',
        'Pro is €45 per month in Europe.',
        'Northwind Pro costs $29 per month.',
        'HubSpot Starter costs $20 per month per seat.',
        'Ledgerly Pro costs $49 per month billed monthly.',
      ]),
    ).toMatchObject({ mismatches: [] });
  });

  it('ties a figure to the brand, not only to a sentence that names it (review, #1465)', () => {
    expect(
      check([
        // A price with no plan named: only right after the brand's name and a pricing verb.
        'If you hire an agency, expect to pay $3,000 per month; with Ledgerly it is less.',
        // A year the brand's data is about, not when it was founded.
        "Ledgerly's data shows startups founded in 2020 grew faster.",
        // Two trial lengths: another brand's beside the brand's.
        "Acme offers a free 15-day trial; Ledgerly's runs for 14 days.",
        // Each plan's own price: Business isn't found, its price isn't read.
        'The Pro plan is $49 a month, and Business is $199 a month.',
        // An add-on beside the plan's price.
        'The Pro plan is $49 per month, plus $10 per month for each extra seat.',
      ]),
    ).toMatchObject({ mismatches: [] });
    expect(
      check([
        // Another plan named beside the price's: which is whose isn't sure.
        'The Starter plan has fewer features, while the Pro plan is $49 a month.',
        'Unlike the Starter plan, the Pro plan costs $49 a month.',
        // More prices than plans named: which is whose isn't sure.
        'The Pro plan is $49/month or $39/month billed annually.',
        // Another brand's trial, in a part that doesn't name the brand.
        "Acme offers a free 15-day trial; Ledgerly's is longer.",
        // Another bill than the plan's.
        'Ledgerly setup costs $500 once.',
        'Ledgerly customer acquisition costs $45 on average.',
        'The Pro plan setup costs $500.',
        // Two prices with no plan named, or a plan between: which is whose isn't sure.
        'Ledgerly costs $29/month, or $24/month billed annually.',
        'The Pro plan, unlike the Starter plan, costs $49 a month.',
        // A partner's trial.
        'Ledgerly integrates with Acme, which offers a 30-day free trial.',
        // Someone else's founding, and quoted speech.
        'The agency that built Ledgerly was founded in 2009.',
        '“We were founded in 2018,” says Acme’s CEO.',
      ]),
    ).toMatchObject({ mismatches: [] });
    // Said of the brand, they're still read.
    expect(check(["Ledgerly's pricing starts at $25 per month."]).mismatches).toMatchObject([
      { kind: 'price', page: '$25' },
    ]);
    expect(
      check(['The Starter plan is $25 a month, and the Pro plan is $49 a month.']).mismatches,
    ).toMatchObject([{ kind: 'price', page: '$25', fact: '$19' }]);
    expect(check(["Ledgerly's trial runs for 30 days."]).mismatches).toMatchObject([
      { kind: 'trial', page: '30-day' },
    ]);
    expect(
      check(['Setup takes 3 days, and your free trial lasts 30 days.']).mismatches,
    ).toMatchObject([{ kind: 'trial', page: '30-day' }]);
    expect(check(['Since Ledgerly was founded in 2012, it has grown.']).mismatches).toMatchObject([
      { kind: 'founded', page: '2012' },
    ]);
    expect(check(['Ledgerly was founded in 2016.']).mismatches).toMatchObject([
      { kind: 'founded', page: '2016' },
    ]);
  });

  it('reads a plan’s price only right after its name, and no figure compared or saved (review 2, #1465)', () => {
    expect(
      check([
        'The Pro plan costs $30 more than Starter.',
        'Ledgerly Pro saves most teams $300 a month.',
        'Pro plan users invoice an average of $12,000 a month.',
        'Moving from Starter to the Pro plan adds $30 a month.',
        'Team leads at Ledgerly approve $40,000 a month in expenses.',
        'Ledgerly costs $20 less per month than most bookkeeping apps.',
        // A trial that's another's before the brand's name, or files and support kept free.
        "Unlike Acme's 30-day trial, Ledgerly's needs no credit card.",
        'Unlike Acme, which offers a 30-day trial, Ledgerly gives you 14 days free.',
        'Ledgerly keeps your files free for 30 days after you cancel.',
        'Every plan includes priority support free for 30 days.',
        // "We" after a colon: someone quoted without quote marks.
        "Acme's CEO told us: we were founded in 2018 to fix bookkeeping.",
      ]),
    ).toEqual({ compared: 0, mismatches: [] });
    // Right after the plan's name, with a colon, a dash or "(", they're still read.
    expect(
      check([
        'Ledgerly Pro: $59 a month.',
        'Ledgerly Pro – $59 per month.',
        'Ledgerly Pro ($59/month).',
      ]).mismatches,
    ).toMatchObject([
      { kind: 'price', page: '$59' },
      { kind: 'price', page: '$59' },
      { kind: 'price', page: '$59' },
    ]);
    expect(check(['Try Ledgerly free for 3 weeks.']).mismatches).toMatchObject([
      { kind: 'trial', page: '21-day' },
    ]);
    expect(check(['Ledgerly is free for 30 days during the trial.']).mismatches).toMatchObject([
      { kind: 'trial', page: '30-day' },
    ]);
    expect(check(['Since 2014: we were founded in 2014.']).mismatches).toEqual([]);
    expect(check(['After years of planning, we were founded in 2018.']).mismatches).toEqual([]);
    expect(check(['We were founded in 2018 in Lisbon.']).mismatches).toMatchObject([
      { kind: 'founded', page: '2018' },
    ]);
  });

  it('compares a trial only where it is the brand’s, its days beside it', () => {
    expect(check(['Every plan has a 30-day free trial.']).mismatches).toEqual([
      {
        kind: 'trial',
        page: '30-day',
        fact: '14-day',
        source: 'pricing',
        sentence: 'Every plan has a 30-day free trial.',
      },
    ]);
    expect(
      check([
        'Every plan comes with a 30-day money-back guarantee and a free trial.',
        'In a 12-week clinical trial, patients improved.',
        'We ran a 90-day trial of the new workflow.',
        'Setup takes 3 days, and your free trial lasts 14 days.',
        'Help Scout offers a free 15-day trial.',
        'Try Ledgerly free for 2 weeks.',
      ]).mismatches,
    ).toEqual([]);
  });

  it('compares a founding year only right after "founded", said of the brand', () => {
    expect(check(['Ledgerly was founded in 2012.']).mismatches).toEqual([
      {
        kind: 'founded',
        page: '2012',
        fact: '2015',
        source: 'about',
        sentence: 'Ledgerly was founded in 2012.',
      },
    ]);
    expect(
      check([
        'In 2023, we celebrated 10 years since Ledgerly was founded.',
        'Our data shows startups founded in 2020 grew faster.',
        'In 2022 we established a new baseline.',
        'We helped Acme Bank (founded 1998) grow.',
        'We were founded in 2015 in Lisbon.',
      ]).mismatches,
    ).toEqual([]);
  });

  it('reads each sentence once', () => {
    const same = 'Every plan has a 30-day free trial.';
    expect(check([same, same, same])).toMatchObject({ compared: 1 });
    expect(check(['Ledgerly Pro costs $59 per month.'], [])).toEqual({
      compared: 0,
      mismatches: [],
    });
  });
});
