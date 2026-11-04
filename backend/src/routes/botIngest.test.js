import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /bots/ingest (AT-010): a connection's secret, then its body read by
 * kind — a Worker's batch, a Vercel drain's entries or a Logpush file — with
 * a log sender's file written in one step (claim, raw count, events).
 */

const connectionForSecret = vi.fn();
const ingestBotRequests = vi.fn();
const ingestLogFile = vi.fn();
const logFileRead = vi.fn();
vi.mock('../lib/botIngest.js', () => ({
  connectionForSecret: (...a) => connectionForSecret(...a),
  ingestBotRequests: (...a) => ingestBotRequests(...a),
  ingestLogFile: (...a) => ingestLogFile(...a),
  logFileHash: () => 'hash-1',
  logFileRead: (...a) => logFileRead(...a),
}));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
const isOrgActiveCached = vi.fn();
const isOrgActive = vi.fn();
vi.mock('../lib/activeSubscriptions.js', () => ({
  isOrgActive: (...a) => isOrgActive(...a),
  isOrgActiveCached: (...a) => isOrgActiveCached(...a),
}));
vi.mock('../lib/planGuard.js', () => ({
  PlanLimitError: class PlanLimitError extends Error {
    constructor(message, statusCode = 403) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

const { default: router } = await import('./botIngest.js');
const { PlanLimitError } = await import('../lib/planGuard.js');
const { botIngestKey } = await import('../middleware/rateLimiter.js');
const { clearVerifiedTokens } = await import('../middleware/verifiedTokens.js');

let server;
let url;

beforeEach(async () => {
  clearVerifiedTokens();
  connectionForSecret.mockReset();
  // Every organization on a plan unless a test says otherwise.
  isOrgActiveCached.mockReset().mockResolvedValue(true);
  isOrgActive.mockReset().mockResolvedValue(true);
  ingestBotRequests
    .mockReset()
    .mockResolvedValue({ received: 0, verified: 0, stored: 0, skipped: {} });
  ingestLogFile.mockReset().mockResolvedValue({ received: 0, verified: 0, stored: 0, skipped: {} });
  logFileRead.mockReset().mockResolvedValue(false);
  const app = express();
  app.use(router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/bots/ingest`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (secret, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /bots/ingest', () => {
  it("ingests a Worker's batch for the connection its secret names", async () => {
    const connection = { id: 'c1', organizationId: 'o1', kind: 'cloudflare_worker' };
    connectionForSecret.mockResolvedValue(connection);
    ingestBotRequests.mockResolvedValue({ received: 1, verified: 1, stored: 1, skipped: {} });
    const res = await post('getcito_bot_x', {
      requests: [{ userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 1, records: 1 });
    expect(connectionForSecret).toHaveBeenCalledWith('getcito_bot_x');
    expect(ingestBotRequests).toHaveBeenCalledWith(connection, [
      { userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' },
    ]);
    expect(ingestLogFile).not.toHaveBeenCalled();
    expect(logFileRead).not.toHaveBeenCalled();
  });

  it("reads a Vercel drain's entries as one file, keyed by its body", async () => {
    const connection = { id: 'c2', organizationId: 'o1', kind: 'vercel_drain' };
    connectionForSecret.mockResolvedValue(connection);
    const entries = [
      {
        proxy: {
          clientIp: '1.2.3.4',
          userAgent: ['GPTBot'],
          host: 'acme.example',
          path: '/',
          statusCode: 200,
          timestamp: 1792400000000,
        },
      },
      { source: 'build', message: 'done' },
    ];
    const res = await post('getcito_bot_x', entries);
    expect(res.status).toBe(200);
    expect((await res.json()).records).toBe(2);
    const [conn, hash, parsed] = ingestLogFile.mock.calls[0];
    expect(conn).toBe(connection);
    expect(hash).toBe('hash-1');
    expect(parsed.records).toBe(2);
    expect(parsed.requests).toHaveLength(1);
    expect(ingestBotRequests).not.toHaveBeenCalled();

    // A capped or locked file is answered with 200, so the sender doesn't retry it.
    ingestLogFile.mockResolvedValue({ received: 2, verified: 0, stored: 0, rawCapped: true });
    const capped = await post('getcito_bot_x', entries);
    expect(capped.status).toBe(200);
    expect(await capped.json()).toMatchObject({ received: 2, stored: 0, rawCapped: true });
  });

  it("opens a Logpush job's gzipped file, and refuses an unreadable one", async () => {
    connectionForSecret.mockResolvedValue({
      id: 'c3',
      organizationId: 'o1',
      kind: 'cloudflare_logpush',
    });
    const ok = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer getcito_bot_x' },
      body: gzipSync('{"content":"tests"}'),
    });
    expect(ok.status).toBe(200);
    expect(ingestLogFile.mock.calls[0][2].records).toBe(1);

    const bad = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer getcito_bot_x' },
      body: Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]),
    });
    expect(bad.status).toBe(400);
  });

  it('reads a log file once: a resent one is answered without opening it', async () => {
    const connection = { id: 'c2', organizationId: 'o1', kind: 'vercel_drain' };
    connectionForSecret.mockResolvedValue(connection);
    const entries = [{ source: 'build', message: 'done' }];
    logFileRead.mockResolvedValue(true);
    const again = await post('getcito_bot_x', entries);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true, stored: 0 });
    expect(logFileRead).toHaveBeenCalledWith(connection, 'hash-1');
    expect(ingestLogFile).not.toHaveBeenCalled();
  });

  it('answers 500 when the write fails, leaving nothing for the retry to count twice', async () => {
    const connection = { id: 'c2', organizationId: 'o1', kind: 'vercel_drain' };
    connectionForSecret.mockResolvedValue(connection);
    ingestLogFile.mockRejectedValue(new Error('database down'));
    const entries = [
      {
        proxy: {
          clientIp: '1.2.3.4',
          userAgent: ['GPTBot'],
          host: 'acme.example',
          path: '/',
          statusCode: 200,
          timestamp: 1792400000000,
        },
      },
    ];
    expect((await post('getcito_bot_x', entries)).status).toBe(500);
    // The claim, count and events were one transaction: nothing to give back.
    expect(ingestLogFile).toHaveBeenCalledTimes(1);
  });

  it('answers 413 for a file past the line limit, without reading it', async () => {
    connectionForSecret.mockResolvedValue({
      id: 'c3',
      organizationId: 'o1',
      kind: 'cloudflare_logpush',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer getcito_bot_x' },
      body: gzipSync(Array.from({ length: 20_001 }, () => '{}').join('\n')),
    });
    expect(res.status).toBe(413);
    expect(ingestLogFile).not.toHaveBeenCalled();
  });

  it('refuses an unknown secret', async () => {
    connectionForSecret.mockResolvedValue(null);
    expect((await post('getcito_bot_bad', { requests: [] })).status).toBe(401);
    expect(ingestBotRequests).not.toHaveBeenCalled();
    expect(isOrgActiveCached).not.toHaveBeenCalled();
    // A made-up secret earns no bucket of its own.
    expect(
      botIngestKey({ headers: { authorization: 'Bearer getcito_bot_bad' }, ip: '1.1.1.1' }),
    ).toBe('ip:1.1.1.1');
  });

  /**
   * Once the plan has ended (2026-10-27): answered 200, so the customer's
   * edge neither breaks nor retries, with nothing read or stored.
   */
  it("stores nothing for an organization whose plan has ended, and doesn't read the file", async () => {
    isOrgActiveCached.mockResolvedValue(false);
    connectionForSecret.mockResolvedValue({
      id: 'c1',
      organizationId: 'o1',
      kind: 'cloudflare_worker',
    });
    const worker = await post('getcito_bot_x', {
      requests: [{ userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' }],
    });
    expect(worker.status).toBe(200);
    expect(await worker.json()).toEqual({ received: 0, verified: 0, stored: 0, inactive: true });
    expect(isOrgActiveCached).toHaveBeenCalledWith('o1');
    expect(ingestBotRequests).not.toHaveBeenCalled();

    connectionForSecret.mockResolvedValue({
      id: 'c3',
      organizationId: 'o1',
      kind: 'cloudflare_logpush',
    });
    const file = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer getcito_bot_x' },
      body: gzipSync('{"content":"tests"}'),
    });
    expect(file.status).toBe(200);
    expect(await file.json()).toMatchObject({ stored: 0, inactive: true });
    expect(logFileRead).not.toHaveBeenCalled();
    expect(ingestLogFile).not.toHaveBeenCalled();
  });

  it('answers the same when the plan ended within the remembered minutes, asked afresh', async () => {
    connectionForSecret.mockResolvedValue({
      id: 'c1',
      organizationId: 'o1',
      kind: 'cloudflare_worker',
    });
    ingestBotRequests.mockRejectedValue(new PlanLimitError('choose a plan', 402));
    isOrgActive.mockResolvedValue(false);
    const res = await post('getcito_bot_x', { requests: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 0, inactive: true });
    expect(isOrgActive).toHaveBeenCalledWith('o1');
  });

  it('answers 500, so the sender retries, when a plan that is on is refused', async () => {
    connectionForSecret.mockResolvedValue({
      id: 'c1',
      organizationId: 'o1',
      kind: 'cloudflare_worker',
    });
    ingestBotRequests.mockRejectedValue(new PlanLimitError('choose a plan', 402));
    const res = await post('getcito_bot_x', { requests: [] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'ingest_failed' });
    expect(isOrgActive).toHaveBeenCalledWith('o1');

    // A fresh read that fails too.
    isOrgActive.mockRejectedValue(new Error('organizations read: timeout'));
    expect((await post('getcito_bot_x', { requests: [] })).status).toBe(500);
  });

  it('answers 500, so the sender retries, when it cannot tell whether the plan has ended', async () => {
    isOrgActiveCached.mockRejectedValue(new Error('organizations read: timeout'));
    connectionForSecret.mockResolvedValue({
      id: 'c1',
      organizationId: 'o1',
      kind: 'cloudflare_worker',
    });
    expect((await post('getcito_bot_x', { requests: [] })).status).toBe(500);
    expect(ingestBotRequests).not.toHaveBeenCalled();
  });

  it("checks the secret before reading the body: an unknown one gets 401, not the body's 413", async () => {
    connectionForSecret.mockResolvedValue(null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer getcito_bot_bad' },
      body: Buffer.alloc(21 * 1024 * 1024),
    });
    expect(res.status).toBe(401);
    expect(logFileRead).not.toHaveBeenCalled();
  });

  it("gives a matched secret its connection's bucket for the next requests", async () => {
    connectionForSecret.mockResolvedValue({ id: 'c1', kind: 'cloudflare_worker' });
    const req = { headers: { authorization: 'Bearer getcito_bot_x' }, ip: '1.1.1.1' };
    expect(botIngestKey(req)).toBe('ip:1.1.1.1');
    expect((await post('getcito_bot_x', { requests: [] })).status).toBe(200);
    expect(botIngestKey(req)).toBe('bot:c1');
  });

  it('answers 500 when the secret lookup fails, without reading the body', async () => {
    connectionForSecret.mockRejectedValue(new Error('database down'));
    expect((await post('getcito_bot_x', { requests: [] })).status).toBe(500);
    expect(ingestBotRequests).not.toHaveBeenCalled();
  });
});
