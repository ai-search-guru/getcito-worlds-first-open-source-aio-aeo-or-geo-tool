import { createHash } from 'node:crypto';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';

// The real client needs the service key; each test passes its own.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { PageFetchError, fetchPage, publicOnlyLookup } = await import('./safeFetch.js');
const {
  CHECK_TTL_MS,
  HOURLY_READS,
  LINK_MAX_BYTES,
  MAX_LINKS,
  UNKNOWN_TTL_MS,
  checkLinks,
  linkStatus,
  pageDate,
  readableLink,
  reserveReads,
} = await import('./linkCheck.js');

/**
 * A saved draft's links for Trust (Quality spec §2.2): each read once a day
 * across the server, as working, broken or unknown, with its page's own date.
 */

const NOW = Date.parse('2026-10-23T12:00:00Z');
const hashOf = (url) => createHash('sha256').update(url).digest('hex');

/** content_link_checks, as the server reads, writes and prunes it. */
function fakeDb(rows = [], { readError = null } = {}) {
  const upserts = [];
  const deletes = [];
  const db = {
    from: () => {
      const query = {};
      const chain = {
        select: () => chain,
        in: (column, values) => {
          query.in = values;
          return chain;
        },
        gte: async (column, value) =>
          readError
            ? { data: null, error: readError }
            : {
                data: rows.filter((r) => query.in.includes(hashOf(r.url)) && r.checked_at >= value),
                error: null,
              },
        upsert: async (values) => {
          upserts.push(...values);
          return { error: null };
        },
        delete: () => chain,
        lt: async (column, value) => {
          deletes.push(value);
          return { error: null };
        },
      };
      return chain;
    },
  };
  return { db, upserts, deletes };
}

const page = (url, html = '') => ({ url, status: 200, html });
const silent = { error: vi.fn() };
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('linkStatus', () => {
  it('reads a page or a file as working', () => {
    expect(linkStatus(null)).toBe('ok');
    expect(linkStatus(new PageFetchError('not_html', 'a PDF'))).toBe('ok');
    expect(linkStatus(new PageFetchError('too_large', 'big'))).toBe('ok');
    expect(linkStatus(new PageFetchError('too_deep', 'nested'))).toBe('ok');
  });

  it('reads a gone page, or a site that is nowhere, as broken', () => {
    for (const status of [404, 410, 451]) {
      expect(linkStatus(new PageFetchError('http_error', 'x', { status }))).toBe('broken');
    }
    for (const errno of ['ENOTFOUND', 'ECONNREFUSED']) {
      expect(linkStatus(new PageFetchError('unreachable', 'x', { errno }))).toBe('broken');
    }
    // A private or local address (http://192.168.1.1/): no reader of the page can open it.
    expect(linkStatus(new PageFetchError('blocked', 'x'))).toBe('broken');
  });

  it("doesn't call what may pass, or what wouldn't tell, broken", () => {
    for (const status of [400, 401, 403, 405, 429, 500, 503, 999]) {
      expect(linkStatus(new PageFetchError('http_error', 'x', { status }))).toBe('unknown');
    }
    for (const errno of ['ECONNRESET', 'EAI_AGAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', undefined]) {
      expect(linkStatus(new PageFetchError('unreachable', 'x', { errno }))).toBe('unknown');
    }
    // invalid_url: a port the fetch won't read, which a reader may still open.
    for (const code of ['timeout', 'invalid_url', 'too_many_redirects']) {
      expect(linkStatus(new PageFetchError(code, 'x'))).toBe('unknown');
    }
    expect(linkStatus(new Error('boom'))).toBe('unknown');
  });
});

