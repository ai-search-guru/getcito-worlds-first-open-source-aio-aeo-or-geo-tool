import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module pulls in the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));
const cloro = vi.hoisted(() => ({ submitPromptTask: vi.fn(), pollScraperResult: vi.fn() }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../lib/logger.js', () => ({ default: log, logger: log }));
vi.mock('../lib/cloroScraper.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitPromptTask: cloro.submitPromptTask,
  pollScraperResult: cloro.pollScraperResult,
}));

import {
  allTasksAreStale,
  drainBudgetExceeded,
  fetchAllPendingRows,
  interactiveTailExhausted,
  runnablePlatforms,
  pollTrackingTask,
  runAsksChatgptFanout,
  scraperTasksFor,
  shoppingTracked,
  tailRemainder,
  UNAVAILABLE_PLATFORMS,
} from './trackingWorker.js';
import { getPlan, PLANS } from '../config/plans.js';
import { chatgptFanoutWeekday } from '../lib/chatgptFanout.js';

/**
 * Ghost detection for the Cloro drain loop (#687).
 *
 * A run used to burn its entire stall window whenever Cloro accepted a task
 * and never called back — routine for google-aio, which has nothing to return
 * when a query has no AI Overview. Waiting on those tasks is what stretched
 * the nightly cycle and, worse, parked every brand for the same fixed period
 * so their pulses all woke together and overloaded the database.
 *
 * The exit needs BOTH signals: delivery has gone quiet AND nothing plausibly
 * in flight remains. These tests pin the second half.
 */

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 7, 10, 6, 0, 0);
const ago = (minutes) => new Date(NOW - minutes * MINUTE).toISOString();

