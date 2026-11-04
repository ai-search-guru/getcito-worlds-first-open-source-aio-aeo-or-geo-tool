import http from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PageFetchError, publicOnlyLookup } from './safeFetch.js';
import { MAX_ANSWER_BYTES, checkWebhookUrl, isRedirect, postJson } from './safePost.js';

/**
 * Posting a content package to a workspace's webhook (Send to CMS, #1331)
 * must never reach a private address, follows no redirect, and stops at its
 * time limit, reading back only the start of an answer.
 */

describe('checkWebhookUrl', () => {
  it('takes http(s) on any port, as a workspace’s own automation listens on its own', () => {
    expect(checkWebhookUrl('https://hooks.zapier.com/hooks/catch/1/abc').hostname).toBe(
      'hooks.zapier.com',
    );
    expect(checkWebhookUrl('http://n8n.acme.example:5678/webhook/x').port).toBe('5678');
  });

  it.each([
    ['ftp://acme.example/x', 'invalid_url'],
    ['https://user:pass@acme.example/', 'invalid_url'],
    ['not a url', 'invalid_url'],
    ['http://127.0.0.1:8080/hook', 'blocked'],
    ['http://169.254.169.254/latest', 'blocked'],
    ['http://[::127.0.0.1]/hook', 'blocked'],
    ['http://[::ffff:0:127.0.0.1]/hook', 'blocked'],
  ])('refuses %s', (address, code) => {
    expect(() => checkWebhookUrl(address)).toThrow(expect.objectContaining({ code }));
  });

  // In a webhook's words on Cloud too, not a page's ("pages can be read").
  it.each([
    ['ftp://acme.example/x', 'Only http and https addresses can be posted to'],
    ['https://user:pass@acme.example/', 'URLs with credentials are not posted to'],
    ['https://user@acme.example/', 'URLs with credentials are not posted to'],
  ])('refuses %s in a webhook’s words, Cloud and self-hosted alike', (address, message) => {
    for (const privateOk of [false, true]) {
      expect(() => checkWebhookUrl(address, { privateOk })).toThrow(
        expect.objectContaining({ code: 'invalid_url', message }),
      );
    }
  });
});

describe('isRedirect', () => {
  it('takes a 3xx, and nothing either side of it', () => {
    expect([299, 300, 302, 308, 399, 400].map(isRedirect)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('postJson', () => {
  let server;
  let port;
  const received = [];
  const routes = {
    '/hook': (req, res, body) => {
      received.push({ headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    },
    '/teapot': (_req, res) => {
      res.writeHead(418);
      res.end('no');
    },
    '/moved': (_req, res) => {
      res.writeHead(302, { location: 'http://localhost/admin' });
      res.end();
    },
    '/moved-here': (_req, res) => {
      res.writeHead(307, { location: '/hook-v2?x=1' });
      res.end();
    },
    '/moved-nowhere': (_req, res) => {
      res.writeHead(301);
      res.end();
    },
    '/created': (_req, res) => {
      res.writeHead(201, { location: '/items/1' });
      res.end('made');
    },
    // The status and the start of the answer, then the connection drops.
    '/cut': (_req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('accepted');
      setTimeout(() => res.socket.destroy(), 20);
    },
    '/long': (_req, res) => {
      res.writeHead(200);
      res.end('x'.repeat(MAX_ANSWER_BYTES * 3));
    },
    '/slow': (_req, res) => setTimeout(() => res.end('late'), 300),
    // The status and the start of the answer, then nothing until the time limit.
    '/stalled': (_req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('accepted');
      setTimeout(() => res.end(), 300);
    },
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => routes[req.url](req, res, body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // site.test is the local server; any other name goes through the real check.
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options.all;
    if (hostname !== 'site.test') return publicOnlyLookup(hostname, options, callback);
    return all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
  };
  const post = (path, opts = {}) =>
    postJson(`http://site.test:${port}${path}`, '{"event":"content_draft.sent"}', {
      lookup,
      ...opts,
    });

  it('posts the JSON with its headers, and answers the status and the answer', async () => {
    await expect(post('/hook', { headers: { 'X-Webhook-Secret': 's3cret' } })).resolves.toEqual({
      status: 200,
      answer: '{"ok":true}',
    });
    const [last] = received.slice(-1);
    expect(last.body).toBe('{"event":"content_draft.sent"}');
    expect(last.headers['content-type']).toBe('application/json');
    expect(last.headers['x-webhook-secret']).toBe('s3cret');
  });

  it('answers a non-2xx and a redirect as they are, following none', async () => {
    await expect(post('/teapot')).resolves.toEqual({ status: 418, answer: 'no' });
    await expect(post('/moved')).resolves.toEqual({
      status: 302,
      answer: '',
      location: 'http://localhost/admin',
    });
  });

  it('says where a redirect points, as a full address, and only for a 3xx', async () => {
    await expect(post('/moved-here')).resolves.toEqual({
      status: 307,
      answer: '',
      location: `http://site.test:${port}/hook-v2?x=1`,
    });
    await expect(post('/moved-nowhere')).resolves.toEqual({ status: 301, answer: '' });
    await expect(post('/created')).resolves.toEqual({ status: 201, answer: 'made' });
  });

  it('keeps the status of an answer cut off after it, with what was read', async () => {
    await expect(post('/cut')).resolves.toEqual({ status: 200, answer: 'accepted' });
  });

  it('reads back only the start of a long answer', async () => {
    const { answer } = await post('/long');
    expect(answer.length).toBe(MAX_ANSWER_BYTES);
  });

  it('gives up on a slow webhook', async () => {
    await expect(post('/slow', { timeoutMs: 50 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('keeps a status that arrived before the time limit, with what was read (#1605)', async () => {
    await expect(post('/stalled', { timeoutMs: 100 })).resolves.toEqual({
      status: 200,
      answer: 'accepted',
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('never reaches a name that resolves to a private address on Cloud', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    const err = await postJson(`http://localhost:${port}/hook`, '{}').catch((e) => e);
    expect(err).toBeInstanceOf(PageFetchError);
    expect(err.code).toBe('blocked');
    await expect(postJson(`http://127.0.0.1:${port}/hook`, '{}')).rejects.toMatchObject({
      code: 'blocked',
    });
  });

  it('refuses another scheme or credentials in a webhook’s words on Cloud', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    await expect(postJson('ftp://acme.example/x', '{}')).rejects.toMatchObject({
      code: 'invalid_url',
      message: 'Only http and https addresses can be posted to',
    });
    await expect(postJson('https://user:pass@acme.example/', '{}')).rejects.toMatchObject({
      code: 'invalid_url',
      message: 'URLs with credentials are not posted to',
    });
  });

  it('reaches the workspace’s own network when self-hosted, as its other webhooks do', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    await expect(postJson(`http://127.0.0.1:${port}/hook`, '{}')).resolves.toMatchObject({
      status: 200,
    });
    expect(() => checkWebhookUrl('ftp://n8n:21/x', { privateOk: true })).toThrow(
      expect.objectContaining({ code: 'invalid_url' }),
    );
  });
});