describe('pageDate', () => {
  it("takes the main entity's date, not a sidebar's or a comment's", () => {
    const html = `<script type="application/ld+json">{"@graph":[
        {"@type":"BlogPosting","datePublished":"2019-01-05","dateModified":"2019-03-01"},
        {"@type":"Comment","dateCreated":"2026-01-01","datePublished":"2026-01-01"}]}</script>
      <aside><time datetime="2026-09-01">Latest post</time></aside>`;
    expect(pageDate(html, NOW)).toBe('2019-03-01T00:00:00.000Z');
  });

  it("takes an article's date before its WebPage's, which may be the site's build", () => {
    const html = `<script type="application/ld+json">[
        {"@type":"WebPage","dateModified":"2026-10-01"},
        {"@type":"Article","datePublished":"2021-04-04"}]</script>`;
    expect(pageDate(html, NOW)).toBe('2021-04-04T00:00:00.000Z');
    expect(
      pageDate(
        '<script type="application/ld+json">{"@type":"WebPage","dateModified":"2026-10-01"}</script>',
        NOW,
      ),
    ).toBe('2026-10-01T00:00:00.000Z');
  });

  it("falls back to article meta, then to the article's first <time>", () => {
    expect(
      pageDate(
        '<meta property="article:modified_time" content="2024-02-02"><article><time datetime="2020-01-01">x</time></article>',
        NOW,
      ),
    ).toBe('2024-02-02T00:00:00.000Z');
    expect(
      pageDate(
        '<aside><time datetime="2026-09-01">x</time></aside><main><time datetime="2023-05-05">y</time></main>',
        NOW,
      ),
    ).toBe('2023-05-05T00:00:00.000Z');
  });

  it('gives none for a page without a date, or with one ahead of now', () => {
    expect(pageDate('<p>No date</p>', NOW)).toBeNull();
    expect(pageDate('<article><time datetime="2027-01-01">x</time></article>', NOW)).toBeNull();
  });
});

describe('readableLink', () => {
  it('leaves out one-time and account links', () => {
    expect(readableLink('https://a.example/blog/post')).toBe(true);
    expect(readableLink('https://a.example/unsubscribe?u=1')).toBe(false);
    expect(readableLink('https://a.example/auth/magic-link/abc')).toBe(false);
    expect(readableLink('https://a.example/x?token=abc')).toBe(false);
    expect(readableLink('https://a.example/confirm-email')).toBe(false);
    // Words in an article's address aren't account links.
    expect(readableLink('https://a.example/blog/how-to-verify-a-domain')).toBe(true);
    expect(readableLink(`https://a.example/${'x'.repeat(2100)}`)).toBe(false);
  });
});

