import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI-bot requests from a brand's edge (AT-010, spec §6): each verified (user
 * agent + published ranges), then written within the month's cap; the
 * connection secret is stored only as its hash.
 */

const rpc = vi.fn();
let connectionRow = null;
// What a single-row read of each table finds.
let rows = {};
const selects = [];
vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: (...args) => rpc(...args),
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: (col, val) => {
          selects.push([col, val]);
          return chain;
        },
        maybeSingle: async () => ({
          data: table === 'ai_bot_connections' ? connectionRow : (rows[table] ?? null),
          error: null,
        }),
      };
      return chain;
    },
  },
}));
const getBotEventCap = vi.fn();
const getBotRawCap = vi.fn();
vi.mock('./planGuard.js', () => ({
  getBotEventCap: (...a) => getBotEventCap(...a),
  getBotRawCap: (...a) => getBotRawCap(...a),
}));
const warn = vi.fn();
vi.mock('./logger.js', () => ({ logger: { warn: (...a) => warn(...a) } }));

const { clearRangeCache } = await import('./aiBots.js');
const {
  MAX_BATCH,
  MAX_PRUNE_CALLS,
  PRUNE_BATCH,
  connectionForSecret,
  hashSecret,
  ingestBotRequests,
  ingestLogFile,
  logFileHash,
  logFileRead,
  newConnectionSecret,
  onBrandSite,
  pruneBotEvents,
  publicIngestEndpoint,
} = await import('./botIngest.js');

const NOW = Date.parse('2026-10-19T10:00:00.000Z');
const fetchImpl = vi.fn(async (url) => ({
  ok: true,
  json: async () => ({
    prefixes: [{ ipv4Prefix: url.includes('openai') ? '20.171.206.0/24' : '160.79.104.0/23' }],
  }),
}));
const connection = {
  id: 'c1',
  brandId: 'b1',
  kind: 'cloudflare_worker',
  organizationId: 'o1',
  domains: ['acme.example'],
};
const gpt = (over = {}) => ({
  userAgent: 'Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot',
  ip: '20.171.206.9',
  url: 'https://acme.example/menu?x=1',
  status: 200,
  at: '2026-10-19T09:58:00.000Z',
  country: 'us',
  ...over,
});

beforeEach(() => {
  clearRangeCache();
  rpc
    .mockReset()
    .mockResolvedValue({ data: { stored: 2, used: 2, crossed80: false }, error: null });
  getBotEventCap.mockReset().mockResolvedValue(2_000_000);
  getBotRawCap.mockReset().mockResolvedValue(20_000_000);
  warn.mockReset();
  fetchImpl.mockClear();
  selects.length = 0;
  rows = {};
});

describe('ingestBotRequests', () => {
  it('verifies each request and writes the bots within the cap', async () => {
    const result = await ingestBotRequests(
      connection,
      [
        gpt(),
        gpt({
          userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
          ip: '160.79.104.10',
          url: '/gifts',
        }),
        gpt({ ip: '8.8.8.8' }),
        gpt({ userAgent: 'Mozilla/5.0 Chrome/129' }),
        gpt({ at: '2026-10-01T00:00:00Z' }),
        { userAgent: 'GPTBot' },
      ],
      { fetchImpl, now: NOW },
    );
    expect(result).toEqual({
      received: 6,
      verified: 2,
      stored: 2,
      skipped: { invalid: 2, other_host: 0, unknown_agent: 1, unverified_ip: 1, no_ranges: 0 },
    });
    expect(getBotEventCap).toHaveBeenCalledWith('o1');
    expect(rpc).toHaveBeenCalledWith('ai_bot_ingest', {
      p_connection_id: 'c1',
      p_cap: 2_000_000,
      p_events: [
        {
          bot: 'gptbot',
          bot_type: 'training',
          page: 'https://acme.example/menu?x=1',
          status: 200,
          country: 'US',
          at: '2026-10-19T09:58:00.000Z',
        },
        {
          bot: 'claudebot',
          bot_type: 'training',
          page: '/gifts',
          status: 200,
          country: 'US',
          at: '2026-10-19T09:58:00.000Z',
        },
      ],
    });
  });

  it('writes nothing when no request verifies, and keeps a batch to its limit', async () => {
    const none = await ingestBotRequests(connection, [gpt({ ip: '1.1.1.1' })], {
      fetchImpl,
      now: NOW,
    });
    expect(none.stored).toBe(0);
    expect(rpc).not.toHaveBeenCalled();

    const many = await ingestBotRequests(
      connection,
      Array.from({ length: MAX_BATCH + 50 }, () => gpt({ ip: '9.9.9.9' })),
      { fetchImpl, now: NOW },
    );
    expect(many.received).toBe(MAX_BATCH);
  });

  it('writes nothing on a plan without the report', async () => {
    getBotEventCap.mockResolvedValue(0);
    const result = await ingestBotRequests(connection, [gpt()], { fetchImpl, now: NOW });
    expect(result).toMatchObject({ verified: 1, stored: 0, locked: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('raises the internal alert when a batch crosses 80% of the cap', async () => {
    rpc.mockResolvedValue({ data: { stored: 1, used: 1_600_000, crossed80: true }, error: null });
    await ingestBotRequests(connection, [gpt()], { fetchImpl, now: NOW });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'o1', used: 1_600_000, cap: 2_000_000 }),
      '[ai-bots] 80% of the monthly bot event cap reached',
    );
  });

  it('throws when the write fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(ingestBotRequests(connection, [gpt()], { fetchImpl, now: NOW })).rejects.toThrow(
      'boom',
    );
  });
});

