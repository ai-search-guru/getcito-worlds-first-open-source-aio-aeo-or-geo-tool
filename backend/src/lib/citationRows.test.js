import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { extractDomain, normalizeCitations, MAX_URL_LENGTH } from './citationRows.js';

/**
 * What gets written per citation (#732).
 *
 * The stored domain has to group exactly the way the Citations page groups, or
 * the aggregate and the surface disagree about what a domain is — so these
 * pin the rule rather than the implementation.
 */
describe('extractDomain', () => {
  it('lowercases the host and drops www.', () => {
    expect(extractDomain('https://WWW.Example.COM/a/b?c=d')).toBe('example.com');
  });

  it('keeps subdomains other than www', () => {
    expect(extractDomain('https://docs.example.com/guide')).toBe('docs.example.com');
    expect(extractDomain('https://www2.example.com/')).toBe('www2.example.com');
  });

  it('ignores port, path, query and fragment', () => {
    expect(extractDomain('https://example.com:8443/x?y=1#z')).toBe('example.com');
  });

  // 252 of the 2,023,979 citations in production arrive without a scheme.
  // The page counts them today by recovering a hostname-like token, so a
  // writer that dropped them would quietly lower every figure once the page
  // reads these rows instead.
  it('recovers a host from a URL with no scheme', () => {
    expect(extractDomain('example.com/page')).toBe('example.com');
    expect(extractDomain('www.example.com/page')).toBe('example.com');
    expect(extractDomain('WWW.EXAMPLE.COM')).toBe('example.com');
  });

  it('returns null only when there is no host-like token at all', () => {
    for (const bad of ['', '   ', '/relative/path', null, undefined, 42, {}]) {
      expect(extractDomain(bad)).toBeNull();
    }
  });
});

