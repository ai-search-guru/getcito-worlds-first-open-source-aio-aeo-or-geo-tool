import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));

const {
  BRAND_SETUP_LIMITS,
  SetupDailyLimitError,
  detectSiteType,
  generatePromptsFromTopics,
  suggestCompetitors,
  suggestFailure,
  suggestTopics,
} = await import('./aiBrandSetup');

/** Setup's suggestion calls send no more than the API takes (#1611 follow-up). */

const fetchMock = vi.fn();
const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ topics: [], topicPrompts: [], competitors: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const long = {
  brandName: 'A'.repeat(250),
  // A description kept on the brand from its settings, longer than setup takes.
  description: `${'d'.repeat(1999)}☕️ and more`,
  website: `${'w'.repeat(250)}.com`,
  language: 'en',
};

describe('the setup suggestion calls', () => {
  it('cut the brand to the lengths the API takes, never half an emoji', async () => {
    await suggestTopics(long);
    const body = sent();
    expect(body.brandName).toHaveLength(BRAND_SETUP_LIMITS.name);
    expect(body.website).toHaveLength(BRAND_SETUP_LIMITS.website);
    expect(body.description).toBe(`${'d'.repeat(1999)}☕`);

    // An emoji past the limit's last unit is left out whole, as the API counts.
    fetchMock.mockClear();
    await suggestTopics({ ...long, description: `${'d'.repeat(1999)}😀` });
    expect(sent().description).toBe('d'.repeat(1999));
  });

  it('leave a short brand and the topics as they are', async () => {
    await generatePromptsFromTopics(
      { brandName: 'Acme', description: 'Coffee', website: 'acme.com', language: 'en' },
      ['coffee subscriptions'],
    );
    expect(sent()).toMatchObject({
      brandName: 'Acme',
      description: 'Coffee',
      topics: ['coffee subscriptions'],
    });
    fetchMock.mockClear();
    await suggestCompetitors({ ...long, region: 'US' });
    expect(sent().description).toHaveLength(BRAND_SETUP_LIMITS.description);
  });
});

describe('prompts for many topics', () => {
  /** /prompts/from-topics as the API parses it: past its limits, a 400. */
  function api(_url: string, init: { body: string }) {
    const body = JSON.parse(init.body);
    const ok =
      body.topics.length >= 1 &&
      body.topics.length <= 20 &&
      body.brandName.length <= 200 &&
      (body.industry ?? '').length <= 200 &&
      (body.description ?? '').length <= 2000;
    return Promise.resolve({
      ok,
      status: ok ? 200 : 400,
      json: async () =>
        ok
          ? {
              topicPrompts: body.topics.map((topic: string) => ({
                topic,
                prompts: [`best ${topic}`],
              })),
            }
          : { error: 'Invalid request' },
    });
  }

  const topics = Array.from({ length: 21 }, (_, i) => `topic ${i + 1}`);

  it('asks for 21 topics in batches the API takes and returns every group in order', async () => {
    fetchMock.mockImplementation(api);
    const { topicPrompts } = await generatePromptsFromTopics(
      { ...long, industry: 'i'.repeat(250) },
      topics,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const batches = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).topics);
    expect(batches).toEqual([topics.slice(0, 20), topics.slice(20)]);
    expect(topicPrompts.map((group) => group.topic)).toEqual(topics);
    expect(topicPrompts[20]).toEqual({ topic: 'topic 21', prompts: ['best topic 21'] });

    // A brand's long description and industry are cut in every batch.
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body);
      expect(body.description).toBe(`${'d'.repeat(1999)}☕`);
      expect(body.industry).toHaveLength(BRAND_SETUP_LIMITS.industry);
    }
  });

  it('fails when a batch fails, and asks nothing for no topics', async () => {
    fetchMock.mockImplementation((url: string, init: { body: string }) =>
      JSON.parse(init.body).topics.includes('topic 21')
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        : api(url, init),
    );
    await expect(generatePromptsFromTopics(long, topics)).rejects.toThrow(
      'Failed to generate prompts',
    );

    fetchMock.mockClear();
    expect(await generatePromptsFromTopics(long, [])).toEqual({ topicPrompts: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Setup suggestions for a workspace that never subscribed are bounded a day
 * (429 `onboarding_daily_limit`): the onboarding steps say so, apart from any
 * other failure, which reads as before.
 */

const params = { brandName: 'Acme', description: '', website: 'acme.com', language: 'en' };
const answer = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe('setup suggestions past the daily limit', () => {
  const limit = { success: false, error: 'rate_limited', code: 'onboarding_daily_limit' };

  it('throws SetupDailyLimitError, read as "dailyLimit", from each of the three calls', async () => {
    vi.stubGlobal('fetch', answer(429, limit));
    const calls = [
      suggestTopics(params),
      generatePromptsFromTopics(params, ['Coffee']),
      suggestCompetitors(params),
    ];
    for (const call of calls) {
      const err = await call.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SetupDailyLimitError);
      expect(suggestFailure(err)).toBe('dailyLimit');
    }
  });

  it('keeps the usual message, so a caller that only shows it says what it said before', async () => {
    vi.stubGlobal('fetch', answer(429, limit));
    await expect(suggestTopics(params)).rejects.toThrow('Failed to suggest topics');
  });

  it('reads any other failure as before: a plain Error, "failed"', async () => {
    for (const [status, body] of [
      [500, { error: 'boom' }],
      [429, { error: 'rate_limited' }],
      [402, { code: 'onboarding_daily_limit' }],
    ] as const) {
      vi.stubGlobal('fetch', answer(status, body));
      const err = await suggestCompetitors(params).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SetupDailyLimitError);
      expect((err as Error).message).toBe('Failed to suggest competitors');
      expect(suggestFailure(err)).toBe('failed');
    }
  });

  it('returns the suggestions on success', async () => {
    vi.stubGlobal('fetch', answer(200, { topics: [{ name: 'Coffee' }] }));
    await expect(suggestTopics(params)).resolves.toEqual({ topics: ['Coffee'] });
  });
});

describe('detectSiteType', () => {
  it("asks the API to detect the brand's site type, signed in, and gives back what it kept", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ siteType: 'ecommerce', industry: 'E-commerce & Retail', via: 'page' }),
    });
    await expect(detectSiteType('b 1')).resolves.toEqual({
      siteType: 'ecommerce',
      industry: 'E-commerce & Retail',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/brands\/b%201\/detect-site-type$/);
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer token' } });
  });

  it("gives nulls when the type was chosen by hand or couldn't be told, or is one it doesn't know", async () => {
    for (const body of [
      { siteType: null, skipped: 'manual' },
      { siteType: null },
      { siteType: 'agency', industry: 7 },
    ]) {
      fetchMock.mockResolvedValue({ ok: true, json: async () => body });
      await expect(detectSiteType('b1')).resolves.toEqual({ siteType: null, industry: null });
    }
  });

  it('gives back Mobile app (00456)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ siteType: 'app', via: 'ai' }) });
    await expect(detectSiteType('b1')).resolves.toEqual({ siteType: 'app', industry: null });
  });

  it("throws SetupDailyLimitError past the day's setup calls", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: 'onboarding_daily_limit' }),
    });
    await expect(detectSiteType('b1')).rejects.toBeInstanceOf(SetupDailyLimitError);
  });
});