// gkhngyk on #1180: a Logpush zone with several hostnames, or a team-wide
// Vercel drain, sent other sites' requests too.
describe("the brand's own site", () => {
  it('skips requests for other sites before verifying them', async () => {
    const result = await ingestBotRequests(
      { ...connection, domains: ['acme.example', 'https://www.acme-shop.example/'] },
      [
        gpt({ url: 'https://acme.example/menu' }),
        gpt({ url: 'https://blog.acme.example/beans' }),
        gpt({ url: 'https://acme-shop.example/cart' }),
        // A bare path comes from a Worker on the brand's own route.
        gpt({ url: '/gifts' }),
        gpt({ url: 'https://other.example/menu' }),
        gpt({ url: 'https://notacme.example/menu' }),
      ],
      { fetchImpl, now: NOW },
    );
    expect(result).toMatchObject({ received: 6, verified: 4 });
    expect(result.skipped).toMatchObject({ other_host: 2 });
    const pages = rpc.mock.calls[0][1].p_events.map((e) => e.page);
    expect(pages).toEqual([
      'https://acme.example/menu',
      'https://blog.acme.example/beans',
      'https://acme-shop.example/cart',
      '/gifts',
    ]);
  });

  it('reads every page of a brand with no domain stored', () => {
    expect(onBrandSite('https://other.example/', [])).toBe(true);
    expect(onBrandSite('https://other.example/', undefined)).toBe(true);
    expect(onBrandSite('https://ACME.example:8443/x', ['acme.example'])).toBe(true);
    expect(onBrandSite('https://acme.example.evil.com/', ['acme.example'])).toBe(false);
  });

  it("still counts other sites' records in a log file against the raw cap", async () => {
    rpc.mockResolvedValue({
      data: { received: 1, stored: 1, used: 1, crossed80: false, raw: 3 },
      error: null,
    });
    const drain = { ...connection, kind: 'vercel_drain' };
    const parsed = {
      records: 3,
      requests: [
        gpt(),
        gpt({ url: 'https://other.example/a' }),
        gpt({ url: 'https://x.example/' }),
      ],
    };
    const result = await ingestLogFile(drain, 'h9', parsed, { fetchImpl, now: NOW });
    expect(result).toMatchObject({ received: 3, verified: 1, skipped: { other_host: 2 } });
    const [, args] = rpc.mock.calls[0];
    expect(args.p_records).toBe(3);
    expect(args.p_events.map((e) => e.page)).toEqual(['https://acme.example/menu?x=1']);
  });
});

describe('connection secrets', () => {
  it('makes a fresh secret each time and finds a connection by its hash only', async () => {
    const a = newConnectionSecret();
    expect(a).toMatch(/^getcito_bot_[A-Za-z0-9_-]{43}$/);
    expect(newConnectionSecret()).not.toBe(a);

    connectionRow = {
      id: 'c1',
      brand_id: 'b1',
      kind: 'cloudflare_worker',
      revoked_at: null,
      brands: { organization_id: 'o1', brand_domains: [{ domain: 'acme.example' }] },
    };
    expect(await connectionForSecret(a)).toEqual(connection);
    expect(selects).toContainEqual(['secret_hash', hashSecret(a)]);

    connectionRow = { ...connectionRow, revoked_at: '2026-10-18T00:00:00Z' };
    expect(await connectionForSecret(a)).toBeNull();
    expect(await connectionForSecret('not-a-secret')).toBeNull();
  });
});

