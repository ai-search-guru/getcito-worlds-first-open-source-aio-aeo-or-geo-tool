import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /cloro/callback once the brand's plan has ended (2026-10-27): the
 * answer is dropped on a fresh read only, and stored as usual when the plan
 * can't be read, so a paying brand's paid answer is never lost to a failed
 * read. Answered 200 at once either way.
 */

const PENDING = {
  task_id: 'task-1',
  scraper_id: 'chatgpt-web',
  prompt_id: 'prompt-1',
  brand_id: 'brand-1',
  region: 'US',
  legacy: false,
};
/** The pending row the delivery finds; a test may swap it. */
let pending = PENDING;

// What happened, in order: the tables read, the pending rows deleted, the
// answers handled.
const events = [];

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      events.push(['read', table]);
      const chain = {
        select: () => chain,
        eq: () => chain,
        delete: () => ({
          eq: async (column, value) => {
            events.push(['delete', table, value]);
            return { error: null };
          },
        }),
        insert: async (row) => {
          events.push(['insert', table, row]);
          return { error: null };
        },
        maybeSingle: async () => ({
          data:
            table === 'cloro_pending_tasks'
              ? pending
              : table === 'prompts'
                ? { text: 'best crm for startups' }
                : null,
        }),
        single: async () => ({ data: { id: 'brand-1', name: 'Acme' } }),
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));
const submitPromptTask = vi.fn();
vi.mock('../lib/cloroScraper.js', async (importOriginal) => ({
  isLegacyChatgptTask: (await importOriginal()).isLegacyChatgptTask,
  parseScraperResponse: () => ({ text: 'Acme is good.', citations: [], model: 'gpt' }),
  submitPromptTask: (...a) => submitPromptTask(...a),
}));
const handleScraperResult = vi.fn();
vi.mock('../lib/cloroResultHandler.js', () => ({
  handleScraperResult: (...a) => handleScraperResult(...a),
}));
vi.mock('../lib/cloroWebhookVerify.js', () => ({ verifyCloroWebhook: () => ({ ok: true }) }));
const isBrandActive = vi.fn();
const isBrandActiveCached = vi.fn();
vi.mock('../lib/activeSubscriptions.js', () => ({
  isBrandActive: (...a) => isBrandActive(...a),
  isBrandActiveCached: (...a) => isBrandActiveCached(...a),
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let server;
let url;

beforeAll(async () => {
  vi.stubEnv('CLORO_WEBHOOK_SECRET', '');
  vi.stubEnv('CLORO_WEBHOOK_URL', 'https://api.example.com/cloro/callback');
  const { default: router } = await import('./cloroCallback.js');
  const app = express();
  app.use('/cloro/callback', express.raw({ type: 'application/json' }));
  app.use((req, _res, next) => {
    req.log = log;
    next();
  });
  app.use('/cloro/callback', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/cloro/callback`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  return new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  events.length = 0;
  pending = PENDING;
  submitPromptTask.mockReset().mockResolvedValue({
    taskId: 'task-2',
    scraperId: 'chatgpt-web',
    legacy: false,
  });
  handleScraperResult.mockReset().mockImplementation(async () => {
    events.push(['handled']);
    return { inserted: true };
  });
  // On a plan unless a test says otherwise.
  isBrandActiveCached.mockReset().mockResolvedValue(true);
  isBrandActive.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(log)) fn.mockClear();
});

const deliver = (status = 'COMPLETED') =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: { id: 'task-1', status }, response: { ok: 1 } }),
  });

/** The callback answers first and works after: wait for the pending row to go. */
const settled = () =>
  vi.waitFor(() => expect(events.some(([kind]) => kind === 'delete')).toBe(true));

const deleted = () => events.filter(([kind]) => kind === 'delete');

describe('POST /cloro/callback once the plan has ended', () => {
  it('drops the answer on a fresh read, removing its pending row, and reads no more', async () => {
    isBrandActiveCached.mockResolvedValue(false);
    isBrandActive.mockResolvedValue(false);

    expect((await deliver()).status).toBe(200);
    await settled();

    expect(isBrandActive).toHaveBeenCalledWith('brand-1');
    expect(handleScraperResult).not.toHaveBeenCalled();
    expect(deleted()).toEqual([['delete', 'cloro_pending_tasks', 'task-1']]);
    // Not the brand, its domains or competitors: nothing to store them with.
    expect(events.map(([, table]) => table)).not.toContain('competitors');
  });

  it('stores it when a kept "inactive" is out of date: a plan was bought since', async () => {
    isBrandActiveCached.mockResolvedValue(false);
    isBrandActive.mockResolvedValue(true);

    await deliver();
    await settled();

    expect(handleScraperResult).toHaveBeenCalledTimes(1);
  });

  it('stores it on a kept "active", without a fresh read', async () => {
    await deliver();
    await settled();

    expect(handleScraperResult).toHaveBeenCalledTimes(1);
    expect(isBrandActive).not.toHaveBeenCalled();
  });

  it.each([
    ['the kept answer', () => isBrandActiveCached.mockRejectedValue(new Error('read: timeout'))],
    [
      'the fresh read',
      () => {
        isBrandActiveCached.mockResolvedValue(false);
        isBrandActive.mockRejectedValue(new Error('read: timeout'));
      },
    ],
  ])(
    'stores it as usual when %s fails: its pending row goes only once it is stored',
    async (_, failing) => {
      failing();

      await deliver();
      await settled();

      expect(handleScraperResult).toHaveBeenCalledTimes(1);
      const kinds = events.map(([kind]) => kind).filter((kind) => kind !== 'read');
      expect(kinds).toEqual(['handled', 'delete']);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ brandId: 'brand-1' }),
        'cloro callback: plan check failed; stored as usual',
      );
    },
  );
});

describe('POST /cloro/callback for a failed task', () => {
  it('sends a failed legacy ChatGPT task again without legacy, in its place (00378)', async () => {
    pending = { ...PENDING, region: 'US-CA', legacy: true };

    expect((await deliver('FAILED')).status).toBe(200);
    await settled();

    expect(submitPromptTask).toHaveBeenCalledWith({
      promptText: 'best crm for startups',
      promptId: 'prompt-1',
      scraperId: 'chatgpt-web',
      region: 'US-CA',
      webhookUrl: 'https://api.example.com/cloro/callback',
    });
    const writes = events.filter(([kind]) => kind !== 'read');
    expect(writes).toEqual([
      [
        'insert',
        'cloro_pending_tasks',
        {
          task_id: 'task-2',
          prompt_id: 'prompt-1',
          brand_id: 'brand-1',
          scraper_id: 'chatgpt-web',
          region: 'US-CA',
          legacy: false,
        },
      ],
      ['delete', 'cloro_pending_tasks', 'task-1'],
    ]);
    expect(handleScraperResult).not.toHaveBeenCalled();
  });

  it('only drops any other failed task', async () => {
    for (const row of [PENDING, { ...PENDING, scraper_id: 'copilot-web', legacy: true }]) {
      pending = row;
      events.length = 0;

      await deliver('FAILED');
      await settled();

      expect(events.filter(([kind]) => kind !== 'read')).toEqual([
        ['delete', 'cloro_pending_tasks', 'task-1'],
      ]);
    }
    expect(submitPromptTask).not.toHaveBeenCalled();
  });

  it('spends nothing more once the plan has ended', async () => {
    pending = { ...PENDING, legacy: true };
    isBrandActiveCached.mockResolvedValue(false);
    isBrandActive.mockResolvedValue(false);

    await deliver('FAILED');
    await settled();

    expect(submitPromptTask).not.toHaveBeenCalled();
    expect(deleted()).toEqual([['delete', 'cloro_pending_tasks', 'task-1']]);
  });

  it('still drops the failed row when the second submission fails', async () => {
    pending = { ...PENDING, legacy: true };
    submitPromptTask.mockRejectedValue(Object.assign(new Error('Cloro 503'), { status: 503 }));

    await deliver('FAILED');
    await settled();

    expect(deleted()).toEqual([['delete', 'cloro_pending_tasks', 'task-1']]);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'cloro callback: could not submit the failed fan-out task again',
    );
  });
});
