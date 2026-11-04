import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { PageFetchError } = await import('../safeFetch.js');
const { reportCardLimits } = await import('./config.js');
const { FIELD_MESSAGES, siteOpens, submitReportCardRequest } = await import('./intake.js');

/**
 * The form's request answered (REPORT-CARD §4, §8), on a store kept in
 * memory: only made-up companies on the reserved .example domain.
 */

const NOW = new Date('2026-11-03T10:00:00Z');

const form = (patch = {}) => ({
  firstName: 'Ayşe',
  lastName: 'Yılmaz',
  title: 'Head of Marketing',
  email: 'ayse@acme.example',
  linkedinUrl: 'https://www.linkedin.com/in/ayse-yilmaz',
  companyName: 'Acme',
  website: 'acme.example',
  targetCountry: 'TR',
  companySize: '51-200',
  industry: 'ecommerce',
  dealValue: { amount: 120, currency: 'usd' },
  consentPrivacy: true,
  consentOwnSite: true,
  consentMarketing: false,
  botToken: 'token',
  page: 'free-ai-visibility-report',
  utm: { source: 'linkedin', medium: 'social', campaign: 'launch' },
  ...patch,
});

/** A store in memory: cards and requests, with what was asked of it. */
function memoryStore({ recent = null, spent = 0, pending = 0, perDay = [], taken = false } = {}) {
  const cards = [];
  const requests = [];
  let day = 0;
  return {
    cards,
    requests,
    recentCard: vi.fn(async () => recent),
    spendSince: vi.fn(async () => ({ spent, pending })),
    cardsStarting: vi.fn(async () => perDay[day++] ?? 0),
    insertCard: vi.fn(async (row) => {
      if (taken) return null;
      cards.push(row);
      return { id: `card-${cards.length}` };
    }),
    insertRequest: vi.fn(async (row) => {
      requests.push(row);
      return { id: `req-${requests.length}` };
    }),
  };
}

const deps = (store, patch = {}) => ({
  store,
  verifyBot: vi.fn(async () => 'pass'),
  opens: vi.fn(async () => true),
  limits: reportCardLimits({}),
  ...patch,
});

const submit = (body, store, patch) =>
  submitReportCardRequest(body, { ip: '203.0.113.9', now: NOW }, deps(store, patch));