describe('allTasksAreStale', () => {
  it('is true when every pending task is older than the cutoff', () => {
    const rows = [{ submitted_at: ago(45) }, { submitted_at: ago(90) }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(true);
  });

  it('is false while even one task is still young enough to arrive', () => {
    // The mixed case is the dangerous one: exiting here would abandon a task
    // that is merely mid-burst, losing results the run was about to receive.
    const rows = [{ submitted_at: ago(90) }, { submitted_at: ago(5) }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(false);
  });

  it('is false for an empty list — a drained queue is not a ghost tail', () => {
    // The caller breaks out on `pending === 0` before consulting this, so
    // reporting "stale" here would conflate success with abandonment.
    expect(allTasksAreStale([], 30 * MINUTE, NOW)).toBe(false);
    expect(allTasksAreStale(null, 30 * MINUTE, NOW)).toBe(false);
  });

  it('treats a task exactly at the cutoff as still in flight', () => {
    const rows = [{ submitted_at: ago(30) }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(false);
  });

  it('never calls a row without a submitted_at stale', () => {
    // A missing timestamp means unknown age, and guessing "old" would drop
    // tasks that may still be running.
    const rows = [{ submitted_at: ago(90) }, { submitted_at: null }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(false);
  });
});

/**
 * Drain time budgets (#702).
 *
 * A single 60-minute cap measured from submission discarded three consecutive
 * nightly runs on the largest brand: Cloro's first callback landed 62-65
 * minutes after submission, so the worker gave up minutes before the delivery
 * it was waiting for, then reported zero results and had its ledger row
 * deleted — freezing the dashboard and the pulse on the previous day while
 * ~1800 results landed just afterwards.
 *
 * Splitting the budget in two is what fixes it: waiting for the first result
 * is a different situation from waiting out the tail, and only the second one
 * has anything to measure.
 */
describe('drainBudgetExceeded', () => {
  const FIRST_RESULT_WAIT = 90 * MINUTE;
  const TAIL = 60 * MINUTE;
  const budget = (over) =>
    drainBudgetExceeded({
      firstResultWaitMs: FIRST_RESULT_WAIT,
      drainTailMs: TAIL,
      ...over,
    });

  it('keeps waiting past the old 60-minute cap when nothing has arrived yet', () => {
    // The exact case that broke: first delivery at 65 minutes.
    expect(budget({ now: NOW + 65 * MINUTE, drainStartedAt: NOW, firstResultAt: null })).toBeNull();
  });

  it('gives up once the first-result budget is spent', () => {
    expect(budget({ now: NOW + 90 * MINUTE, drainStartedAt: NOW, firstResultAt: null })).toBe(
      'no_first_result',
    );
  });

  it('measures the tail from the first result, not from submission', () => {
    // 80 minutes into the drain, but delivery only started 30 minutes ago:
    // the tail still has time even though the total exceeds the tail budget.
    expect(
      budget({
        now: NOW + 80 * MINUTE,
        drainStartedAt: NOW,
        firstResultAt: NOW + 50 * MINUTE,
      }),
    ).toBeNull();
  });

  it('gives up once the tail budget is spent', () => {
    expect(
      budget({
        now: NOW + 120 * MINUTE,
        drainStartedAt: NOW,
        firstResultAt: NOW + 60 * MINUTE,
      }),
    ).toBe('tail_deadline');
  });

  it('treats an undefined first result the same as null', () => {
    expect(budget({ now: NOW + 95 * MINUTE, drainStartedAt: NOW, firstResultAt: undefined })).toBe(
      'no_first_result',
    );
  });
});

/**
 * Paged pending-task reads (#714).
 *
 * The drain read was un-paginated, and PostgREST silently caps those at 1000
 * rows. The largest brand submits ~2130 tasks, so every poll reported exactly
 * 1000 pending: on the first poll that read as "1130 tasks already finished"
 * — starting the stall clock against a run that had received nothing — and on
 * every poll after it as "nothing is moving", because the number never
 * changed. Fifteen minutes of that plus tasks crossing the ghost age exited
 * the run four seconds after the threshold, four minutes before its first
 * result arrived. Three nights of the brand's dashboard froze on it.
 *
 * It only ever bit the one brand over 1000 tasks, which is why it looked like
 * a brand-specific problem rather than a query bug.
 */
describe('fetchAllPendingRows', () => {
  const pageOf = (n, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ task_id: `t${from + i}`, submitted_at: null }));

  it('returns every row when the set spans several pages', async () => {
    // 2130 rows: what the largest brand actually submits.
    const all = pageOf(2130);
    const fetchPage = async (offset) => ({
      data: all.slice(offset, offset + 1000),
      error: null,
    });

    const { rows, error } = await fetchAllPendingRows(fetchPage);

    expect(error).toBeNull();
    expect(rows).toHaveLength(2130);
  });

  it('stops after one request when the set fits in a page', async () => {
    const calls = [];
    const fetchPage = async (offset) => {
      calls.push(offset);
      return { data: pageOf(840), error: null };
    };

    const { rows } = await fetchAllPendingRows(fetchPage);

    expect(rows).toHaveLength(840);
    expect(calls).toEqual([0]);
  });

  it('asks for one more page when a page comes back exactly full', async () => {
    const calls = [];
    const fetchPage = async (offset) => {
      calls.push(offset);
      return { data: offset === 0 ? pageOf(1000) : [], error: null };
    };

    const { rows } = await fetchAllPendingRows(fetchPage);

    expect(rows).toHaveLength(1000);
    expect(calls).toEqual([0, 1000]);
  });

  it('reports an error rather than returning a partial set', async () => {
    // A half-read pending set looks like progress that never happened, which
    // is precisely the failure this whole change exists to prevent.
    const fetchPage = async (offset) =>
      offset === 0
        ? { data: pageOf(1000), error: null }
        : { data: null, error: { message: 'boom' } };

    const { rows, error } = await fetchAllPendingRows(fetchPage);

    expect(rows).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });

  it('handles an empty pending set', async () => {
    const { rows, error } = await fetchAllPendingRows(async () => ({ data: [], error: null }));

    expect(rows).toEqual([]);
    expect(error).toBeNull();
  });
});

/**
 * What a run is allowed to submit (#731 follow-up).
 *
 * Every id that survives this filter becomes a paid Cloro task, so the two
 * reasons to drop one — the brand turned Shopping off, the platform is down —
 * both have to hold at run time, not at the moment the prompt was saved.
 */
describe('runnablePlatforms', () => {
  it('drops a platform that is currently unavailable', () => {
    expect(
      runnablePlatforms(['chatgpt-web', 'grok-web', 'perplexity-web'], { shoppingEnabled: true }),
    ).toEqual(['chatgpt-web', 'perplexity-web']);
  });

  it('drops shopping unless the brand has it enabled', () => {
    expect(
      runnablePlatforms(['chatgpt-web', 'chatgpt-shopping'], { shoppingEnabled: false }),
    ).toEqual(['chatgpt-web']);
    expect(
      runnablePlatforms(['chatgpt-web', 'chatgpt-shopping'], { shoppingEnabled: true }),
    ).toEqual(['chatgpt-web', 'chatgpt-shopping']);
  });

  it('applies both reasons at once', () => {
    expect(
      runnablePlatforms(['grok-web', 'chatgpt-shopping', 'gemini-web'], { shoppingEnabled: false }),
    ).toEqual(['gemini-web']);
  });

  it('returns an empty list for a prompt with no platforms', () => {
    expect(runnablePlatforms([], { shoppingEnabled: true })).toEqual([]);
    expect(runnablePlatforms(null, { shoppingEnabled: true })).toEqual([]);
    expect(runnablePlatforms(undefined, { shoppingEnabled: true })).toEqual([]);
  });

  // A prompt that lists only the unavailable platform must submit nothing at
  // all, rather than falling back to "no filter means run everything".
  it('leaves nothing to run when every platform is unavailable', () => {
    expect(runnablePlatforms([...UNAVAILABLE_PLATFORMS], { shoppingEnabled: true })).toEqual([]);
  });
});

describe('shoppingTracked', () => {
  const on = { shopping_mode_enabled: true };

  it('runs ChatGPT Shopping only where the plan shows its results', () => {
    expect(shoppingTracked(on, PLANS.growth)).toBe(true);
    expect(shoppingTracked(on, PLANS.enterprise)).toBe(true);
    // Starter has no Shopping page: its scrapes would be paid for and unseen.
    expect(shoppingTracked(on, PLANS.starter)).toBe(false);
  });

  it('runs it on self-host, and nowhere with Shopping mode off', () => {
    expect(shoppingTracked(on, null)).toBe(true);
    expect(shoppingTracked({ shopping_mode_enabled: false }, PLANS.growth)).toBe(false);
    expect(shoppingTracked({ shopping_mode_enabled: false }, null)).toBe(false);
  });

  it('fails closed on cloud for a plan id it does not know', () => {
    vi.stubEnv('IS_CLOUD', 'true');
    try {
      // getPlan falls back to Starter, which has no Shopping page.
      expect(shoppingTracked(on, getPlan('bogus'))).toBe(false);
      expect(shoppingTracked(on, getPlan('growth'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * The short tail for watched runs.
 *
 * A brand's first analysis is started from the UI and its progress bar stays on
 * screen for as long as the drain loop polls. One measured run delivered all
 * 292 of its results in four and a half minutes, then held the bar at 292/294
 * for another twenty-five waiting on two google-aio tasks that were never going
 * to call back. Across ten days, runs spent an average of 19 minutes waiting on
 * ghosts against 14 minutes actually receiving results.
 *
 * Nothing is lost by leaving early: /cloro/callback inserts a late delivery
 * whether or not the loop is still watching.
 */
describe('tailRemainder', () => {
  it('scales with the run for a large brand', () => {
    expect(tailRemainder(294)).toBe(15);
  });

  it('never falls below three, so one ghost cannot hold a small run open', () => {
    // A single-prompt refresh submits about seven tasks; 5% of that rounds to
    // one, which would leave a lone ghost blocking the exit.
    expect(tailRemainder(7)).toBe(3);
    expect(tailRemainder(1)).toBe(3);
  });
});

describe('interactiveTailExhausted', () => {
  const exhausted = (over) =>
    interactiveTailExhausted({ expected: 294, quietPollLimit: 8, ...over });

  it('gives up on the measured case — 2 of 294 left, two minutes of quiet', () => {
    expect(exhausted({ pending: 2, quietPolls: 8 })).toBe(true);
  });

  it('keeps waiting while the queue is still delivering', () => {
    expect(exhausted({ pending: 2, quietPolls: 7 })).toBe(false);
  });

  // The whole point of the remainder: a run missing a real chunk of its
  // results is not "finishing up", however quiet the queue has gone.
  it('keeps waiting when a meaningful share of the run is still outstanding', () => {
    expect(exhausted({ pending: 60, quietPolls: 40 })).toBe(false);
  });

  it('holds a small run open for one ghost but not for four', () => {
    expect(exhausted({ pending: 1, expected: 7, quietPolls: 8 })).toBe(true);
    expect(exhausted({ pending: 4, expected: 7, quietPolls: 8 })).toBe(false);
  });

  it('defers to the caller when the drain is already complete', () => {
    expect(exhausted({ pending: 0, quietPolls: 99 })).toBe(false);
  });
});

describe('runAsksChatgptFanout', () => {
  it("asks on the nightly run's first attempt only", () => {
    expect(runAsksChatgptFanout({ source: 'cron', attempt: 1 })).toBe(true);
    // A retry, or a recovered run, may follow an attempt that already paid.
    expect(runAsksChatgptFanout({ source: 'cron', attempt: 2 })).toBe(false);
    // /check, analyze-new and the internal trigger are all manual runs.
    expect(runAsksChatgptFanout({ source: 'manual', attempt: 1 })).toBe(false);
    expect(runAsksChatgptFanout({ source: 'cron' })).toBe(false);
  });
});

describe('scraperTasksFor', () => {
  const prompt = { id: '00000000-0000-4000-8000-000000000001', text: 'best crm' };
  const day = chatgptFanoutWeekday(prompt.id);
  // 2026-10-25 was a Sunday (0); the prompt's day and the day after it.
  const itsDay = new Date(Date.UTC(2026, 9, 25 + day, 2));
  const nextDay = new Date(Date.UTC(2026, 9, 26 + day, 2));
  const build = (chatgptFanout) =>
    scraperTasksFor([prompt], {
      platformsFor: () => ['chatgpt-web', 'chatgpt-shopping', 'copilot-web'],
      locationsFor: () => ['US', 'US-CA'],
      chatgptFanout,
    }).map((t) => [t.scraperId, t.region, t.legacy]);

  it("asks ChatGPT's every location on the prompt's day, and nothing else", () => {
    expect(itsDay.getUTCDay()).toBe(day);
    expect(build({ mode: 'sample', date: itsDay })).toEqual([
      ['chatgpt-web', 'US', true],
      ['chatgpt-web', 'US-CA', true],
      ['chatgpt-shopping', 'US', false],
      ['chatgpt-shopping', 'US-CA', false],
      ['copilot-web', 'US', false],
      ['copilot-web', 'US-CA', false],
    ]);
  });

  it("follows the run's date and mode", () => {
    const asked = (fanout) => build(fanout).filter(([, , legacy]) => legacy).length;
    expect(asked({ mode: 'sample', date: nextDay })).toBe(0);
    expect(asked({ mode: 'all', date: nextDay })).toBe(2);
    expect(asked({ mode: 'off', date: itsDay })).toBe(0);
  });

  it('asks nothing in a run that may not ask', () => {
    expect(build(null).filter(([, , legacy]) => legacy)).toEqual([]);
  });
});

describe('pollTrackingTask', () => {
  const meta = { prompt: { id: 'prompt-1', text: 'best crm' }, region: 'US-CA' };
  const answer = { text: 'answer', citations: [], model: 'gpt-6' };
  const failed = () =>
    Object.assign(new Error('Cloro task t1 failed: legacy unavailable'), { taskFailed: true });

  beforeEach(() => {
    cloro.submitPromptTask.mockReset();
    cloro.pollScraperResult.mockReset();
    log.warn.mockClear();
  });

  it('sends a legacy ChatGPT task Cloro failed again without legacy, and polls that', async () => {
    cloro.pollScraperResult.mockRejectedValueOnce(failed()).mockResolvedValueOnce(answer);
    cloro.submitPromptTask.mockResolvedValue({
      taskId: 't2',
      scraperId: 'chatgpt-web',
      legacy: false,
    });

    await expect(
      pollTrackingTask({ taskId: 't1', scraperId: 'chatgpt-web', legacy: true, meta }),
    ).resolves.toBe(answer);
    expect(cloro.submitPromptTask).toHaveBeenCalledWith({
      promptText: 'best crm',
      promptId: 'prompt-1',
      scraperId: 'chatgpt-web',
      region: 'US-CA',
    });
    expect(cloro.pollScraperResult.mock.calls.map(([taskId]) => taskId)).toEqual(['t1', 't2']);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('leaves any other failure as it was', async () => {
    for (const [task, err] of [
      [{ scraperId: 'chatgpt-web', legacy: false }, failed()],
      [{ scraperId: 'copilot-web', legacy: true }, failed()],
      [
        { scraperId: 'chatgpt-web', legacy: true },
        new Error('Cloro task t1 timed out after 1800s'),
      ],
    ]) {
      cloro.pollScraperResult.mockReset().mockRejectedValueOnce(err);
      await expect(pollTrackingTask({ taskId: 't1', ...task, meta })).rejects.toBe(err);
    }
    expect(cloro.submitPromptTask).not.toHaveBeenCalled();
  });
});