describe('normalizeCitations', () => {
  it('keeps the array index as position', () => {
    const rows = normalizeCitations([
      { url: 'https://a.com/1' },
      { url: 'https://b.com/2' },
      { url: 'https://c.com/3' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  // Dropping an entry must not renumber the ones after it: position is half
  // the primary key, so a shifted index would collide with a different
  // citation on a re-run.
  it('preserves the original index when an entry is dropped', () => {
    const rows = normalizeCitations([
      { url: 'https://a.com/1' },
      { url: '/relative/only' },
      { url: 'https://c.com/3' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 2]);
    expect(rows.map((r) => r.domain)).toEqual(['a.com', 'c.com']);
  });

  it('drops entries with no usable URL rather than storing a null domain', () => {
    const rows = normalizeCitations([
      { url: '' },
      { url: '   ' },
      { title: 'no url at all' },
      { url: '/relative/only' },
      null,
      undefined,
    ]);
    expect(rows).toEqual([]);
  });

  it('truncates a URL that would not fit a btree entry', () => {
    const long = `https://example.com/${'x'.repeat(5000)}`;
    const [row] = normalizeCitations([{ url: long }]);
    expect(row.url).toHaveLength(MAX_URL_LENGTH);
    expect(row.domain).toBe('example.com');
  });

  it('trims the title and stores null when it is empty', () => {
    expect(normalizeCitations([{ url: 'https://a.com', title: '  Hello  ' }])[0].title).toBe(
      'Hello',
    );
    expect(normalizeCitations([{ url: 'https://a.com', title: '   ' }])[0].title).toBeNull();
    expect(normalizeCitations([{ url: 'https://a.com' }])[0].title).toBeNull();
  });

  it('returns an empty list for anything that is not an array', () => {
    for (const bad of [null, undefined, {}, 'citations', 7]) {
      expect(normalizeCitations(bad)).toEqual([]);
    }
  });

  // The same page cited twice in one answer is two citations, not one: the
  // page's own count of how often it was cited depends on it.
  it('keeps repeated URLs as separate rows', () => {
    const rows = normalizeCitations([{ url: 'https://a.com/x' }, { url: 'https://a.com/x' }]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });
});

/**
 * URLs are resolved through the request body, not the query string (#732).
 *
 * Two versions of this failed before: an unbounded `.in()` filter, then a
 * chunked one. Both put the URLs in the URI, and both lost exactly the answers
 * carrying the most citations — the last of them 182 of 174,466. These tests
 * pin the shape that removed the class rather than a chunk size, which was
 * only ever a guess at someone else's limit.
 */
describe('persistCitationRows url resolution', () => {
  /** Records the arguments every rpc call was made with. */
  function makeClient({ ids = null } = {}) {
    const calls = [];
    const client = {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        const rows = args.p_urls.map((u, i) => ({
          url: u.url,
          id: ids ? ids.get(u.url) : i + 1,
        }));
        return Promise.resolve({ data: rows, error: null });
      },
      from: () => ({
        upsert: (rows) => ({
          select: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    };
    return { client, calls };
  }

  async function run(citations, opts) {
    const { client, calls } = makeClient(opts);
    vi.resetModules();
    vi.doMock('../config/supabase.js', () => ({ default: client }));
    const { persistCitationRows } = await import('./citationRows.js');
    const written = await persistCitationRows({
      promptResultId: 'r1',
      brandId: 'b1',
      createdAt: '2026-08-19T00:00:00Z',
      citations,
    });
    return { written, calls };
  }

  it('resolves every URL in a single call, however many there are', async () => {
    const citations = Array.from({ length: 250 }, (_, i) => ({ url: `https://a.com/${i}` }));
    const { written, calls } = await run(citations);

    expect(written).toBe(250);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('citation_url_ids');
    expect(calls[0].args.p_urls).toHaveLength(250);
  });

  it('stores every citation of an answer far larger than typical', async () => {
    // The largest answer in production carries 191 citations; the answers that
    // used to fail carried 22 to 51.
    const citations = Array.from({ length: 191 }, (_, i) => ({ url: `https://b.com/${i}` }));
    const { written } = await run(citations);
    expect(written).toBe(191);
  });

  it('sends each distinct URL once, with the fields the dictionary stores', async () => {
    const { calls } = await run([
      { url: 'https://a.com/x', title: 'X' },
      { url: 'https://a.com/x', title: 'X again' },
      { url: 'https://b.com/y' },
    ]);

    expect(calls[0].args.p_urls).toEqual([
      { url: 'https://a.com/x', domain: 'a.com', title: 'X' },
      { url: 'https://b.com/y', domain: 'b.com', title: null },
    ]);
  });

  // A citation whose URL the function did not return an id for is dropped
  // rather than sent with url_id undefined, which the insert would reject and
  // take the answer's other citations down with it.
  it('keeps the citations it can resolve when one id is missing', async () => {
    const ids = new Map([['https://a.com/1', 7]]);
    const { written } = await run([{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }], {
      ids,
    });
    expect(written).toBe(1);
  });
});

/**
 * Zero and null are different answers (#732).
 *
 * A backfill run once reported thousands of citations written while the table
 * did not move, because every row was discarded as a duplicate and the count
 * reported what had been attempted. The caller has to be able to tell "already
 * there" from "nothing stored, retry".
 */
describe('persistCitationRows return contract', () => {
  async function withClient(client, citations) {
    vi.resetModules();
    vi.doMock('../config/supabase.js', () => ({ default: client }));
    const { persistCitationRows } = await import('./citationRows.js');
    return persistCitationRows({
      promptResultId: 'r1',
      brandId: 'b1',
      createdAt: '2026-08-19T00:00:00Z',
      citations,
    });
  }

  /** Every URL resolves to an id, so the outcome depends only on the insert. */
  const resolvesAll = (_fn, args) =>
    Promise.resolve({
      data: args.p_urls.map((u, i) => ({ url: u.url, id: i + 1 })),
      error: null,
    });

  it('reports how many rows were actually inserted', async () => {
    const client = {
      rpc: resolvesAll,
      from: () => ({
        upsert: (rows) => ({ select: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }])).toBe(
      2,
    );
  });

  it('returns 0 — not a failure — when every row was already present', async () => {
    const client = {
      rpc: resolvesAll,
      from: () => ({
        upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
      }),
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }])).toBe(0);
  });

  it('returns null when the write fails', async () => {
    const client = {
      rpc: resolvesAll,
      from: () => ({
        upsert: () => ({
          select: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }])).toBeNull();
  });

  it('returns null when URL resolution fails', async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      from: () => ({
        upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
      }),
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }])).toBeNull();
  });

  it('returns 0 for an answer with no storable citations', async () => {
    const client = { rpc: resolvesAll, from: () => ({}) };
    expect(await withClient(client, [{ url: '/relative' }])).toBe(0);
  });
});
