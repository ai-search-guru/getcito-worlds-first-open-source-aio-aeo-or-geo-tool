// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';

/**
 * A chat's kept reads (W1-19, CHAT-04 item 9): one key per read, its
 * arguments as the server scoped them; tracking data kept until the brand's
 * next run (a day at most), anything else a few minutes; writes never kept;
 * a failure never stops a read.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const cache = await import('./toolCache');

const CHAT = '33333333-3333-4333-8333-333333333333';
const BRAND = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-30T10:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

const parts = (over: Partial<Parameters<typeof cache.cacheKey>[0]> = {}) => ({
  tool: 'list_citations',
  input: { brand_id: BRAND, date_from: '2026-09-30', date_to: '2026-10-30', limit: 21 },
  brandId: BRAND,
  scope: { dates: 'default', platforms: null, rows: 20 },
  userId: 'person-1',
  role: 'admin',
  ...over,
});

const read = { value: { rows: [{ url: 'a' }] }, cut: false, injection: false, rows: 1 };

beforeEach(() => {
  db.tables = { chat_tool_cache: [], tracking_runs: [] };
  db.failures = {};
});

describe('cachePolicy', () => {
  it('keeps tracking data until the next run, a day at most, and live reads a few minutes', () => {
    expect(cache.cachePolicy({ name: 'list_citations', class: 'read' })).toEqual({
      maxAgeMs: 24 * 60 * 60 * 1000,
      untilRefresh: true,
    });
    expect(cache.cachePolicy({ name: 'list_prompts', class: 'read' })).toEqual({
      maxAgeMs: 5 * 60 * 1000,
      untilRefresh: false,
    });
  });

  it('never keeps a change, a go-live, opening a page or a web page’s words', () => {
    expect(cache.cachePolicy({ name: 'create_draft', class: 'write' })).toBeNull();
    expect(cache.cachePolicy({ name: 'publish_cms', class: 'execute' })).toBeNull();
    expect(cache.cachePolicy({ name: 'open_page', class: 'read' })).toBeNull();
    expect(cache.cachePolicy({ name: 'fetch_page', class: 'read' })).toBeNull();
  });
});

describe('cacheKey', () => {
  it('reads the same arguments the same way, in any order and spacing', () => {
    const key = cache.cacheKey(parts());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      cache.cacheKey(
        parts({
          input: {
            limit: 21,
            date_to: '2026-10-30 ',
            date_from: '2026-09-30',
            brand_id: BRAND,
            platform: '',
          },
        }),
      ),
    ).toBe(key);
    expect(cache.cacheKey(parts({ input: { ...parts().input, model: 'b, a' } }))).toBe(
      cache.cacheKey(parts({ input: { ...parts().input, model: 'a,b' } })),
    );
  });

  it('tells another tool, other dates, another brand, scope, person or role apart', () => {
    const key = cache.cacheKey(parts());
    for (const other of [
      parts({ tool: 'get_mentions_summary' }),
      parts({ input: { ...parts().input, date_from: '2026-10-01' } }),
      parts({ brandId: '22222222-2222-4222-8222-222222222222' }),
      parts({ scope: { dates: 'default', platforms: ['chatgpt-web'], rows: 20 } }),
      parts({ userId: 'person-2' }),
      parts({ role: 'analyst' }),
    ]) {
      expect(cache.cacheKey(other)).not.toBe(key);
    }
  });
});

describe('kept results', () => {
  const tracking = { maxAgeMs: cache.TRACKING_MAX_AGE_MS, untilRefresh: true };
  const live = { maxAgeMs: cache.LIVE_MAX_AGE_MS, untilRefresh: false };
  const KEY = 'a'.repeat(64);

  it('gives a kept read back, counts its hit, and replaces it when kept again', async () => {
    await cache.saveCached(
      CHAT,
      'list_citations',
      KEY,
      tracking,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    const kept = await cache.readCached(CHAT, 'list_citations', KEY, tracking, BRAND, later(1000));
    expect(kept).toEqual({ ...read, dataAsOf: null });
    expect(db.tables.chat_tool_cache[0]).toMatchObject({
      hits: 1,
      brand_id: BRAND,
      row_count: 1,
      expires_at: later(cache.TRACKING_MAX_AGE_MS).toISOString(),
    });
    await cache.saveCached(
      CHAT,
      'list_citations',
      KEY,
      tracking,
      BRAND,
      { ...read, rows: 2, dataAsOf: null },
      later(2000),
    );
    expect(db.tables.chat_tool_cache).toHaveLength(1);
    expect(db.tables.chat_tool_cache[0]).toMatchObject({ hits: 0, row_count: 2 });
  });

  it("drops tracking data once the brand's tracking ran after it was kept", async () => {
    await cache.saveCached(
      CHAT,
      'list_citations',
      KEY,
      tracking,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    db.tables.tracking_runs = [
      { id: 'old', brand_id: BRAND, completed_at: '2026-10-30T09:00:00.000Z' },
      { id: 'other', brand_id: 'another', completed_at: '2026-10-30T11:00:00.000Z' },
    ];
    expect(
      await cache.readCached(CHAT, 'list_citations', KEY, tracking, BRAND, later(1)),
    ).not.toBeNull();
    db.tables.tracking_runs.push({
      id: 'new',
      brand_id: BRAND,
      completed_at: '2026-10-30T10:30:00.000Z',
    });
    expect(
      await cache.readCached(CHAT, 'list_citations', KEY, tracking, BRAND, later(1)),
    ).toBeNull();
  });

  it('keeps a live read five minutes, tracking data a day', async () => {
    await cache.saveCached(
      CHAT,
      'list_prompts',
      KEY,
      live,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    expect(
      await cache.readCached(CHAT, 'list_prompts', KEY, live, BRAND, later(4 * 60_000)),
    ).not.toBeNull();
    expect(
      await cache.readCached(CHAT, 'list_prompts', KEY, live, BRAND, later(5 * 60_000)),
    ).toBeNull();

    await cache.saveCached(
      CHAT,
      'list_citations',
      KEY,
      tracking,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    expect(
      await cache.readCached(CHAT, 'list_citations', KEY, tracking, BRAND, later(23 * 3_600_000)),
    ).not.toBeNull();
    expect(
      await cache.readCached(CHAT, 'list_citations', KEY, tracking, BRAND, later(24 * 3_600_000)),
    ).toBeNull();
  });

  it('is only for its own chat, and a change drops the chat’s results', async () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    await cache.saveCached(
      CHAT,
      'list_prompts',
      KEY,
      live,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    await cache.saveCached(
      OTHER,
      'list_prompts',
      KEY,
      live,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    expect(await cache.readCached(OTHER, 'list_citations', KEY, live, BRAND, later(1))).toBeNull();
    await cache.dropCached(CHAT);
    expect(await cache.readCached(CHAT, 'list_prompts', KEY, live, BRAND, later(1))).toBeNull();
    expect(
      await cache.readCached(OTHER, 'list_prompts', KEY, live, BRAND, later(1)),
    ).not.toBeNull();
  });

  it('sweeps results past their time, in every chat, when it keeps one', async () => {
    db.tables.chat_tool_cache.push({
      conversation_id: 'old-chat',
      tool: 'list_prompts',
      scope_hash: KEY,
      expires_at: '2026-10-29T00:00:00.000Z',
    });
    await cache.saveCached(
      CHAT,
      'list_prompts',
      KEY,
      live,
      BRAND,
      { ...read, dataAsOf: null },
      NOW,
    );
    expect(db.tables.chat_tool_cache.map((r) => r.conversation_id)).toEqual([CHAT]);
  });

  it("doesn't keep a result too large for its column", async () => {
    const big = { ...read, value: { text: 'x'.repeat(cache.MAX_CACHED_CHARS) }, dataAsOf: null };
    await cache.saveCached(CHAT, 'list_prompts', KEY, live, BRAND, big, NOW);
    expect(db.tables.chat_tool_cache).toHaveLength(0);
  });

  it('never throws: a failing table is a read with nothing kept', async () => {
    db.failures.chat_tool_cache = { message: 'relation does not exist' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      cache.saveCached(CHAT, 'list_prompts', KEY, live, BRAND, { ...read, dataAsOf: null }, NOW),
    ).resolves.toBeUndefined();
    await expect(cache.readCached(CHAT, 'list_prompts', KEY, live, BRAND, NOW)).resolves.toBeNull();
    await expect(cache.dropCached(CHAT)).resolves.toBeUndefined();
    errors.mockRestore();
  });
});
