import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { checkTrackingSnippet, snippetOnPage } = await import('./trackingSnippetCheck.js');

const CODE = '0123456789abcdef0123456789abcdef';
const TAG = `<script src="https://api.getcito.com/t.js" data-t="${CODE}" defer></script>`;
const NOW = new Date('2026-11-01T10:00:00.000Z');

/** A database with one brand, its domains, and the update it was sent. */
function dbOf({
  domains = [{ domain: 'getcito.com', is_primary: true }],
  updateError = null,
} = {}) {
  const updates = [];
  const db = {
    updates,
    from(table) {
      if (table === 'brand_domains') {
        return { select: () => ({ eq: async () => ({ data: domains, error: null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: { tracking_code: CODE }, error: null }) }),
        }),
        update: (row) => ({
          eq: async (_col, id) => {
            updates.push({ id, ...row });
            return { error: updateError };
          },
        }),
      };
    },
  };
  return db;
}

const page = (html) => vi.fn(async (url) => ({ url, status: 200, html }));

describe('the tracking snippet on a page', () => {
  it('is its t.js tag, or the brand’s code anywhere', () => {
    expect(snippetOnPage(`<head>${TAG}</head>`, CODE)).toBe(true);
    expect(snippetOnPage(`<script>window.t = "${CODE}";</script>`, CODE)).toBe(true);
    // The tag pasted with its attributes the other way round, single quotes.
    expect(snippetOnPage(`<script defer data-t='x' src='/t.js?v=2'></script>`, CODE)).toBe(true);
    expect(snippetOnPage('<script src="https://cdn.example.com/t.js"></script>', CODE)).toBe(false);
    expect(snippetOnPage('<p>No snippet here.</p>', CODE)).toBe(false);
  });
});

describe('checkTrackingSnippet', () => {
  it('reads the brand’s home page and keeps that it found the snippet', async () => {
    const db = dbOf();
    const fetcher = page(`<html><head>${TAG}</head></html>`);
    const result = await checkTrackingSnippet('b1', { db, fetcher, now: NOW });
    expect(result).toEqual({
      status: 'found',
      domain: 'getcito.com',
      checkedAt: NOW.toISOString(),
      foundAt: NOW.toISOString(),
    });
    expect(fetcher).toHaveBeenCalledWith('https://getcito.com/', expect.any(Object));
    expect(db.updates).toEqual([
      { id: 'b1', snippet_checked_at: NOW.toISOString(), snippet_found_at: NOW.toISOString() },
    ]);
  });

  it('keeps that it didn’t, clearing an earlier find', async () => {
    const db = dbOf();
    const result = await checkTrackingSnippet('b1', {
      db,
      fetcher: page('<html><head></head></html>'),
      now: NOW,
    });
    expect(result).toMatchObject({ status: 'not_found', foundAt: null });
    expect(db.updates).toEqual([
      { id: 'b1', snippet_checked_at: NOW.toISOString(), snippet_found_at: null },
    ]);
  });

  it('tries www. when the domain as added doesn’t answer', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unreachable'), { code: 'unreachable' }))
      .mockResolvedValueOnce({ url: 'https://www.getcito.com/', status: 200, html: TAG });
    const result = await checkTrackingSnippet('b1', { db: dbOf(), fetcher, now: NOW });
    expect(result.status).toBe('found');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://getcito.com/',
      'https://www.getcito.com/',
    ]);
  });

  it('changes nothing when the home page can’t be read', async () => {
    const db = dbOf();
    const fetcher = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'timeout' }));
    const result = await checkTrackingSnippet('b1', { db, fetcher, now: NOW });
    expect(result).toEqual({
      status: 'unreachable',
      domain: 'getcito.com',
      checkedAt: null,
      foundAt: null,
    });
    expect(db.updates).toEqual([]);
  });

  it('has nothing to read for a brand without a domain', async () => {
    const db = dbOf({ domains: [] });
    const fetcher = vi.fn();
    expect(await checkTrackingSnippet('b1', { db, fetcher, now: NOW })).toEqual({
      status: 'no_domain',
      domain: null,
      checkedAt: null,
      foundAt: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('still answers before 00433 is applied', async () => {
    const db = dbOf({ updateError: { code: '42703', message: 'column does not exist' } });
    const result = await checkTrackingSnippet('b1', { db, fetcher: page(TAG), now: NOW });
    expect(result.status).toBe('found');
  });
});
