import { afterEach, describe, expect, it, vi } from 'vitest';

const { Response, ReadableStream } = globalThis;

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const cron = (await import('node-cron')).default;
const { setSyncedPrices, syncedCount } = await import('./modelPriceCache.js');
const {
  AUTO_MIX,
  CATALOG_URL,
  menuEntry,
  multiplierFor,
  multiplierLabel,
  rowOf,
  rowsOf,
  startModelPriceSync,
  syncModelPrices,
} = await import('./modelPrices.js');

/** The models' prices from OpenRouter's catalog, and the multipliers (CHAT-16 §A–B). */

afterEach(() => setSyncedPrices([]));

const NOW = new Date('2026-10-29T12:00:00Z');
const SYNCED = NOW.toISOString();

const model = (id, prompt, completion, extra = {}) => ({
  id,
  name: id,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  pricing: { prompt, completion, ...extra },
});

describe('rowOf', () => {
  it("keeps a model's prices per million tokens, its overrides as given, and its batch variant", () => {
    const haiku = rowOf(
      {
        id: 'anthropic/claude-haiku-5.5',
        name: 'Anthropic: Claude Haiku 5.5',
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        pricing: {
          prompt: '0.0000001',
          completion: '0.0000005',
          input_cache_read: '0.00000001',
          overrides: [{ min_prompt_tokens: 100000, prompt: '0.0000005', completion: '0.0000025' }],
        },
      },
      SYNCED,
    );
    expect(haiku).toEqual({
      model_id: 'anthropic/claude-haiku-5.5',
      name: 'Anthropic: Claude Haiku 5.5',
      provider: 'anthropic',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      input_per_m: expect.closeTo(0.1),
      output_per_m: expect.closeTo(0.5),
      cache_read_per_m: expect.closeTo(0.01),
      image_output_per_m: null,
      overrides: [{ min_prompt_tokens: 100000, prompt: '0.0000005', completion: '0.0000025' }],
      is_batch: false,
      supported_parameters: [],
      context_length: null,
      synced_at: SYNCED,
    });
    expect(
      rowOf(model('anthropic/claude-haiku-5.5:batch', '0.00000005', '0.00000025'), SYNCED),
    ).toMatchObject({ is_batch: true });
    expect(
      rowOf(
        model('google/gemini-3.1-flash-image', '0.0000005', '0.000003', {
          image_output: '0.00006',
        }),
        SYNCED,
      ).image_output_per_m,
    ).toBeCloseTo(60);
  });

  it('keeps what a model takes and its context window, for the model menu (00462)', () => {
    const row = rowOf(
      {
        ...model('anthropic/claude-sonnet-5.5', '0.000002', '0.00001'),
        supported_parameters: ['tools', 'reasoning', 7, 'structured_outputs'],
        context_length: 1000000,
      },
      SYNCED,
    );
    expect(row.supported_parameters).toEqual(['tools', 'reasoning', 'structured_outputs']);
    expect(row.context_length).toBe(1000000);
    const odd = rowOf(
      { ...model('x/y', '0', '0'), supported_parameters: 'tools', context_length: '12.5' },
      SYNCED,
    );
    expect(odd.supported_parameters).toEqual([]);
    expect(odd.context_length).toBeNull();
  });

  it('keeps no price for a variable-priced router, and no row without an id', () => {
    expect(rowOf(model('openrouter/auto', '-1', '-1'), SYNCED)).toMatchObject({
      input_per_m: null,
      output_per_m: null,
    });
    expect(rowOf({ name: 'nameless' }, SYNCED)).toBeNull();
    expect(rowsOf({ data: [model('a/b', '0', '0'), {}] }, SYNCED)).toHaveLength(1);
    expect(rowsOf(null, SYNCED)).toEqual([]);
  });
});

/** A database that keeps the upserts, and gives them back on a read. */
function fakeDb({ upsertError = null } = {}) {
  const table = new Map();
  const upserts = [];
  const reads = [];
  return {
    table,
    upserts,
    reads,
    from: () => ({
      upsert: async (rows, opts) => {
        upserts.push({ count: rows.length, opts });
        if (upsertError) return { error: { message: upsertError } };
        for (const r of rows) table.set(r.model_id, r);
        return { error: null };
      },
      select: () => ({
        order: () => ({
          range: async (from, to) => {
            reads.push([from, to]);
            const rows = [...table.values()].sort((x, y) => (x.model_id < y.model_id ? -1 : 1));
            return { data: rows.slice(from, to + 1), error: null };
          },
        }),
      }),
    }),
  };
}
const catalog = (n) => ({
  data: Array.from({ length: n }, (_, i) => model(`p/model-${i}`, '0.000001', '0.000002')),
});
const answer = (body, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('syncModelPrices', () => {
  it('reads the public catalog with no key, upserts every model in chunks and loads them', async () => {
    const db = fakeDb();
    const fetcher = answer(catalog(450));
    const result = await syncModelPrices({ fetcher, db, now: NOW });
    expect(result).toEqual({ ok: true, models: 450, syncedAt: SYNCED });
    expect(fetcher).toHaveBeenCalledWith(
      CATALOG_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
    expect(db.upserts.map((u) => u.count)).toEqual([200, 200, 50]);
    expect(db.upserts[0].opts).toEqual({ onConflict: 'model_id' });
    expect(db.table.get('p/model-7').synced_at).toBe(SYNCED);
    expect(syncedCount()).toBe(450);
  });

  it('writes nothing when the catalog fails, answers badly or lists too few models', async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw new Error('timeout');
      }),
      answer({}, 503),
      answer(catalog(12)),
    ]) {
      const db = fakeDb();
      const result = await syncModelPrices({ fetcher, db, now: NOW });
      expect(result.ok).toBe(false);
      expect(db.upserts).toEqual([]);
    }
  });

  it('writes nothing for a catalog over the size cap or with too many models', async () => {
    const big = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
            },
          }),
        ),
    );
    const db = fakeDb();
    const result = await syncModelPrices({ fetcher: big, db, now: NOW });
    expect(result).toMatchObject({ ok: false, error: 'catalog too large' });
    expect(db.upserts).toEqual([]);

    const declared = vi.fn(
      async () => new Response('{}', { headers: { 'content-length': String(64 * 1024 * 1024) } }),
    );
    expect(await syncModelPrices({ fetcher: declared, db, now: NOW })).toMatchObject({
      ok: false,
      error: 'catalog too large',
    });

    expect(await syncModelPrices({ fetcher: answer(catalog(5001)), db, now: NOW })).toMatchObject({
      ok: false,
      error: 'too_many_models',
    });
    expect(db.upserts).toEqual([]);
  });

  it('loads more rows than one read gives, a page at a time', async () => {
    const db = fakeDb();
    const result = await syncModelPrices({ fetcher: answer(catalog(2500)), db, now: NOW });
    expect(result.ok).toBe(true);
    expect(db.reads).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(syncedCount()).toBe(2500);
  });

  it('stops at an upsert that fails, keeping the prices it already had', async () => {
    setSyncedPrices([{ model_id: 'kept/model', input_per_m: 1, output_per_m: 2 }]);
    const result = await syncModelPrices({
      fetcher: answer(catalog(80)),
      db: fakeDb({ upsertError: 'db down' }),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, error: 'db down' });
    expect(syncedCount()).toBe(1);
  });
});