describe('ingestLogFile', () => {
  const drain = { ...connection, kind: 'vercel_drain' };
  const file = (requests, records = requests.length) => ({ records, requests });

  it('claims, counts and writes a whole file in one call', async () => {
    rpc.mockResolvedValue({
      data: { received: 520, stored: 520, used: 520, crossed80: false, raw: 600 },
      error: null,
    });
    const requests = Array.from({ length: 520 }, () => gpt());
    const result = await ingestLogFile(drain, 'h1', file(requests, 600), { fetchImpl, now: NOW });
    expect(result).toMatchObject({ received: 520, verified: 520, stored: 520 });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('ai_bot_ingest_file');
    expect(args).toMatchObject({
      p_connection_id: 'c1',
      p_body_hash: 'h1',
      p_records: 600,
      p_raw_cap: 20_000_000,
      p_cap: 2_000_000,
    });
    expect(args.p_events).toHaveLength(520);
  });

  it('answers a file read meanwhile as a duplicate', async () => {
    rpc.mockResolvedValue({ data: { duplicate: true }, error: null });
    expect(await ingestLogFile(drain, 'h1', file([gpt()]), { fetchImpl, now: NOW })).toEqual({
      received: 0,
      verified: 0,
      stored: 0,
      duplicate: true,
    });
  });

  it('only counts a file past the raw cap, without verifying it', async () => {
    rows.ai_bot_usage = { raw_records: 20_000_000 };
    rpc.mockResolvedValue({ data: { raw_capped: true, raw: 20_000_010 }, error: null });
    const result = await ingestLogFile(drain, 'h1', file([gpt()], 10), { fetchImpl, now: NOW });
    expect(result).toEqual({ received: 10, verified: 0, stored: 0, rawCapped: true });
    expect(rpc.mock.calls[0][1].p_events).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(selects).toContainEqual(['month', '2026-10-01']);
  });

  it('reads again once a raised plan lifts the cap above the month so far', async () => {
    rows.ai_bot_usage = { raw_records: 20_000_000 };
    getBotRawCap.mockResolvedValue(200_000_000);
    rpc.mockResolvedValue({ data: { stored: 1, used: 1, raw: 20_000_001 }, error: null });
    await ingestLogFile(drain, 'h1', file([gpt()]), { fetchImpl, now: NOW });
    expect(rpc.mock.calls[0][1].p_events).toHaveLength(1);
  });

  it('reads nothing on a plan without the report', async () => {
    getBotRawCap.mockResolvedValue(0);
    expect(await ingestLogFile(drain, 'h1', file([gpt()]), { fetchImpl, now: NOW })).toEqual({
      received: 1,
      verified: 0,
      stored: 0,
      locked: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('raises the internal alert, and throws when the write fails', async () => {
    rpc.mockResolvedValue({ data: { stored: 1, used: 1_600_000, crossed80: true }, error: null });
    await ingestLogFile(drain, 'h1', file([gpt()]), { fetchImpl, now: NOW });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ used: 1_600_000, cap: 2_000_000 }),
      '[ai-bots] 80% of the monthly bot event cap reached',
    );

    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(
      ingestLogFile(drain, 'h1', file([gpt()]), { fetchImpl, now: NOW }),
    ).rejects.toThrow('boom');
  });
});

describe('log file keys', () => {
  it("keys a file by its body's hash, and finds one read already", async () => {
    expect(logFileHash(Buffer.from('a'))).toBe(logFileHash(Buffer.from('a')));
    expect(logFileHash(Buffer.from('a'))).not.toBe(logFileHash(Buffer.from('b')));
    expect(await logFileRead(connection, 'h1')).toBe(false);
    rows.ai_bot_ingested_files = { body_hash: 'h1' };
    expect(await logFileRead(connection, 'h1')).toBe(true);
    expect(selects).toContainEqual(['body_hash', 'h1']);
  });
});

describe('pruneBotEvents', () => {
  it('deletes in batches until a call deletes fewer than a batch from every table', async () => {
    const full = { events: PRUNE_BATCH, daily: 10, files: 0 };
    rpc
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: { events: 3, daily: 0, files: 0 }, error: null });
    await pruneBotEvents(NOW);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('ai_bot_prune', {
      p_events_before: '2026-07-21T10:00:00.000Z',
      p_daily_before: '2025-09-14',
      p_files_before: '2026-10-12T10:00:00.000Z',
      p_limit: PRUNE_BATCH,
    });
  });

  it('stops after its call budget, and on an error', async () => {
    rpc.mockResolvedValue({ data: { events: 0, daily: PRUNE_BATCH, files: 0 }, error: null });
    await pruneBotEvents(NOW);
    expect(rpc).toHaveBeenCalledTimes(MAX_PRUNE_CALLS);
    expect(warn).toHaveBeenCalledWith(
      { calls: MAX_PRUNE_CALLS },
      '[ai-bots] prune stopped early; the rest goes tomorrow',
    );

    rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await pruneBotEvents(NOW);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('publicIngestEndpoint', () => {
  it("builds the endpoint from the API's public address, whatever its path", () => {
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'https://api.getcito.com/' })).toBe(
      'https://api.getcito.com/bots/ingest',
    );
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'https://api.example.com/v1' })).toBe(
      'https://api.example.com/bots/ingest',
    );
  });

  it('refuses no address, a plain-http one, and localhost in production', () => {
    expect(publicIngestEndpoint({})).toBeNull();
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'not a url' })).toBeNull();
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'http://api.example.com' })).toBeNull();
    expect(
      publicIngestEndpoint({ PUBLIC_SERVER_URL: 'http://localhost:80', NODE_ENV: 'production' }),
    ).toBeNull();
  });

  it('allows http on localhost while developing', () => {
    expect(
      publicIngestEndpoint({ PUBLIC_SERVER_URL: 'http://localhost:8082', NODE_ENV: 'development' }),
    ).toBe('http://localhost:8082/bots/ingest');
  });
});
