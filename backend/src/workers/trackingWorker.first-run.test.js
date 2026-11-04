import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's first run (no run of it ever stamped), end to end through the
 * worker in webhook mode: its rollups refresh while Cloro's answers land, and
 * the stamp gets its refresher and checks every 30 s. Later runs are as before.
 */

const STARTED = '2026-10-29T10:00:00.000Z';
const db = vi.hoisted(() => ({ stampedRuns: [], pendingPolls: [] }));

vi.mock('../config/supabase.js', () => {
  const answer = (table, ops) => {
    const did = (op) => ops.includes(op);
    switch (table) {
      case 'brands':
        return {
          data: { id: 'b1', name: 'Acme', organization_id: 'o1', shopping_mode_enabled: false },
        };
      case 'brand_domains':
        return { data: [{ domain: 'acme.example' }] };
      case 'prompt_sets':
        return { data: [{ id: 's1' }] };
      case 'prompts':
        return {
          data: [{ id: 'p1', text: 'best x', platforms: ['chatgpt-web', 'copilot-web'] }],
          error: null,
        };
      case 'tracking_runs':
        if (did('insert')) return { data: { id: 'r1', started_at: STARTED }, error: null };
        if (did('not')) return { data: db.stampedRuns, error: null };
        return { error: null };
      case 'cloro_pending_tasks':
        if (did('insert')) return { error: null };
        return { data: db.pendingPolls.shift() ?? [], error: null };
      case 'prompt_results':
        return { data: [{ id: 'result-1' }], error: null };
      default:
        return { data: null, error: null };
    }
  };
  return {
    default: {
      from: (table) => {
        const ops = [];
        const chain = new Proxy(
          {},
          {
            get: (_target, prop) => {
              if (prop === 'then')
                return (resolve, reject) =>
                  Promise.resolve(answer(table, ops)).then(resolve, reject);
              if (prop === 'single' || prop === 'maybeSingle')
                return async () => answer(table, ops);
              return () => {
                ops.push(prop);
                return chain;
              };
            },
          },
        );
        return chain;
      },
    },
  };
});

let taskIds = 0;
vi.mock('../lib/cloroScraper.js', () => ({
  submitPromptTask: vi.fn(async ({ scraperId, legacy = false }) => ({
    taskId: `t${++taskIds}`,
    scraperId,
    legacy,
  })),
  isLegacyChatgptTask: vi.fn(() => false),
  pollScraperResult: vi.fn(),
}));
vi.mock('../lib/cloroCountries.js', () => ({
  loadSupportedCountries: async () => new Map(),
  supportedLocations: (locations) => locations,
}));
const settleTrackingRun = vi.hoisted(() => vi.fn());
vi.mock('../lib/runSettlement.js', () => ({ settleTrackingRun }));
const refreshRunDays = vi.hoisted(() => vi.fn());
vi.mock('../lib/insightsRollups.js', () => ({ refreshRunDays }));
vi.mock('../lib/aiTracker.js', () => ({ runPrompt: vi.fn(), analyzeSentimentAI: vi.fn() }));
vi.mock('../lib/opportunityGenerator.js', () => ({ generateContentOpportunities: vi.fn() }));
vi.mock('../lib/promptClusters.js', () => ({ refreshPromptClusters: vi.fn() }));
vi.mock('../lib/sitePages.js', () => ({ refreshSitePages: vi.fn() }));
vi.mock('../lib/targetUrlStats.js', () => ({ updateTargetUrlStats: vi.fn() }));
vi.mock('../lib/citationRows.js', () => ({ persistCitationRows: vi.fn() }));

const { processTrackingJob } = await import('./trackingWorker.js');

const pending = (...ids) => ids.map((id) => ({ task_id: id, submitted_at: STARTED }));

/** A full run, its drain polled every 15 s. */
async function fullRun() {
  const result = processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(15_000);
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('CLORO_WEBHOOK_URL', 'https://api.example/cloro/callback');
  taskIds = 0;
  settleTrackingRun.mockReset().mockResolvedValue({ stamped: true, lateStamp: null });
  refreshRunDays.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('processTrackingJob, a brand’s first run', () => {
  it('refreshes the rollups as answers land, and hands the stamp its refresher', async () => {
    db.stampedRuns = [];
    // Two tasks submitted; one answered by the second poll, both by the third.
    db.pendingPolls = [pending('t1', 't2'), pending('t2'), []];

    // Its stamp e-mails "Your first results are ready" (jobRunner.js).
    expect(await fullRun()).toMatchObject({ firstRun: true });

    expect(refreshRunDays).toHaveBeenCalledWith('b1', STARTED);
    const [, options] = settleTrackingRun.mock.calls[0];
    expect(options.pollMs).toBe(30_000);
    expect(options.rollups).toEqual(
      expect.objectContaining({
        note: expect.any(Function),
        idle: expect.any(Function),
        flush: expect.any(Function),
      }),
    );
  });

  it('leaves a later run as it was: no refresh mid-run, the usual stamp', async () => {
    db.stampedRuns = [{ id: 'yesterday' }];
    db.pendingPolls = [pending('t1', 't2'), pending('t2'), []];

    expect(await fullRun()).toMatchObject({ firstRun: false });

    expect(refreshRunDays).not.toHaveBeenCalled();
    expect(settleTrackingRun.mock.calls[0][1]).toBeUndefined();
  });
});
