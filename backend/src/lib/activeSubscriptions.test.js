import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which organizations the nightly work may still run for (2026-10-27): on
 * the cloud, those with an active or trialing subscription; self-hosted,
 * every one, without a read. Never a demo brand (00380), on either.
 */

const reads = [];
let rows = {};
let failWith = null;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const read = { table };
      reads.push(read);
      const chain = {
        select: (columns) => {
          read.columns = columns;
          return chain;
        },
        in: (column, ids) => {
          read.in = [column, ids];
          return chain;
        },
        then: (resolve, reject) =>
          Promise.resolve(
            failWith
              ? { data: null, error: { message: failWith } }
              : {
                  data: (rows[table] ?? []).filter((row) => ids(read).includes(row.id)),
                  error: null,
                },
          ).then(resolve, reject),
      };
      return chain;
    },
  },
}));

const ids = (read) => read.in?.[1] ?? [];

const {
  ACTIVE_SUBSCRIPTION_STATUSES,
  CACHED_ANSWER_MS,
  CACHED_INACTIVE_MS,
  MAX_CACHED_ANSWERS,
  activeBrandFilter,
  activeOrgFilter,
  brandStopReason,
  brandStopReasons,
  clearCachedAnswers,
  isBrandActive,
  isBrandActiveCached,
  isOrgActive,
  isOrgActiveCached,
} = await import('./activeSubscriptions.js');
const { isSubscriptionActive } = await import('../config/plans.js');

beforeEach(() => {
  reads.length = 0;
  failWith = null;
  clearCachedAnswers();
  rows = {
    organizations: [
      { id: 'trialing', subscription_status: 'trialing' },
      { id: 'active', subscription_status: 'active' },
      { id: 'canceled', subscription_status: 'canceled' },
      { id: 'past-due', subscription_status: 'past_due' },
      { id: 'incomplete', subscription_status: 'incomplete' },
    ],
    brands: [
      { id: 'b-active', organizations: { subscription_status: 'active' } },
      { id: 'b-trialing', organizations: { subscription_status: 'trialing' } },
      { id: 'b-canceled', organizations: { subscription_status: 'canceled' } },
      { id: 'b-orphan', organizations: null },
      { id: 'b-demo', is_demo: true, organizations: { subscription_status: 'active' } },
    ],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('self-hosted', () => {
  beforeEach(() => vi.stubEnv('IS_CLOUD', 'false'));

  it('lets every organization through without reading anything', async () => {
    const isOrgActive = await activeOrgFilter(['canceled', 'anything']);

    expect(isOrgActive('canceled')).toBe(true);
    expect(isOrgActive(undefined)).toBe(true);
    expect(reads).toHaveLength(0);
  });

  it('lets every brand through but a demo one, reading only which is which', async () => {
    const isBrandActive = await activeBrandFilter(['b-canceled', 'b-orphan', 'b-demo']);

    expect(['b-canceled', 'b-orphan', 'b-demo'].filter(isBrandActive)).toEqual([
      'b-canceled',
      'b-orphan',
    ]);
    expect(reads).toEqual([
      { table: 'brands', columns: 'id, is_demo', in: ['id', ['b-canceled', 'b-orphan', 'b-demo']] },
    ]);
  });
});

describe('cloud', () => {
  beforeEach(() => vi.stubEnv('IS_CLOUD', 'true'));

  it('lets through only the organizations with an active or trialing subscription', async () => {
    const isActive = await activeOrgFilter([
      'trialing',
      'active',
      'canceled',
      'past-due',
      'incomplete',
      'missing',
      'active',
      null,
    ]);

    expect(
      ['trialing', 'active', 'canceled', 'past-due', 'incomplete', 'missing'].filter(isActive),
    ).toEqual(['trialing', 'active']);
    // One read, each id once.
    expect(reads).toEqual([
      {
        table: 'organizations',
        columns: 'id, subscription_status',
        in: ['id', ['trialing', 'active', 'canceled', 'past-due', 'incomplete', 'missing']],
      },
    ]);
  });

  it('lets through only the brands whose organization has one, never a demo brand', async () => {
    const all = ['b-active', 'b-trialing', 'b-canceled', 'b-orphan', 'b-demo'];
    const isActive = await activeBrandFilter(all);

    expect(all.filter(isActive)).toEqual(['b-active', 'b-trialing']);
    expect(reads[0]).toMatchObject({
      table: 'brands',
      columns: 'id, is_demo, organizations(subscription_status)',
    });
  });

  it('reads nothing and lets nothing through for no ids', async () => {
    expect((await activeOrgFilter([]))('active')).toBe(false);
    expect((await activeBrandFilter([null]))('b-active')).toBe(false);
    expect(reads).toHaveLength(0);
  });

  it('throws when it cannot tell, so a sweep runs for nobody', async () => {
    failWith = 'statement timeout';
    await expect(activeOrgFilter(['active'])).rejects.toThrow(
      'organizations read: statement timeout',
    );
    await expect(activeBrandFilter(['b-active'])).rejects.toThrow('brands read: statement timeout');
  });
});

describe('brandStopReasons and brandStopReason', () => {
  it('says why no work may start: demo_brand before an ended plan, null when it may', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    const reasonFor = await brandStopReasons(['b-active', 'b-canceled', 'b-orphan', 'b-demo']);
    expect(['b-active', 'b-canceled', 'b-orphan', 'b-demo', 'b-missing'].map(reasonFor)).toEqual([
      null,
      'subscription_inactive',
      'subscription_inactive',
      'demo_brand',
      'subscription_inactive',
    ]);
    expect(reads).toHaveLength(1);
  });

  it('self-hosted, stops only a demo brand', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    expect(await brandStopReason('b-canceled')).toBe(null);
    expect(await brandStopReason('b-demo')).toBe('demo_brand');
  });

  it('reads nothing for no ids', async () => {
    expect((await brandStopReasons([]))('b-active')).toBe('subscription_inactive');
    expect(reads).toHaveLength(0);
  });
});

describe('isOrgActive', () => {
  it('tells one organization, on the cloud by its subscription, self-hosted always', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await isOrgActive('trialing')).toBe(true);
    expect(await isOrgActive('canceled')).toBe(false);
    vi.stubEnv('IS_CLOUD', 'false');
    reads.length = 0;
    expect(await isOrgActive('canceled')).toBe(true);
    expect(reads).toHaveLength(0);
  });
});

