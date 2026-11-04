import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Your first results are ready" (00385): e-mailed once per person, with
 * their own first results — when this run is the earliest stamped run of
 * the real brands they can see (brand access, spec §5.4). With All brands
 * that is the organization's first results, as before; with Selected
 * brands, their first brand's. 00385 didn't stamp the people who had
 * results before it, so the earliest run keeps them from being told again.
 */

const db = vi.hoisted(() => ({
  brand: { data: null, error: null },
  orgBrands: { data: [], error: null },
  /** Each brand's first stamped run. */
  stamps: {},
  runsError: null,
  runQueries: [],
  /** Who sees which brands (lib/access.js brandReaders), what it was asked, and its failure. */
  readers: new Map(),
  readerCalls: [],
  readersError: null,
  claimed: { data: [], error: null },
  emails: {},
  updates: [],
}));
const deliverEmail = vi.hoisted(() => vi.fn());

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      if (table === 'brands') {
        // The brand itself (… eq id … single), or the organization's real
        // brands (… eq organization_id … eq is_demo false).
        return {
          select: () => ({
            eq: () => ({
              single: async () => db.brand,
              eq: async (column, value) =>
                column === 'is_demo' && value === false
                  ? db.orgBrands
                  : { data: null, error: { message: 'unexpected filter' } },
            }),
          }),
        };
      }
      if (table === 'tracking_runs') {
        const query = [];
        db.runQueries.push(query);
        let brandId;
        const chain = {
          select: (columns) => (query.push(['select', columns]), chain),
          eq: (column, value) => ((brandId = value), query.push(['eq', column, value]), chain),
          not: (column, op, value) => (query.push(['not', column, op, value]), chain),
          order: (column, options) => (query.push(['order', column, options]), chain),
          limit: async (n) => {
            query.push(['limit', n]);
            if (db.runsError) return { data: null, error: db.runsError };
            const at = db.stamps[brandId];
            return { data: at ? [{ completed_at: at }] : [], error: null };
          },
        };
        return chain;
      }
      // profiles: the claim (update … in … is null … select) or its release (update … in).
      return {
        update: (values) => {
          const update = { values, filters: [] };
          db.updates.push(update);
          const chain = {
            eq: (column, value) => (update.filters.push(['eq', column, value]), chain),
            in: (column, value) => {
              update.filters.push(['in', column, value]);
              return values.first_results_emailed_at === null
                ? Promise.resolve({ error: null })
                : chain;
            },
            is: (column, value) => (update.filters.push(['is', column, value]), chain),
            select: async () => db.claimed,
          };
          return chain;
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (id) => ({ data: { user: { email: db.emails[id] } } }),
      },
    },
  },
}));
vi.mock('./access.js', () => ({
  brandReaders: async (...args) => {
    db.readerCalls.push(args);
    if (db.readersError) throw db.readersError;
    return db.readers;
  },
}));
vi.mock('./email.js', () => ({ deliverEmail }));
vi.mock('./logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { renderFirstResultsEmail, sendFirstResultsEmail } = await import('./firstResultsEmail.js');

const sees = (...brands) => new Set(brands);

beforeEach(() => {
  db.brand = {
    data: { name: 'Acme Coffee', organization_id: 'org-1', is_demo: false },
    error: null,
  };
  db.orgBrands = { data: [{ id: 'brand-1' }, { id: 'brand-2' }], error: null };
  // Brand 1's first run stamped first; brand 2 has none yet.
  db.stamps = { 'brand-1': '2026-10-20T08:00:00Z' };
  db.runsError = null;
  db.runQueries = [];
  // Everyone has All brands.
  db.readers = new Map([
    ['u1', sees('brand-1', 'brand-2')],
    ['u2', sees('brand-1', 'brand-2')],
  ]);
  db.readerCalls = [];
  db.readersError = null;
  db.claimed = { data: [{ id: 'u1' }, { id: 'u2' }], error: null };
  db.emails = { u1: 'ana@acme.test', u2: 'bo@acme.test', u3: 'cy@acme.test' };
  db.updates = [];
  deliverEmail.mockReset().mockResolvedValue('sent');
});

describe('renderFirstResultsEmail', () => {
  it('says the results are in, with the way to Brand Visibility', () => {
    const { subject, html } = renderFirstResultsEmail({ brandName: 'Acme Coffee' });
    expect(subject).toBe('Your first results are ready: Acme Coffee');
    expect(html).toContain('Your first results are ready');
    expect(html).toContain("Acme Coffee's prompts for the first time");
    expect(html).toContain('href="http://localhost:3000/dashboard/insights"');
  });

  it('escapes the brand name', () => {
    const { html } = renderFirstResultsEmail({ brandName: 'Acme <Tea>' });
    expect(html).toContain('Acme &lt;Tea&gt;');
    expect(html).not.toContain('<Tea>');
  });
});

describe('sendFirstResultsEmail', () => {
  it('takes the people never sent it whose first results these are, in one update, and e-mails them', async () => {
    expect(await sendFirstResultsEmail('brand-1')).toBe('sent');
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].values.first_results_emailed_at).toEqual(expect.any(String));
    // Only the organization's people: one who left it since isn't taken.
    expect(db.updates[0].filters).toEqual([
      ['eq', 'organization_id', 'org-1'],
      ['in', 'id', ['u1', 'u2']],
      ['is', 'first_results_emailed_at', null],
    ]);
    expect(deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['ana@acme.test', 'bo@acme.test'],
        subject: 'Your first results are ready: Acme Coffee',
      }),
    );
  });

  it("reads each real brand's first stamped run", async () => {
    await sendFirstResultsEmail('brand-1');
    expect(db.runQueries.map((query) => query[1])).toEqual([
      ['eq', 'brand_id', 'brand-1'],
      ['eq', 'brand_id', 'brand-2'],
    ]);
    expect(db.runQueries[0]).toEqual([
      ['select', 'completed_at'],
      ['eq', 'brand_id', 'brand-1'],
      ['not', 'completed_at', 'is', null],
      ['order', 'completed_at', { ascending: true }],
      ['limit', 1],
    ]);
  });

  it('tells no one when a workspace with results adds a brand, its people never stamped (00385)', async () => {
    // Brand 2's first run: everyone sees brand 1, whose results came first.
    db.stamps = { 'brand-1': '2026-09-01T08:00:00Z', 'brand-2': '2026-10-20T08:00:00Z' };
    expect(await sendFirstResultsEmail('brand-2')).toBe('skipped');
    expect(db.updates).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('tells someone with Selected brands when their own first brand has results, later', async () => {
    // u3 sees brand 2 only, so the organization's first results weren't theirs.
    db.readers.set('u3', sees('brand-2'));
    db.stamps = { 'brand-1': '2026-09-01T08:00:00Z', 'brand-2': '2026-10-20T08:00:00Z' };
    db.claimed = { data: [{ id: 'u3' }], error: null };
    expect(await sendFirstResultsEmail('brand-2')).toBe('sent');
    expect(db.updates[0].filters).toEqual([
      ['eq', 'organization_id', 'org-1'],
      ['in', 'id', ['u3']],
      ['is', 'first_results_emailed_at', null],
    ]);
    expect(deliverEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ['cy@acme.test'] }));
  });

  it('asks who sees the real brands with a stamped run only', async () => {
    // brand-2 has no stamped run; the demo brand isn't among the real brands read.
    await sendFirstResultsEmail('brand-1');
    expect(db.readerCalls).toEqual([['org-1', ['brand-1']]]);
  });

  it('takes no one when who sees the brands can’t be read', async () => {
    db.readersError = new Error('profiles down');
    await expect(sendFirstResultsEmail('brand-1')).rejects.toThrow('profiles down');
    expect(db.updates).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('leaves out someone who sees none of the real brands, the demo brand only', async () => {
    db.readers.set('u4', sees('demo'));
    await sendFirstResultsEmail('brand-1');
    expect(db.updates[0].filters).toContainEqual(['in', 'id', ['u1', 'u2']]);
  });

  it('tells a member from before 00385, narrowed to a new brand, at its first run (known, kept)', async () => {
    // u3 saw brand 1's results in September but was never stamped (00385
    // had no backfill); narrowed since to brand 2 alone, brand 2's first
    // run is the earliest of the brands they see, so they get the e-mail.
    db.readers.set('u3', sees('brand-2'));
    db.stamps = { 'brand-1': '2026-09-01T08:00:00Z', 'brand-2': '2026-10-30T08:00:00Z' };
    db.claimed = { data: [{ id: 'u3' }], error: null };
    expect(await sendFirstResultsEmail('brand-2')).toBe('sent');
    expect(deliverEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ['cy@acme.test'] }));
  });

  it('takes the earlier brand by id when two first runs stamp at once', async () => {
    db.stamps = { 'brand-1': '2026-10-20T08:00:00Z', 'brand-2': '2026-10-20T08:00:00Z' };
    expect(await sendFirstResultsEmail('brand-2')).toBe('skipped');
    expect(await sendFirstResultsEmail('brand-1')).toBe('sent');
  });

  it('sends nothing when everyone was sent it before', async () => {
    db.claimed = { data: [], error: null };
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('gives the claim back when nothing went out', async () => {
    deliverEmail.mockResolvedValue('refused');
    expect(await sendFirstResultsEmail('brand-1')).toBe('refused');
    expect(db.updates[1]).toEqual({
      values: { first_results_emailed_at: null },
      filters: [['in', 'id', ['u1', 'u2']]],
    });

    db.updates = [];
    deliverEmail.mockResolvedValue('skipped');
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    expect(db.updates[1].values).toEqual({ first_results_emailed_at: null });
  });

  it('keeps the claim when Resend may have sent it', async () => {
    deliverEmail.mockResolvedValue('unknown');
    expect(await sendFirstResultsEmail('brand-1')).toBe('unknown');
    expect(db.updates).toHaveLength(1);
  });

  it('sends nothing for a demo brand, or a brand with no stamped run', async () => {
    db.brand = { data: { name: 'Demo', organization_id: 'org-1', is_demo: true }, error: null };
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    db.brand = { data: { name: 'Acme', organization_id: 'org-1', is_demo: false }, error: null };
    expect(await sendFirstResultsEmail('brand-2')).toBe('skipped');
    expect(db.updates).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('fails when the runs cannot be read, before taking anyone', async () => {
    db.runsError = { message: 'runs boom' };
    await expect(sendFirstResultsEmail('brand-1')).rejects.toThrow('runs boom');
    expect(db.updates).toHaveLength(0);
  });

  it('fails when the brand cannot be read, before taking anyone', async () => {
    db.brand = { data: null, error: { message: 'boom' } };
    await expect(sendFirstResultsEmail('brand-1')).rejects.toThrow('boom');
    expect(db.updates).toHaveLength(0);
  });
});