describe('checkLinks', () => {
  it('reads each link once, a hash or tracking variant with it, and keeps the reads', async () => {
    const { db, upserts } = fakeDb();
    const fetcher = vi.fn(async (url, opts) => {
      expect(opts.maxBytes).toBe(LINK_MAX_BYTES);
      if (url.includes('gone')) throw new PageFetchError('http_error', '404', { status: 404 });
      return page(url, '<article><time datetime="2025-06-01">June</time></article>');
    });
    const { reads, skipped } = await checkLinks(
      [
        'https://a.example/x',
        'https://a.example/x#part',
        'https://a.example/x?utm_source=mail',
        'https://gone.example/',
        '/pricing',
        'mailto:hi@a.example',
        'https://a.example/unsubscribe',
      ],
      { db, fetcher, now: NOW, log: silent },
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(skipped).toEqual(['/pricing', 'mailto:hi@a.example', 'https://a.example/unsubscribe']);
    const ok = { status: 'ok', httpStatus: 200, date: '2025-06-01T00:00:00.000Z' };
    expect(Object.fromEntries(reads)).toEqual({
      'https://a.example/x': ok,
      'https://a.example/x#part': ok,
      'https://a.example/x?utm_source=mail': ok,
      'https://gone.example/': { status: 'broken', httpStatus: 404, date: null },
    });
    expect(upserts.map((u) => [u.url_hash, u.url, u.status])).toEqual([
      [hashOf('https://a.example/x'), 'https://a.example/x', 'ok'],
      [hashOf('https://gone.example/'), 'https://gone.example/', 'broken'],
    ]);
  });

  it('reads the date in the head of a page over the cap, and calls it working', async () => {
    // A long article page (inline app state and all), its date in <head>.
    const head =
      '<html><head><meta property="article:modified_time" content="2026-09-14T08:00:00Z"></head><body>';
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`${head}<p>${'x'.repeat(LINK_MAX_BYTES)}</p></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = String(server.address().port);
    // site.test is the local server; any other name goes through the real check.
    const lookup = (hostname, options, callback) => {
      const done = typeof options === 'function' ? options : callback;
      const all = typeof options === 'object' && options.all;
      if (hostname !== 'site.test') return publicOnlyLookup(hostname, options, callback);
      return all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
    };
    try {
      const url = `http://site.test:${port}/long-read`;
      const { reads } = await checkLinks([url], {
        db: fakeDb().db,
        fetcher: (address, opts) =>
          fetchPage(address, { ...opts, lookup, ports: ['', '80', '443', port] }),
        now: NOW,
        log: silent,
      });
      expect(reads.get(url)).toEqual({
        status: 'ok',
        httpStatus: 200,
        date: '2026-09-14T08:00:00.000Z',
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("uses a read from the last day, and reads an 'unknown' one again after a few hours", async () => {
    const row = (url, status, age) => ({
      url,
      status,
      http_status: null,
      page_date: null,
      checked_at: ago(age),
    });
    const { db } = fakeDb([
      row('https://fresh.example/', 'ok', 60_000),
      row('https://walled.example/', 'unknown', UNKNOWN_TTL_MS + 60_000),
      row('https://old.example/', 'broken', CHECK_TTL_MS + 60_000),
    ]);
    const fetcher = vi.fn(async (url) => page(url));
    await checkLinks(
      ['https://fresh.example/', 'https://walled.example/', 'https://old.example/'],
      {
        db,
        fetcher,
        now: NOW,
        log: silent,
      },
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://walled.example/',
      'https://old.example/',
    ]);
  });

  it('reads the links again when the kept reads cannot be read', async () => {
    const { db } = fakeDb([], { readError: { message: 'URI too long' } });
    const log = { error: vi.fn() };
    const fetcher = vi.fn(async (url) => page(url));
    const { reads } = await checkLinks(['https://a.example/'], { db, fetcher, now: NOW, log });
    expect(reads.get('https://a.example/').status).toBe('ok');
    expect(log.error).toHaveBeenCalled();
  });

  it(`reads ${MAX_LINKS} links at most, and no more than it may`, async () => {
    const { db } = fakeDb();
    const fetcher = vi.fn(async (url) => page(url));
    const urls = Array.from({ length: MAX_LINKS + 5 }, (_, i) => `https://s${i}.example/`);
    let result = await checkLinks(urls, { db, fetcher, now: NOW, log: silent });
    expect(result.reads.size).toBe(MAX_LINKS);
    expect(result.skipped).toHaveLength(5);
    fetcher.mockClear();
    result = await checkLinks(['https://t1.example/', 'https://t2.example/'], {
      db,
      fetcher,
      now: NOW,
      reserve: (wanted) => Math.min(wanted, 1),
      log: silent,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.reads.size).toBe(1);
  });

  it('reads a link two drafts ask for at once only once', async () => {
    const { db } = fakeDb();
    let release;
    const fetcher = vi.fn(
      (url) =>
        new Promise((resolve) => {
          release = () => resolve(page(url));
        }),
    );
    const deps = { db, fetcher, now: NOW, log: silent };
    const first = checkLinks(['https://shared.example/'], deps);
    const second = checkLinks(['https://shared.example/#x'], deps);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.reads.get('https://shared.example/').status).toBe('ok');
    expect(b.reads.get('https://shared.example/#x').status).toBe('ok');
  });

  it('drops reads older than a week, once an hour', async () => {
    const { db, deletes } = fakeDb();
    const fetcher = async (url) => page(url);
    const later = NOW + 2 * 60 * 60 * 1000;
    await checkLinks(['https://a.example/'], { db, fetcher, now: later, log: silent });
    await checkLinks(['https://b.example/'], { db, fetcher, now: later + 60_000, log: silent });
    expect(deletes).toEqual([new Date(later - 7 * 24 * 60 * 60 * 1000).toISOString()]);
  });
});

describe('reserveReads', () => {
  it('gives each member HOURLY_READS an hour, taken at once', () => {
    expect(reserveReads('u-budget', 150, NOW)).toBe(150);
    // Asks made together share what is left.
    expect(reserveReads('u-budget', 40, NOW + 1)).toBe(40);
    expect(reserveReads('u-budget', 40, NOW + 2)).toBe(HOURLY_READS - 190);
    expect(reserveReads('u-budget', 5, NOW + 3)).toBe(0);
    expect(reserveReads('u-budget', 5, NOW + 61 * 60 * 1000)).toBe(5);
  });
});
