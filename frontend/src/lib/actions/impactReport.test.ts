// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reports › "What GetCito did for you" read (CHAT-22 feature 2 item 5):
 * the brand's month of ship events with their measurements, read through
 * the person's session (brand access is the database's, 00424); the month
 * before's count; teammates named; AI traffic to the changed pages from
 * Google Analytics, or none without it. Only with the new Chat on; a
 * failure answers as a value.
 */

const BRAND = '33333333-3333-4333-8333-333333333333';
const ME = '11111111-1111-4111-8111-111111111111';
// October 2026 in Istanbul (UTC+3): its instants, and its calendar days for Analytics.
const RANGE = {
  from: '2026-09-30T21:00:00.000Z',
  to: '2026-10-31T21:00:00.000Z',
  previousFrom: '2026-08-31T21:00:00.000Z',
  days: { from: '2026-10-01', to: '2026-11-01', previousFrom: '2026-09-01' },
};

interface Call {
  table: string;
  columns?: string;
  options?: unknown;
  filters: unknown[][];
}
let calls: Call[] = [];
let answers: Record<string, unknown> = {};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const answer = () => {
        const key = `${table}${call.options ? '.count' : ''}`;
        const found = answers[key];
        return typeof found === 'function' ? found(call) : (found ?? { data: [], error: null });
      };
      const chain: Record<string, unknown> = {
        select: (columns: string, options?: unknown) =>
          Object.assign(call, { columns, options }) && chain,
        ...Object.fromEntries(
          ['eq', 'gte', 'lt', 'in', 'order', 'limit'].map((name) => [
            name,
            (...args: unknown[]) => (call.filters.push([name, ...args]), chain),
          ]),
        ),
        maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
      };
      return chain;
    },
  }),
}));
const assignees = vi.hoisted(() => ({
  read: vi.fn(
    async (_c: unknown, _b: string, ids: string[]) =>
      new Map(ids.map((id) => [id, { id, fullName: 'Alex Kim', avatarUrl: null }])),
  ),
}));
vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: assignees.read }));

const { readImpactReport } = await import('./impactReport');

const measurement = (more: Record<string, unknown> = {}) => ({
  targets: [{ type: 'prompt', id: 'p1', label: 'pricing' }],
  window_json: {},
  metrics: [
    {
      metric: 'visibility',
      before: 40,
      after: 60,
      control_before: 40,
      control_after: 42,
      effect: 18,
    },
  ],
  outcome: 'improved',
  confidence: 'medium',
  checkpoint: 'd14',
  checkpoints_json: [],
  not_measurable_reason: null,
  concurrent_changes: [],
  next_check_at: '2026-11-02T00:00:00Z',
  measured_at: '2026-10-17T06:00:00Z',
  ...more,
});
const shipRow = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  title: `Change ${id}`,
  kind: 'cms_publish',
  source: 'content_editor',
  shipped_at: '2026-10-03T10:00:00Z',
  shipped_by: ME,
  execution_mode: 'assisted',
  url: 'https://acme.example/pricing',
  actions: { action_no: 1241 },
  impact_measurements: measurement(),
  ...more,
});

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  calls = [];
  assignees.read.mockClear();
  answers = {
    ship_events: {
      data: [
        shipRow('a'),
        shipRow('b', {
          shipped_by: 'teammate-1',
          url: 'https://acme.example/features/',
          impact_measurements: [
            measurement({
              outcome: 'pending',
              confidence: null,
              measured_at: '2026-10-20T06:00:00Z',
            }),
          ],
        }),
      ],
      error: null,
    },
    'ship_events.count': { count: 3, error: null },
    ga_ai_traffic_stats: (call: Call) =>
      call.columns === 'id'
        ? { data: [{ id: 'g1' }], error: null }
        : {
            data: [
              // This month, the pricing page as Analytics keeps it.
              { date: '2026-10-05', landing_page: '/pricing', sessions: 30 },
              { date: '2026-10-06', landing_page: '/features/', sessions: 10 },
              // The month before.
              { date: '2026-09-10', landing_page: '/pricing/', sessions: 20 },
              // Another page: not a changed one.
              { date: '2026-10-05', landing_page: '/blog', sessions: 99 },
            ],
            error: null,
          },
  };
});
afterEach(() => vi.unstubAllEnvs());

