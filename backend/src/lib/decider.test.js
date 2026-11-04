import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { decide, isDeciderConfigured, DEFAULT_DECIDER_MODEL } = await import('./decider.js');

const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY;
const fetchMock = vi.fn();

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const QUESTIONS = { ok: { type: 'noul', instructions: 'Is it ok?' } };

describe('decide', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY;
  });

  it('posts the state and questions and returns the answers', async () => {
    fetchMock.mockResolvedValue(reply(200, { answers: { ok: { type: 'noul', noul: 0.9 } } }));

    const answers = await decide({ state: 'text', questions: QUESTIONS });

    expect(answers).toEqual({ ok: { type: 'noul', noul: 0.9 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body)).toEqual({
      model: DEFAULT_DECIDER_MODEL,
      state: 'text',
      questions: QUESTIONS,
    });
  });

  it('retries a rate-limited request after Retry-After', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(429, { error: 'slow down' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(reply(200, { answers: { ok: { noul: 0.1 } } }));

    expect(await decide({ state: 'text', questions: QUESTIONS })).toEqual({ ok: { noul: 0.1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a request the API rejects, with its status', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'bad question' }));

    await expect(decide({ state: 'text', questions: QUESTIONS })).rejects.toThrow(
      'Decisions API 400',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the response carries no answers', async () => {
    fetchMock.mockResolvedValue(reply(200, { model: 'x' }));

    await expect(decide({ state: 'text', questions: QUESTIONS })).rejects.toThrow('no answers');
  });

  it('needs an OpenRouter key', async () => {
    delete process.env.OPENROUTER_API_KEY;

    expect(isDeciderConfigured()).toBe(false);
    await expect(decide({ state: 'text', questions: QUESTIONS })).rejects.toThrow(
      'OPENROUTER_API_KEY',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps at most 8 requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return reply(200, { answers: {} });
    });

    await Promise.all(
      Array.from({ length: 20 }, () => decide({ state: 'text', questions: QUESTIONS })),
    );

    expect(peak).toBe(8);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});