describe('submitReportCardRequest', () => {
  it('queues a new card for the company and keeps the request', async () => {
    const store = memoryStore();
    expect(await submit(form(), store)).toEqual({
      status: 200,
      body: { code: 'queued', domain: 'acme.example' },
    });
    expect(store.cards).toEqual([
      {
        domain: 'acme.example',
        site: 'acme.example',
        company_name: 'Acme',
        country: 'TR',
        language: 'tr',
        run_after: NOW.toISOString(),
      },
    ]);
    expect(store.requests).toEqual([
      expect.objectContaining({
        report_card_id: 'card-1',
        outcome: 'queued',
        email: 'ayse@acme.example',
        linkedin_url: 'https://www.linkedin.com/in/ayse-yilmaz',
        company_size: '51-200',
        deal_value: 120,
        deal_currency: 'USD',
        consent_marketing: false,
        utm: { source: 'linkedin', medium: 'social', campaign: 'launch' },
      }),
    ]);
    // The address is for the bot check only: never kept.
    expect(JSON.stringify(store.requests)).not.toContain('203.0.113.9');
  });

  it('refuses a free e-mail before anything else', async () => {
    const store = memoryStore();
    const res = await submit(form({ email: 'ayse@gmail.com', website: 'gmail.com' }), store);
    expect(res).toEqual({ status: 422, body: { code: 'free_email', domain: 'gmail.com' } });
    expect(store.insertRequest).not.toHaveBeenCalled();
  });

  it('names each wrong field, and keeps nothing', async () => {
    const store = memoryStore();
    const res = await submit(
      form({
        firstName: '',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
        targetCountry: 'ZZ',
        companySize: 'lots',
        consentPrivacy: false,
      }),
      store,
    );
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: 'invalid',
      fields: {
        firstName: FIELD_MESSAGES.firstName,
        linkedinUrl: FIELD_MESSAGES.linkedinUrl,
        targetCountry: FIELD_MESSAGES.targetCountry,
        companySize: FIELD_MESSAGES.companySize,
        consentPrivacy: FIELD_MESSAGES.consentPrivacy,
      },
    });
    expect(store.insertRequest).not.toHaveBeenCalled();
  });

  it('refuses a website that isn’t the e-mail’s company', async () => {
    const res = await submit(form({ website: 'competitor.example' }), memoryStore());
    expect(res).toEqual({
      status: 422,
      body: {
        code: 'invalid',
        domain: 'acme.example',
        fields: { website: 'Use the website of the company in your work e-mail.' },
      },
    });
  });

  it('measures a subdomain the company names, and reads the form’s size as typed', async () => {
    const store = memoryStore();
    await submit(
      form({ website: 'https://www.shop.acme.example/', companySize: '501–1,000' }),
      store,
    );
    expect(store.cards[0]).toMatchObject({ domain: 'acme.example', site: 'shop.acme.example' });
    expect(store.requests[0].company_size).toBe('501-1000');
  });

  it('refuses a failed bot check, and every request where the check isn’t set up', async () => {
    const store = memoryStore();
    const failed = await submit(form(), store, { verifyBot: async () => 'fail' });
    expect(failed).toEqual({ status: 403, body: { code: 'bot_check', domain: 'acme.example' } });
    const off = await submit(form(), store, { verifyBot: async () => 'unconfigured' });
    expect(off.body.code).toBe('unavailable');
    expect(store.insertRequest).not.toHaveBeenCalled();
  });

  it('sends the company’s card from the last 30 days again, at no cost', async () => {
    const store = memoryStore({ recent: { id: 'card-old', status: 'ready' } });
    const opens = vi.fn();
    expect(await submit(form({ email: 'mehmet@acme.example' }), store, { opens })).toEqual({
      status: 200,
      body: { code: 'resent', domain: 'acme.example' },
    });
    expect(store.recentCard).toHaveBeenCalledWith('acme.example', new Date('2026-10-04T10:00:00Z'));
    expect(store.insertCard).not.toHaveBeenCalled();
    expect(opens).not.toHaveBeenCalled();
    expect(store.requests[0]).toMatchObject({ report_card_id: 'card-old', outcome: 'resent' });
  });

  it('adds a request to the card still being made', async () => {
    const store = memoryStore({ recent: { id: 'card-run', status: 'running' } });
    const res = await submit(form(), store);
    expect(res.body.code).toBe('queued');
    expect(store.requests[0]).toMatchObject({ report_card_id: 'card-run', outcome: 'queued' });
  });

  it('shares the card another request queued a moment before', async () => {
    const store = memoryStore({ taken: true });
    store.recentCard.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'card-twin' });
    const res = await submit(form(), store);
    expect(res.body.code).toBe('queued');
    expect(store.requests[0]).toMatchObject({ report_card_id: 'card-twin', outcome: 'queued' });
  });

  it('says so when the site can’t be opened, and keeps nothing', async () => {
    const store = memoryStore();
    const res = await submit(form(), store, { opens: async () => false });
    expect(res).toEqual({
      status: 422,
      body: { code: 'site_unreachable', domain: 'acme.example' },
    });
    expect(store.insertCard).not.toHaveBeenCalled();
  });

  it('makes the card the next morning once today’s are spent', async () => {
    const store = memoryStore({ perDay: [200, 3] });
    const res = await submit(form(), store);
    expect(res).toEqual({ status: 429, body: { code: 'daily_cap', domain: 'acme.example' } });
    expect(store.cards[0].run_after).toBe('2026-11-04T06:00:00.000Z');
    expect(store.requests[0].outcome).toBe('daily_cap');
  });

  it('takes no new card once the month’s budget would be passed', async () => {
    const store = memoryStore({ spent: 199.9, pending: 0 });
    const res = await submit(form(), store);
    expect(res).toEqual({ status: 503, body: { code: 'unavailable', domain: 'acme.example' } });
    expect(store.insertCard).not.toHaveBeenCalled();
  });

  it('keeps room in the budget for the cards still to run', async () => {
    const store = memoryStore({ spent: 150, pending: 160 });
    expect((await submit(form(), store)).body.code).toBe('unavailable');
  });
});

describe('siteOpens', () => {
  it('tries the site, then www., reading only the first bytes', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce({ html: '<html>' });
    expect(await siteOpens('acme.example', { fetcher })).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://acme.example/',
      'https://www.acme.example/',
    ]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ truncate: true, maxBytes: 65536 });
  });

  it('is false when neither opens', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('refused'));
    expect(await siteOpens('acme.example', { fetcher })).toBe(false);
  });

  it('opens when the site answers, even with an error or a page that is not HTML', async () => {
    for (const err of [
      new PageFetchError('http_error', 'The page answered 403', { status: 403 }),
      new PageFetchError('http_error', 'The page answered 503', { status: 503 }),
      new PageFetchError('not_html', 'The address is not a web page'),
      new PageFetchError('too_many_redirects', 'Too many redirects'),
    ]) {
      const fetcher = vi.fn().mockRejectedValue(err);
      expect(await siteOpens('acme.example', { fetcher })).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('is false when the site cannot be reached or is not allowed', async () => {
    for (const code of ['unreachable', 'timeout', 'blocked', 'invalid_url']) {
      const fetcher = vi.fn().mockRejectedValue(new PageFetchError(code, code));
      expect(await siteOpens('acme.example', { fetcher })).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
});
