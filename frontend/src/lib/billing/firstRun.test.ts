import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The first tracking run after a purchase, asked of the API by the Stripe
 * return page and the webhook alike.
 */

const brands = vi.hoisted(() => ({
  first: { id: 'brand1' } as { id: string } | null,
  filters: [] as [string, unknown][],
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          brands.filters.push([column, value]);
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: brands.first }),
      };
      return query;
    },
  },
}));

const { startFirstTrackingRun } = await import('./firstRun');

const fetchMock = vi.fn();
const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The API paths called, in order. */
const calls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
const bodyOf = (n: number) => JSON.parse(fetchMock.mock.calls[n][1].body as string);

const start = (status: string | null | undefined = 'trialing') =>
  startFirstTrackingRun({
    orgId: 'org1',
    subscriptionStatus: status,
    purchaseStarted: 1_800_000_000,
    ctx: 'test',
  });

beforeEach(() => {
  brands.first = { id: 'brand1' };
  brands.filters = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CRON_SECRET', 'secret');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('startFirstTrackingRun', () => {
  it('starts the run for the first active brand, with when the purchase began', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { jobId: 'job1', created: true }));

    expect(await start()).toBe('job1');
    // One call: the API starts the volume analysis with the run.
    expect(calls()).toEqual(['/api/internal/trigger-tracking']);
    expect(bodyOf(0)).toEqual({ brandId: 'brand1', since: '2027-01-15T08:00:00.000Z' });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer secret' });
    // A paused brand is never the one tracked, nor the demo brand (00380).
    expect(brands.filters).toEqual([
      ['organization_id', 'org1'],
      ['is_active', true],
      ['is_demo', false],
    ]);
  });

  it('hands back the run the other caller started', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { jobId: 'job1', created: false }));

    expect(await start('active')).toBe('job1');
    expect(calls()).toEqual(['/api/internal/trigger-tracking']);
  });

  it.each(['incomplete', 'incomplete_expired', 'past_due', 'unpaid', null])(
    'starts nothing for a %s subscription',
    async (status) => {
      expect(await start(status)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('starts nothing for an organization without an active brand', async () => {
    brands.first = null;
    expect(await start()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts nothing without the API secret', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(await start()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws: a refused or unreachable API gives no run', async () => {
    fetchMock.mockResolvedValueOnce(answer(500));
    expect(await start()).toBeNull();
    expect(calls()).toEqual(['/api/internal/trigger-tracking']);

    fetchMock.mockReset().mockRejectedValueOnce(new Error('timeout'));
    expect(await start()).toBeNull();
  });

  it('lets the API pick the window when the purchase time is unknown', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { jobId: 'job1', created: false }));
    await startFirstTrackingRun({ orgId: 'org1', subscriptionStatus: 'active', ctx: 'test' });
    expect(bodyOf(0)).toEqual({ brandId: 'brand1' });
  });
});
