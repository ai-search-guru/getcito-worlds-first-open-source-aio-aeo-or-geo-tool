import { gzipSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import {
  LogTooLargeError,
  MAX_INFLATED_BYTES,
  MAX_LOG_LINES,
  readLogpushBody,
  readSenderBody,
  readVercelBody,
  readWorkerBody,
} from './botLogFormats.js';

/** What each AI-bot sender posts (AT-010, spec §6.1), read into one request shape. */

const logpushLine = (over = {}) =>
  JSON.stringify({
    ClientRequestUserAgent: 'Mozilla/5.0; compatible; GPTBot/1.2',
    ClientIP: '20.171.206.9',
    ClientRequestHost: 'acme.example',
    ClientRequestURI: '/menu?x=1',
    EdgeResponseStatus: 200,
    EdgeStartTimestamp: 1792400000000000000,
    ClientCountry: 'us',
    ...over,
  });

describe('readLogpushBody', () => {
  it('reads the http_requests fields, in any timestamp format', async () => {
    const text = [
      logpushLine(),
      logpushLine({ EdgeStartTimestamp: 1792400000 }),
      logpushLine({ EdgeStartTimestamp: '2026-10-19T09:00:00Z' }),
      '{not json',
      '',
    ].join('\n');
    const { records, requests } = await readLogpushBody(text);
    expect(records).toBe(3);
    expect(requests[0]).toEqual({
      userAgent: 'Mozilla/5.0; compatible; GPTBot/1.2',
      ip: '20.171.206.9',
      url: 'https://acme.example/menu?x=1',
      status: 200,
      at: '2026-10-19T08:53:20.000Z',
      country: 'us',
    });
    expect(requests[1].at).toBe('2026-10-19T08:53:20.000Z');
    expect(requests[2].at).toBe('2026-10-19T09:00:00.000Z');
  });

  it("reads Logpush's gzipped test upload as no requests", async () => {
    const parsed = await readSenderBody('cloudflare_logpush', gzipSync('{"content":"tests"}'));
    expect(parsed).toEqual({ records: 1, requests: [] });
  });

  it('opens a gzipped file by its magic bytes', async () => {
    const parsed = await readSenderBody(
      'cloudflare_logpush',
      gzipSync(`${logpushLine()}\n${logpushLine()}`),
    );
    expect(parsed.requests).toHaveLength(2);
  });
});

describe('readVercelBody', () => {
  const entry = (over = {}) => ({
    id: '1',
    source: 'static',
    host: 'acme.vercel.app',
    timestamp: 1792400000000,
    proxy: {
      timestamp: 1792400000500,
      method: 'GET',
      host: 'acme.example',
      path: '/gifts?ref=a',
      userAgent: ['Mozilla/5.0 (compatible; ClaudeBot/1.0)'],
      statusCode: 200,
      clientIp: '160.79.104.10',
      region: 'fra1',
    },
    ...over,
  });

  it('reads the request logs of a JSON array or NDJSON, and skips the rest', async () => {
    const build = { id: '2', source: 'build', message: 'Build completed' };
    const fromArray = await readVercelBody(JSON.stringify([entry(), build]));
    expect(fromArray.records).toBe(2);
    expect(fromArray.requests).toEqual([
      {
        userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
        ip: '160.79.104.10',
        url: 'https://acme.example/gifts?ref=a',
        status: 200,
        at: '2026-10-19T08:53:20.500Z',
        country: null,
      },
    ]);
    const fromLines = await readVercelBody(`${JSON.stringify(entry())}\n${JSON.stringify(build)}`);
    expect(fromLines).toEqual(fromArray);
  });
});

describe('readWorkerBody and unknown kinds', () => {
  it("reads a Worker's batch, and nothing from a malformed body or an unknown kind", async () => {
    expect(readWorkerBody('{"requests":[{"ip":"1.1.1.1"}]}')).toEqual({
      records: 1,
      requests: [{ ip: '1.1.1.1' }],
    });
    expect(readWorkerBody('{bad')).toEqual({ records: 0, requests: [] });
    expect(await readSenderBody('ftp', Buffer.from('x'))).toEqual({ records: 0, requests: [] });
    expect(await readSenderBody('vercel_drain', Buffer.alloc(0))).toEqual({
      records: 0,
      requests: [],
    });
  });
});

describe('a large or odd file', () => {
  it("doesn't read a file past its line or size limit", async () => {
    const lines = Array.from({ length: MAX_LOG_LINES + 1 }, () => '{}').join('\n');
    await expect(readLogpushBody(lines)).rejects.toBeInstanceOf(LogTooLargeError);
    // A small gzip that opens past the limit.
    const bomb = gzipSync(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20));
    await expect(readSenderBody('cloudflare_logpush', bomb)).rejects.toBeInstanceOf(
      LogTooLargeError,
    );
  });

  it('reads a file at the line limit, a slice at a time', async () => {
    const lines = Array.from({ length: MAX_LOG_LINES }, () => logpushLine()).join('\n');
    const parsed = await readLogpushBody(lines);
    expect(parsed.records).toBe(MAX_LOG_LINES);
    expect(parsed.requests).toHaveLength(MAX_LOG_LINES);
  });

  it('drops a line whose time is unreadable, not the file', async () => {
    const parsed = await readLogpushBody(
      [logpushLine(), logpushLine({ EdgeStartTimestamp: 1e30 })].join('\n'),
    );
    expect(parsed.records).toBe(2);
    expect(parsed.requests).toHaveLength(1);
    const vercel = await readVercelBody(
      JSON.stringify([
        { proxy: { clientIp: '1.2.3.4', userAgent: ['GPTBot'], path: '/', timestamp: 'never' } },
      ]),
    );
    expect(vercel).toEqual({ records: 1, requests: [] });
  });
});