describe('readImpactReport', () => {
  it('reads the brand’s month of shipped changes with their measurements, as the person', async () => {
    const result = await readImpactReport(BRAND, RANGE);
    if (!result.ok) throw new Error('not read');
    const { report } = result;
    expect(report.rows.map((r) => [r.key, r.title, r.outcome, r.by])).toEqual([
      ['r1', 'Change a', 'improved', { who: 'you', name: null }],
      ['r2', 'Change b', 'pending', { who: 'teammate', name: 'Alex Kim' }],
    ]);
    expect(report.summary).toEqual({ shipped: 2, previous: 3, improved: 1, judged: 1, pending: 1 });
    expect(report.capped).toBe(false);
    expect(report.dataAsOf).toBe('2026-10-20T06:00:00Z');
    const read = calls.find((c) => c.table === 'ship_events' && !c.options)!;
    expect(read.columns).toContain('impact_measurements!impact_measurements_ship_event_id_fkey(');
    expect(read.columns).toContain('actions!ship_events_action_id_fkey(action_no)');
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id', BRAND],
        ['gte', 'shipped_at', RANGE.from],
        ['lt', 'shipped_at', RANGE.to],
      ]),
    );
    const before = calls.find((c) => c.table === 'ship_events' && c.options)!;
    expect(before.filters).toEqual(
      expect.arrayContaining([
        ['gte', 'shipped_at', RANGE.previousFrom],
        ['lt', 'shipped_at', RANGE.from],
      ]),
    );
    // Only teammates are named: the reader is "you".
    expect(assignees.read.mock.calls[0][2]).toEqual(['teammate-1']);
  });

  it('lists a month’s first 500 changes, and says when it has more', async () => {
    answers.ship_events = {
      data: Array.from({ length: 501 }, (_, i) => shipRow(`s${i}`)),
      error: null,
    };
    const result = await readImpactReport(BRAND, RANGE);
    if (!result.ok) throw new Error('not read');
    expect(result.report.rows).toHaveLength(500);
    expect(result.report.rows.at(-1)?.title).toBe('Change s499');
    expect(result.report.summary.shipped).toBe(500);
    expect(result.report.capped).toBe(true);
    // One more than it lists, to tell.
    const read = calls.find((c) => c.table === 'ship_events' && !c.options)!;
    expect(read.filters).toContainEqual(['limit', 501]);
    answers.ship_events = {
      data: Array.from({ length: 500 }, (_, i) => shipRow(`s${i}`)),
      error: null,
    };
    const all = await readImpactReport(BRAND, RANGE);
    expect(all.ok && [all.report.rows.length, all.report.capped]).toEqual([500, false]);
  });

  it('sums the AI traffic of the changed pages this month and the one before, by their path', async () => {
    const result = await readImpactReport(BRAND, RANGE);
    expect(result.ok && result.report.traffic).toEqual({ current: 40, previous: 20, pages: 2 });
    const read = calls.find((c) => c.table === 'ga_ai_traffic_stats' && c.columns !== 'id')!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id', BRAND],
        ['gte', 'date', '2026-09-01'],
        ['lt', 'date', '2026-11-01'],
        ['in', 'landing_page', ['/pricing', '/pricing/', '/features', '/features/']],
      ]),
    );
  });

  it('has no traffic card without Google Analytics, and none read when it can’t be', async () => {
    answers.ga_ai_traffic_stats = { data: [], error: null };
    let result = await readImpactReport(BRAND, RANGE);
    expect(result.ok && result.report.traffic).toBeNull();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.ga_ai_traffic_stats = { data: null, error: { message: 'down' } };
    result = await readImpactReport(BRAND, RANGE);
    expect(result.ok && result.report.traffic).toBeNull();
    logged.mockRestore();
  });

  it('opens with "a teammate" when names can’t be read, and no month-before count when it can’t be', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    assignees.read.mockRejectedValueOnce(new Error('down'));
    answers['ship_events.count'] = { count: null, error: { message: 'down' } };
    const result = await readImpactReport(BRAND, RANGE);
    expect(result.ok && result.report.rows[1].by).toEqual({ who: 'teammate', name: null });
    expect(result.ok && result.report.summary.previous).toBeNull();
    logged.mockRestore();
  });

  it('reads nothing with the new Chat off, or for a bad brand or range; fails as a value', async () => {
    expect(await readImpactReport('nope', RANGE)).toEqual({ ok: false, failure: 'invalid' });
    expect(await readImpactReport(BRAND, { ...RANGE, to: 'tomorrow' })).toEqual({
      ok: false,
      failure: 'invalid',
    });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    calls = [];
    expect(await readImpactReport(BRAND, RANGE)).toEqual({ ok: false, failure: 'chat_off' });
    expect(calls.some((c) => c.table === 'ship_events')).toBe(false);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.ship_events = { data: null, error: { message: 'down' } };
    expect(await readImpactReport(BRAND, RANGE)).toEqual({ ok: false, failure: 'failed' });
    logged.mockRestore();
  });
});