describe('startModelPriceSync', () => {
  afterEach(() => {
    vi.useRealTimers();
    cron.schedule.mockClear();
  });

  it('schedules the sync daily at 05:17 UTC, and a run stamps every model with today', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const db = fakeDb();
    const fetcher = answer(catalog(60));
    await startModelPriceSync({ schedule: undefined, db, fetcher });
    expect(cron.schedule).toHaveBeenCalledWith('17 5 * * *', expect.any(Function));
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-30T05:17:00Z'));
    cron.schedule.mock.calls[0][1]();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(db.table.get('p/model-0').synced_at).toBe('2026-10-30T05:17:00.000Z'),
    );
  });

  it("doesn't sync at start when the last sync is under a day old", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const db = fakeDb();
    db.table.set('p/model-0', { model_id: 'p/model-0', synced_at: '2026-10-29T05:17:00.000Z' });
    const fetcher = answer(catalog(60));
    await startModelPriceSync({ schedule: '0 3 * * *', db, fetcher });
    expect(cron.schedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));
    expect(fetcher).not.toHaveBeenCalled();
    expect(syncedCount()).toBe(1);
  });

  it('keeps the daily sync scheduled when the start throws', async () => {
    const db = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async () => {
              throw new Error('connection reset');
            },
          }),
        }),
      }),
    };
    await expect(startModelPriceSync({ db, fetcher: answer(catalog(60)) })).rejects.toThrow(
      'connection reset',
    );
    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });
});

describe('multipliers', () => {
  /** CHAT-16 item 8's fixture, 2026-10-18: price line in, badge out. */
  const FIXTURE = [
    ['anthropic/claude-sonnet-5.5', 2, 10, '2.3x'],
    ['anthropic/claude-opus-5.5', 4, 20, '4.7x'],
    ['openai/gpt-6.1-sol', 2, 10, '2.3x'],
    ['google/gemini-4-argon', 2, 10, '2.3x'],
    ['x-ai/grok-4.7', 2, 6, '1.7x'],
    ['google/gemini-3.8-flash', 0.83, 4.13, '1x'],
    ['mistralai/mistral-large-4', 0.68, 2.09, '0.6x'],
    ['anthropic/claude-haiku-5.5', 0.1, 0.5, '0.1x'],
    ['deepseek/deepseek-v4.1-flash', 0.07, 0.14, '<0.1x'],
  ];
  const rows = FIXTURE.map(([model_id, input_per_m, output_per_m]) => ({
    model_id,
    name: model_id,
    input_per_m,
    output_per_m,
    overrides: [],
  }));

  it("gives every badge of the fixture, with Auto's mix of Haiku and Sonnet at 1x", () => {
    setSyncedPrices(rows);
    for (const [id, , , badge] of FIXTURE)
      expect(multiplierLabel(multiplierFor(id, NOW)), id).toBe(badge);
    expect(Object.values(AUTO_MIX).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('labels with one decimal, no trailing ".0", and "<0.1x" below a tenth', () => {
    expect(multiplierLabel(1)).toBe('1x');
    expect(multiplierLabel(0.96)).toBe('1x');
    expect(multiplierLabel(2.33)).toBe('2.3x');
    expect(multiplierLabel(0.0999)).toBe('<0.1x');
  });

  it("has no multiplier until Auto's models are synced", () => {
    setSyncedPrices(rows.filter((r) => r.model_id !== 'anthropic/claude-haiku-5.5'));
    expect(multiplierFor('x-ai/grok-4.7', NOW)).toBeNull();
  });

  it('gives a menu entry with no price in it: dollars stay on the server', () => {
    setSyncedPrices(rows);
    const entry = menuEntry('x-ai/grok-4.7', NOW);
    expect(entry).toEqual({
      id: 'x-ai/grok-4.7',
      name: 'x-ai/grok-4.7',
      multiplier: '1.7x',
      variesByHour: false,
    });
    expect(JSON.stringify(entry)).not.toMatch(/per_m|input|output|\$|\b2\b|\b6\b/);
  });
});
