import http from 'node:http';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PageFetchError,
  checkPageUrl,
  fetchPage,
  isPublicAddress,
  publicOnlyLookup,
} from './safeFetch.js';

/**
 * Fetching a page a person names (Content Editor CE-003) must never reach a
 * private address, and stops at time, size and redirect limits.
 */

describe('isPublicAddress', () => {
  it('takes public addresses', () => {
    for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });

  it('refuses private, local, metadata, shared, reserved and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe('checkPageUrl', () => {
  it('takes http(s) on the web ports, without the fragment', () => {
    expect(checkPageUrl(' https://acme.example/pricing#plans ').toString()).toBe(
      'https://acme.example/pricing',
    );
    expect(checkPageUrl('http://acme.example:80/').protocol).toBe('http:');
  });

  it.each([
    ['ftp://acme.example/x'],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['https://user:pass@acme.example/'],
    ['https://acme.example:8443/'],
    ['not a url'],
  ])('refuses %s', (value) => {
    expect(() => checkPageUrl(value)).toThrow(PageFetchError);
  });
});

describe('fetchPage on the public-only lookup', () => {
  it('refuses a host that resolves to a private address, before any request', async () => {
    // Written as IPs, in any form the URL parser reads, they never reach a lookup.
    for (const address of [
      'http://localhost/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      await expect(fetchPage(address), address).rejects.toMatchObject({ code: 'blocked' });
    }
  });

  it('checks every address a name resolves to', async () => {
    const result = await new Promise((resolve) =>
      publicOnlyLookup('localhost', { all: true }, (err, addresses) => resolve({ err, addresses })),
    );
    expect(result.err).toBeInstanceOf(PageFetchError);
    expect(result.addresses).toBeUndefined();
  });
});

describe('fetchPage against a local site', () => {
  let server;
  let port;
  const routes = {
    '/page': (res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Pricing</h1><p>Plans ünd prices</p>');
    },
    '/hop': (res) => {
      res.writeHead(301, { location: '/page' });
      res.end();
    },
    '/loop': (res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    },
    '/to-ftp': (res) => {
      res.writeHead(302, { location: 'ftp://acme.example/' });
      res.end();
    },
    '/to-private': (res) => {
      res.writeHead(302, { location: 'http://localhost/admin' });
      res.end();
    },
    '/to-ip': (res) => {
      res.writeHead(302, { location: 'http://127.0.0.1/admin' });
      res.end();
    },
    '/gzip': (res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('<p>squeezed</p>'));
    },
    '/pdf': (res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end('%PDF');
    },
    '/feed.xml': (res) => {
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
      res.end('<rss version="2.0"><channel></channel></rss>');
    },
    '/missing': (res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('nope');
    },
    '/big': (res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('x'.repeat(5_000));
    },
    // Small on the wire, large once opened: the cap counts what's opened.
    '/big-gzip': (res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('x'.repeat(50_000)));
    },
    '/slow': (res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('late');
      }, 300);
    },
    // The connection drops part way through the body.
    '/cut': (res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': '1000' });
      res.write('<p>part');
      setTimeout(() => res.socket.destroy(), 10);
    },
    '/cut-gzip': (res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.write(zlib.gzipSync(`<p>${'x'.repeat(10_000)}</p>`).subarray(0, 40));
      setTimeout(() => res.socket.destroy(), 10);
    },
    // Nested deeper than a browser keeps: as a page, and as a text file.
    '/deep': (res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<div>'.repeat(600));
    },
    '/deep-text': (res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('<div>'.repeat(600));
    },
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => (routes[req.url] ?? routes['/missing'])(res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = String(server.address().port);
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // site.test is the local server; any other name goes through the real check.
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options.all;
    if (hostname !== 'site.test') return publicOnlyLookup(hostname, options, callback);
    return all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
  };
  const get = (path, opts = {}) =>
    fetchPage(`http://site.test:${port}${path}`, {
      lookup,
      ports: ['', '80', '443', port],
      ...opts,
    });

  it('reads a page as text, in its charset', async () => {
    await expect(get('/page')).resolves.toEqual({
      url: `http://site.test:${port}/page`,
      status: 200,
      html: '<h1>Pricing</h1><p>Plans ünd prices</p>',
    });
  });

  it('follows redirects to where they end, and says where that is', async () => {
    await expect(get('/hop')).resolves.toMatchObject({ url: `http://site.test:${port}/page` });
  });

  it('checks each redirect like the first address', async () => {
    await expect(get('/to-ftp')).rejects.toMatchObject({ code: 'invalid_url' });
    await expect(get('/to-private')).rejects.toMatchObject({ code: 'blocked' });
    await expect(get('/to-ip')).rejects.toMatchObject({ code: 'blocked' });
    await expect(get('/loop')).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  it('asks a caller’s own check of every address, the first one included, only when given', async () => {
    const seen = [];
    const allowUrl = (url) => {
      seen.push(url.pathname);
      return url.pathname !== '/page';
    };
    await expect(get('/hop', { allowUrl })).rejects.toMatchObject({
      code: 'not_allowed',
      message: 'The address is not one this read may open',
    });
    expect(seen).toEqual(['/hop', '/page']);
    await expect(get('/page', { allowUrl: () => false })).rejects.toMatchObject({
      code: 'not_allowed',
    });
    // Without one, nothing changes.
    await expect(get('/hop')).resolves.toMatchObject({ url: `http://site.test:${port}/page` });
  });

  it('never says a page’s own content type back', async () => {
    const refused = await get('/pdf').catch((err) => err);
    expect(refused).toMatchObject({ code: 'not_html', message: 'The address is not a web page' });
  });

  it('opens compressed pages', async () => {
    await expect(get('/gzip')).resolves.toMatchObject({ html: '<p>squeezed</p>' });
  });

  it('says why it brought nothing back', async () => {
    await expect(get('/pdf')).rejects.toMatchObject({ code: 'not_html' });
    await expect(get('/missing')).rejects.toMatchObject({ code: 'http_error', status: 404 });
    await expect(get('/big', { maxBytes: 1_000 })).rejects.toMatchObject({ code: 'too_large' });
    await expect(get('/slow', { timeoutMs: 50 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('turns away a web page nested deeper than any browser keeps, not another type', async () => {
    await expect(get('/deep')).rejects.toMatchObject({ code: 'too_deep' });
    await expect(get('/deep-text', { types: /^text\/plain/ })).resolves.toMatchObject({
      status: 200,
    });
  });

  it('reads another content type only when asked to', async () => {
    await expect(get('/feed.xml')).rejects.toMatchObject({ code: 'not_html' });
    await expect(
      get('/feed.xml', { types: /^\s*application\/xml\b/i, accept: 'application/xml' }),
    ).resolves.toMatchObject({ html: '<rss version="2.0"><channel></channel></rss>' });
  });

  it('fails a page cut off part way, compressed or not, instead of waiting for it', async () => {
    // Past its own timeout, a compressed page cut off would wait forever: the
    // request is already over, so the timeout has nothing left to stop.
    await expect(get('/cut', { timeoutMs: 2000 })).rejects.toMatchObject({ code: 'unreachable' });
    await expect(get('/cut-gzip', { timeoutMs: 2000 })).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('reads the start of a page over the cap when asked to, instead of refusing it', async () => {
    await expect(get('/big', { maxBytes: 1_000, truncate: true })).resolves.toMatchObject({
      status: 200,
      html: 'x'.repeat(1_000),
    });
    // Under the cap, the whole page, as without it.
    await expect(get('/page', { truncate: true })).resolves.toMatchObject({
      html: '<h1>Pricing</h1><p>Plans ünd prices</p>',
    });
  });

  it('counts a compressed page by what it opens to, refused or cut at the cap', async () => {
    await expect(get('/big-gzip', { maxBytes: 1_000 })).rejects.toMatchObject({
      code: 'too_large',
    });
    await expect(get('/big-gzip', { maxBytes: 1_000, truncate: true })).resolves.toMatchObject({
      status: 200,
      html: 'x'.repeat(1_000),
    });
  });
});