describe('isBrandActive', () => {
  it("tells one brand by its organization's subscription, self-hosted always", async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await isBrandActive('b-trialing')).toBe(true);
    expect(await isBrandActive('b-canceled')).toBe(false);
    expect(await isBrandActive('b-orphan')).toBe(false);
    vi.stubEnv('IS_CLOUD', 'false');
    expect(await isBrandActive('b-canceled')).toBe(true);
  });

  it('never tells a demo brand active, on the cloud or self-hosted', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await isBrandActive('b-demo')).toBe(false);
    vi.stubEnv('IS_CLOUD', 'false');
    expect(await isBrandActive('b-demo')).toBe(false);
  });
});

/**
 * What outside sites send us (2026-10-27): one read per organization or
 * brand every CACHED_ANSWER_MS, not one per event.
 */
describe('isOrgActiveCached and isBrandActiveCached', () => {
  const T0 = 1_800_000_000_000;

  it('keeps an active answer for minutes, without a read, until they are up', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await isOrgActiveCached('active', { now: T0 })).toBe(true);
    expect(reads).toHaveLength(1);

    // The plan ends meanwhile: still the kept answer, without a read.
    rows.organizations.find((org) => org.id === 'active').subscription_status = 'canceled';
    expect(await isOrgActiveCached('active', { now: T0 + CACHED_ANSWER_MS - 1 })).toBe(true);
    expect(reads).toHaveLength(1);

    // Once they are up, read again.
    expect(await isOrgActiveCached('active', { now: T0 + CACHED_ANSWER_MS })).toBe(false);
    expect(reads).toHaveLength(2);
  });

  it('keeps an inactive answer a minute at most, so a plan bought now counts soon', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(CACHED_INACTIVE_MS).toBeLessThanOrEqual(60_000);
    expect(await isOrgActiveCached('canceled', { now: T0 })).toBe(false);
    expect(await isBrandActiveCached('b-canceled', { now: T0 })).toBe(false);

    rows.organizations.find((org) => org.id === 'canceled').subscription_status = 'active';
    rows.brands.find((brand) => brand.id === 'b-canceled').organizations.subscription_status =
      'trialing';
    expect(await isOrgActiveCached('canceled', { now: T0 + CACHED_INACTIVE_MS - 1 })).toBe(false);
    expect(reads).toHaveLength(2);
    expect(await isOrgActiveCached('canceled', { now: T0 + CACHED_INACTIVE_MS })).toBe(true);
    expect(await isBrandActiveCached('b-canceled', { now: T0 + CACHED_INACTIVE_MS })).toBe(true);
    expect(reads).toHaveLength(4);
  });

  it('keeps organizations and brands apart, and a burst waits on one read', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    const answers = await Promise.all([
      isBrandActiveCached('b-active', { now: T0 }),
      isBrandActiveCached('b-active', { now: T0 }),
      isBrandActiveCached('b-canceled', { now: T0 }),
      isOrgActiveCached('active', { now: T0 }),
    ]);
    expect(answers).toEqual([true, true, false, true]);
    expect(reads.map((read) => [read.table, read.in[1]])).toEqual([
      ['brands', ['b-active']],
      ['brands', ['b-canceled']],
      ['organizations', ['active']],
    ]);
  });

  it("doesn't keep a read that failed: the next event asks again", async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    failWith = 'statement timeout';
    await expect(isOrgActiveCached('active', { now: T0 })).rejects.toThrow('statement timeout');
    failWith = null;
    expect(await isOrgActiveCached('active', { now: T0 + 1 })).toBe(true);
    expect(reads).toHaveLength(2);
  });

  it('forgets the oldest answer first once full', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    for (let i = 0; i < MAX_CACHED_ANSWERS; i++) await isOrgActiveCached(`org-${i}`, { now: T0 });
    await isOrgActiveCached('one-more', { now: T0 });
    reads.length = 0;
    await isOrgActiveCached(`org-${MAX_CACHED_ANSWERS - 1}`, { now: T0 });
    expect(reads).toHaveLength(0);
    await isOrgActiveCached('org-0', { now: T0 });
    expect(reads).toHaveLength(1);
  });

  it('lets nothing through without an id, and everything self-hosted, without a read', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await isOrgActiveCached(null, { now: T0 })).toBe(false);
    expect(await isBrandActiveCached(undefined, { now: T0 })).toBe(false);
    vi.stubEnv('IS_CLOUD', 'false');
    expect(await isOrgActiveCached('canceled', { now: T0 })).toBe(true);
    expect(await isBrandActiveCached('b-canceled', { now: T0 })).toBe(true);
    expect(reads).toHaveLength(0);
  });
});

describe('ACTIVE_SUBSCRIPTION_STATUSES', () => {
  it('is what isSubscriptionActive takes as active, for a filter in a query', () => {
    vi.stubEnv('IS_CLOUD', 'true');
    const statuses = [
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
      null,
    ];
    expect(statuses.filter((status) => isSubscriptionActive(status))).toEqual(
      ACTIVE_SUBSCRIPTION_STATUSES,
    );
  });
});
