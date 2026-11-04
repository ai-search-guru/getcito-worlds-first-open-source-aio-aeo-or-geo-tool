import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /public/report-card (REPORT-CARD §8): only the form's origins may
 * read the answer, a body is at most 16 KB, and one address sends a few
 * requests an hour. What a request is answered with is intake.test.js's.
 */

const submit = vi.fn();
vi.mock('../lib/report-card/intake.js', () => ({
  submitReportCardRequest: (...args) => submit(...args),
}));
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { default: router } = await import('./publicReportCard.js');

let server;
let base;

beforeAll(async () => {
  process.env.REPORT_CARD_IP_HOURLY = '3';
  const app = express();
  app.set('trust proxy', 1);
  app.use('/public/report-card', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/public/report-card`;
});

afterAll(() => {
  delete process.env.REPORT_CARD_IP_HOURLY;
  server.close();
});

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ status: 200, body: { code: 'queued', domain: 'acme.example' } });
});

let address = 0;
/** Each test from its own address, so the hourly limit is the test's own. */
const from = () => `198.51.100.${++address}`;

const post = (body, { origin = 'https://www.getcito.com', ip = from(), type } = {}) =>
  fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': type ?? 'application/json',
      'X-Forwarded-For': ip,
      ...(origin ? { Origin: origin } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /public/report-card', () => {
  it('answers the form’s origin, with the code and the caller’s address for the bot check', async () => {
    const res = await post({ email: 'ayse@acme.example' }, { ip: '203.0.113.7' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.getcito.com');
    expect(await res.json()).toEqual({ code: 'queued', domain: 'acme.example' });
    expect(submit).toHaveBeenCalledWith({ email: 'ayse@acme.example' }, { ip: '203.0.113.7' });
  });

  it('passes the status on: 429 for the daily cap, 422 for a field', async () => {
    submit.mockResolvedValueOnce({ status: 429, body: { code: 'daily_cap' } });
    expect((await post({})).status).toBe(429);
    submit.mockResolvedValueOnce({ status: 422, body: { code: 'invalid', fields: {} } });
    expect((await post({})).status).toBe(422);
  });

  it('answers getcito.com’s preflight, and nobody else’s', async () => {
    const ok = await fetch(base, {
      method: 'OPTIONS',
      headers: { Origin: 'https://getcito.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://getcito.com');
    expect(ok.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');

    const other = await fetch(base, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a post from another site, before reading it', async () => {
    const res = await post({}, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'forbidden' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('reads a text/plain body as JSON, and answers a broken or large one as invalid', async () => {
    await post(JSON.stringify({ a: 1 }), { type: 'text/plain' });
    expect(submit).toHaveBeenCalledWith({ a: 1 }, expect.anything());
    expect((await post('{not json')).status).toBe(422);
    const large = await post({ note: 'x'.repeat(20_000) });
    expect(large.status).toBe(422);
    expect(await large.json()).toEqual({ code: 'invalid', fields: {} });
  });

  it('takes REPORT_CARD_IP_HOURLY requests an hour from one address', async () => {
    const ip = from();
    for (let i = 0; i < 3; i += 1) expect((await post({}, { ip })).status).toBe(200);
    const limited = await post({}, { ip });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ code: 'rate_limited' });
    expect((await post({}, { ip: from() })).status).toBe(200);
  });

  it('answers 500 with a plain code when the request fails', async () => {
    submit.mockRejectedValueOnce(new Error('db down'));
    const res = await post({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'error' });
  });
});
