import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
const rpc = vi.fn();
vi.mock('../../../config/supabase.js', () => ({
  default: { from: (...a) => from(...a), rpc: (...a) => rpc(...a) },
}));
vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../composio.js', () => ({ runGaReport: vi.fn() }));

import { blockedReason, runTask, sweepTaskExecution } from './run.js';
import { ENGINE_THRESHOLDS } from '../../../config/actionEngine.js';

const { maxTaskRunsPerNight } = ENGINE_THRESHOLDS.noise;
import { TOOLS } from './tools.js';
import { ReadLaterError } from '../competitorPages.js';

const TASK = 'task-1';
const ACTION = 'action-1';
const BRAND = 'brand-1';
const NOW = new Date('2026-09-25T06:00:00Z');
const ALL = new Set(['tracking', 'competitors', 'site_audits', 'analytics']);

/**
 * Enough PostgREST to drive one run. Tables answer from fixtures; every write
 * is recorded so a test can assert what the attempt actually left behind.
 */
function mockDb({ task, action, siblings = [], eventsFail = false }) {
  const writes = { inserted: [], updated: [] };
  from.mockImplementation((table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      // `.single()` fetches one row — the task, or its action. Awaiting the
      // builder without it is the sibling list.
      single: () => Promise.resolve({ data: table === 'actions' ? action : task, error: null }),
      insert: (row) => {
        writes.inserted.push({ table, row });
        return Promise.resolve({
          error: eventsFail && table === 'action_events' ? { message: 'insert denied' } : null,
        });
      },
      update: (patch) => {
        writes.updated.push({ table, patch });
        return builder;
      },
      then: (resolve, reject) =>
        Promise.resolve({
          data: table === 'action_tasks' ? siblings : [],
          error: null,
        }).then(resolve, reject),
    };
    return builder;
  });
  return writes;
}

const task = (over = {}) => ({
  id: TASK,
  action_id: ACTION,
  task_key: 'validate',
  status: 'todo',
  depends_on: [],
  approved_by: null,
  ...over,
});

const action = { id: ACTION, brand_id: BRAND, payload: { promptCount: 4 } };

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { answers: 100, mention_answers: 20, citation_answers: 8 },
    error: null,
  });
});

describe('runTask', () => {
  it('carries out a task through its tool and stores the result', async () => {
    const writes = mockDb({ task: task(), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result.status).toBe('succeeded');
    const run = writes.inserted.find((w) => w.table === 'action_task_runs');
    expect(run.row).toMatchObject({
      task_id: TASK,
      action_id: ACTION,
      brand_id: BRAND,
      tool_id: 'visibility_window',
      status: 'succeeded',
    });
    expect(run.row.finished_at).toBeTruthy();

    const completed = writes.updated.find((w) => w.table === 'action_tasks');
    expect(completed.patch.status).toBe('completed');
    expect(completed.patch.output.answers).toBe(100);
  });

  /**
   * The rule the whole layer exists for. No tool that writes to a
   * third-party system ships yet, so this stands one in — the gate has to be
   * provable before there is something for it to hold back, not afterwards.
   */
  describe('changing something outside GetCito', () => {
    const outreach = { id: 'outreach', version: 1, writesExternally: true, source: 'tracking' };
    const primitive = { mode: 'agent', tool: 'outreach' };

    it('refuses to run without an approval', () => {
      expect(
        blockedReason({
          task: task({ approved_by: null }),
          primitive,
          tool: outreach,
          sources: ALL,
          siblings: [],
        }),
      ).toMatch(/not been approved/);
    });

    it('runs once a person has approved it', () => {
      expect(
        blockedReason({
          task: task({ approved_by: 'user-1' }),
          primitive,
          tool: outreach,
          sources: ALL,
          siblings: [],
        }),
      ).toBeNull();
    });

    /** Reading a system the brand connected is not a change. Requiring
     *  approval for it would teach people to approve without reading. */
    it('does not ask for approval to read', () => {
      expect(
        blockedReason({
          task: task({ approved_by: null }),
          primitive: { mode: 'agent', tool: 'visibility_window' },
          tool: TOOLS.visibility_window,
          sources: ALL,
          siblings: [],
        }),
      ).toBeNull();
    });
  });

  /** One step failing is one step to do by hand, not a plan cancelled. */
  it('fails the task and leaves the action alone', async () => {
    rpc.mockRejectedValue(new Error('statement timeout'));
    const writes = mockDb({ task: task(), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result.status).toBe('failed');
    expect(writes.updated.find((w) => w.table === 'action_tasks').patch.status).toBe('failed');
    expect(writes.updated.some((w) => w.table === 'actions')).toBe(false);
    const run = writes.inserted.find((w) => w.table === 'action_task_runs');
    expect(run.row).toMatchObject({ status: 'failed' });
    expect(run.row.error).toContain('timeout');
  });

  /** A tool whose reads for the day are spent (learning C1) tries again the next night. */
  it('leaves the task as it was when its tool can only go on tomorrow', async () => {
    rpc.mockRejectedValue(Object.assign(new Error('reads for today spent'), { retryLater: true }));
    const writes = mockDb({ task: task(), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result).toEqual({ status: 'blocked', reason: 'reads for today spent' });
    expect(writes.updated.some((w) => w.table === 'action_tasks')).toBe(false);
    expect(writes.inserted.find((w) => w.table === 'action_task_runs').row).toMatchObject({
      status: 'blocked',
      error: 'reads for today spent',
    });
    expect(writes.inserted.some((w) => w.table === 'action_events')).toBe(false);
  });

  /**
   * A tool with nothing to work on (learning C1: no page cited) doesn't
   * complete its task: the task stays a person's, shows why, and the sweep
   * passes it over for a week.
   */
  it('leaves the task to a person, with why, when its tool found nothing to work on', async () => {
    const why = { competitorPages: [], gaps: [], reason: 'none_cited' };
    rpc.mockRejectedValue(new ReadLaterError('no page cited', { output: why, retryDays: 7 }));
    const writes = mockDb({ task: task(), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    const retryAfter = '2026-10-02T06:00:00.000Z';
    expect(result).toEqual({ status: 'blocked', reason: 'no page cited', retryAfter });
    const [kept, ...more] = writes.updated.filter((w) => w.table === 'action_tasks');
    expect(more).toEqual([]);
    expect(kept.patch).not.toHaveProperty('status');
    expect(kept.patch.output).toEqual({ ...why, retryAfter });
    expect(writes.inserted.find((w) => w.table === 'action_task_runs').row).toMatchObject({
      status: 'blocked',
      output: why,
      error: 'no page cited',
    });
    expect(writes.inserted.some((w) => w.table === 'action_events')).toBe(false);
  });

  it('records a blocked attempt rather than passing over it in silence', async () => {
    const writes = mockDb({ task: task({ task_key: 'update_content' }), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result.status).toBe('blocked');
    expect(writes.inserted.find((w) => w.table === 'action_task_runs').row).toMatchObject({
      status: 'blocked',
    });
  });

  /**
   * Without this the layer is worse than not automating: a task marked
   * complete that nobody remembers doing, with no trail and nobody to ask.
   * The audit table has no interface — the drawer's History tab reads
   * `action_events`.
   */
  describe('the trail the user sees', () => {
    const events = (writes) => writes.inserted.filter((w) => w.table === 'action_events');

    it('says the task was carried out, and with what', async () => {
      const writes = mockDb({ task: task(), action });

      await runTask(TASK, { now: NOW, sources: ALL });

      expect(events(writes)).toHaveLength(1);
      expect(events(writes)[0].row).toMatchObject({
        action_id: ACTION,
        event: 'task_ran',
        data: { task: 'validate', tool: 'visibility_window' },
      });
    });

    /** Null actor is already how the nightly engine records its own events:
     *  it means the product did this, not a person. */
    it('records no person as the actor', async () => {
      const writes = mockDb({ task: task(), action });

      await runTask(TASK, { now: NOW, sources: ALL });

      expect(events(writes)[0].row.actor_id).toBeNull();
    });

    it('says so when the attempt failed', async () => {
      rpc.mockRejectedValue(new Error('statement timeout'));
      const writes = mockDb({ task: task(), action });

      await runTask(TASK, { now: NOW, sources: ALL });

      expect(events(writes)[0].row).toMatchObject({ event: 'task_run_failed' });
    });

    /**
     * A task with no tool yet, or one waiting on another task, is operational
     * detail. It is in the audit table; putting it in a trail people read to
     * understand their own work would be noise.
     */
    it('stays out of the trail when the reason is ours, not theirs', async () => {
      const writes = mockDb({ task: task({ task_key: 'coverage_gaps' }), action });

      const result = await runTask(TASK, { now: NOW, sources: ALL });

      expect(result.status).toBe('blocked');
      expect(events(writes)).toHaveLength(0);
      expect(writes.inserted.some((w) => w.table === 'action_task_runs')).toBe(true);
    });

    /** A completed run must not be undone by a trail that failed to write. */
    it('does not fail the run when the trail cannot be written', async () => {
      const writes = mockDb({ task: task(), action, eventsFail: true });

      const result = await runTask(TASK, { now: NOW, sources: ALL });

      expect(result.status).toBe('succeeded');
      expect(writes.updated.find((w) => w.table === 'action_tasks').patch.status).toBe('completed');
    });
  });

  it('never stores the model’s reasoning, because nothing may put it there', async () => {
    const writes = mockDb({ task: task(), action });

    await runTask(TASK, { now: NOW, sources: ALL });

    const run = writes.inserted.find((w) => w.table === 'action_task_runs').row;
    expect(Object.keys(run)).toEqual(
      expect.not.arrayContaining(['reasoning', 'thoughts', 'chain_of_thought']),
    );
  });
});

describe('blockedReason', () => {
  const primitive = { mode: 'agent', tool: 'visibility_window' };
  const tool = TOOLS.visibility_window;

  it('lets a runnable task through', () => {
    expect(blockedReason({ task: task(), primitive, tool, sources: ALL, siblings: [] })).toBeNull();
  });

  it('stops a task a person owns', () => {
    expect(
      blockedReason({
        task: task(),
        primitive: { mode: 'human', tool: null },
        tool: null,
        sources: ALL,
        siblings: [],
      }),
    ).toMatch(/by a person/);
  });

  /** Fourteen agent-mode tasks have no tool yet. Saying so is the difference
   *  between an honest gap and a silent one. */
  it('names the gap when a task is meant to be automated and is not yet', () => {
    expect(
      blockedReason({
        task: task({ task_key: 'coverage_gaps' }),
        primitive: { mode: 'agent', tool: null },
        tool: null,
        sources: ALL,
        siblings: [],
      }),
    ).toMatch(/no tool implements coverage_gaps/);
  });

  it('stops a tool whose source the brand does not have', () => {
    expect(
      blockedReason({
        task: task(),
        primitive,
        tool: { ...tool, source: 'analytics' },
        sources: new Set(['tracking']),
        siblings: [],
      }),
    ).toMatch(/no analytics source/);
  });

  it('waits for the tasks this one depends on', () => {
    expect(
      blockedReason({
        task: task({ depends_on: ['analyze_losses'] }),
        primitive,
        tool,
        sources: ALL,
        siblings: [{ task_key: 'analyze_losses', status: 'todo' }],
      }),
    ).toMatch(/waits on analyze_losses/);
  });

  it('treats a skipped dependency as finished, because nobody is going to do it', () => {
    expect(
      blockedReason({
        task: task({ depends_on: ['analyze_losses'] }),
        primitive,
        tool,
        sources: ALL,
        siblings: [{ task_key: 'analyze_losses', status: 'skipped' }],
      }),
    ).toBeNull();
  });

  it('ignores a dependency that was never planned', () => {
    expect(
      blockedReason({
        task: task({ depends_on: ['a_task_this_plan_does_not_have'] }),
        primitive,
        tool,
        sources: ALL,
        siblings: [],
      }),
    ).toBeNull();
  });

  it('does not re-run a task that is already done', () => {
    expect(
      blockedReason({
        task: task({ status: 'completed' }),
        primitive,
        tool,
        sources: ALL,
        siblings: [],
      }),
    ).toMatch(/is completed/);
  });
});

/**
 * The nightly sweep (#818 phase 7). What makes this safe to leave running is
 * not that nothing fails — it is that a failure costs one step, and that the
 * night has a ceiling.
 */
describe('sweepTaskExecution', () => {
  /** Enough of the builder for the sweep's one query plus whatever runTask
   *  does per task, which is already covered above. */
  function mockSweep(tasks) {
    const attempted = [];
    from.mockImplementation((table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () =>
          Promise.resolve({
            data:
              table === 'actions'
                ? { id: ACTION, brand_id: BRAND, payload: {} }
                : { ...task({ id: attempted.at(-1) }), task_key: 'validate' },
            error: null,
          }),
        insert: () => Promise.resolve({ error: null }),
        update: () => builder,
        then: (resolve, reject) =>
          Promise.resolve({ data: table === 'action_tasks' ? tasks : [], error: null }).then(
            resolve,
            reject,
          ),
      };
      return builder;
    });
    return attempted;
  }

  it('does nothing when no task has a tool', async () => {
    mockSweep([{ id: 't1', task_key: 'update_content', action_id: ACTION }]);

    const summary = await sweepTaskExecution({ now: NOW });

    expect(summary).toMatchObject({ succeeded: 0, failed: 0, blocked: 0 });
  });

  it('stops at the nightly ceiling and says it did', async () => {
    const many = Array.from({ length: maxTaskRunsPerNight + 3 }, (_, i) => ({
      id: `t${i}`,
      task_key: 'validate',
      action_id: ACTION,
    }));
    mockSweep(many);

    const summary = await sweepTaskExecution({ now: NOW });

    expect(summary.skippedForCeiling).toBe(3);
    expect(summary.succeeded + summary.failed + summary.blocked).toBe(maxTaskRunsPerNight);
  });

  it('passes over a task waiting to be tried again, without it taking a place', async () => {
    const waiting = {
      task_key: 'validate',
      action_id: ACTION,
      retry_after: '2026-10-01T00:00:00Z',
    };
    const due = Array.from({ length: maxTaskRunsPerNight }, (_, i) => ({
      id: `t${i}`,
      task_key: 'validate',
      action_id: ACTION,
      // Its week is over: tried again.
      ...(i === 0 ? { retry_after: '2026-09-24T00:00:00Z' } : {}),
    }));
    mockSweep([{ id: 'w1', ...waiting }, { id: 'w2', ...waiting }, ...due]);

    const summary = await sweepTaskExecution({ now: NOW });

    expect(summary.waitingToRetry).toBe(2);
    expect(summary.skippedForCeiling).toBe(0);
    expect(summary.succeeded + summary.failed + summary.blocked).toBe(maxTaskRunsPerNight);
  });

  it('carries on past a task that throws unexpectedly', async () => {
    mockSweep([
      { id: 't1', task_key: 'validate', action_id: ACTION },
      { id: 't2', task_key: 'validate', action_id: ACTION },
    ]);
    let calls = 0;
    rpc.mockImplementation(() => {
      calls += 1;
      return calls <= 2
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: { answers: 1 }, error: null });
    });

    const summary = await sweepTaskExecution({ now: NOW });

    expect(summary.succeeded + summary.failed).toBe(2);
  });

  /**
   * The sweep reads the 1,000 oldest candidates. On the cloud the query
   * itself keeps to organizations on a plan, so an organization's old tasks
   * can't fill the read and push out the tasks of one that pays.
   */
  function mockPlanSweep(rows) {
    const asked = { filters: [] };
    from.mockImplementation((table) => {
      const sweep = table === 'action_tasks' && asked.select === undefined;
      const builder = {
        select: (columns) => {
          if (sweep) asked.select = columns;
          return builder;
        },
        eq: (column, value) => {
          if (sweep) asked.filters.push([column, value]);
          return builder;
        },
        in: (column, values) => {
          if (sweep) asked.filters.push([column, values]);
          return builder;
        },
        not: () => builder,
        order: () => builder,
        limit: (max) => {
          if (sweep) asked.limit = max;
          return builder;
        },
        single: () =>
          Promise.resolve({
            data:
              table === 'actions'
                ? { id: ACTION, brand_id: BRAND, payload: {} }
                : { ...task({ id: 'paying' }), task_key: 'validate' },
            error: null,
          }),
        insert: () => Promise.resolve({ error: null }),
        update: () => builder,
        then: (resolve, reject) => {
          let data = [];
          if (sweep) {
            const plan = asked.filters.find(
              ([column]) => column === 'actions.brands.organizations.subscription_status',
            );
            data = rows
              .filter(
                (row) =>
                  !plan || plan[1].includes(row.actions.brands.organizations.subscription_status),
              )
              .slice(0, asked.limit);
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    });
    return asked;
  }

  const onPlan = (status) => ({
    status: 'open',
    brands: { organizations: { subscription_status: status } },
  });
  const lapsedThenPaying = () => [
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `lapsed-${i}`,
      task_key: 'validate',
      action_id: ACTION,
      actions: onPlan('canceled'),
    })),
    { id: 'paying', task_key: 'validate', action_id: ACTION, actions: onPlan('active') },
  ];

  it("reads past an organization's 1,000 old tasks once its plan has ended (cloud)", async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    try {
      const asked = mockPlanSweep(lapsedThenPaying());

      const summary = await sweepTaskExecution({ now: NOW });

      expect(asked.select).toContain(
        'actions!inner(status, brands!inner(is_demo, organizations!inner(subscription_status)))',
      );
      expect(asked.filters).toContainEqual([
        'actions.brands.organizations.subscription_status',
        ['active', 'trialing'],
      ]);
      // The paying organization's task, and only it, is carried out.
      expect(summary.succeeded + summary.failed + summary.blocked).toBe(1);
      expect(summary.skippedForCeiling).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('filters nothing by plan self-hosted', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    try {
      const asked = mockPlanSweep(lapsedThenPaying());
      await sweepTaskExecution({ now: NOW });
      expect(asked.select).toBe(
        'id, task_key, action_id, retry_after:output->>retryAfter, actions!inner(status, brands!inner(is_demo))',
      );
      expect(asked.filters.map(([column]) => column)).not.toContain(
        'actions.brands.organizations.subscription_status',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never reads a demo brand's tasks (00380), on the cloud or self-hosted", async () => {
    for (const cloud of ['true', 'false']) {
      vi.stubEnv('IS_CLOUD', cloud);
      try {
        const asked = mockPlanSweep([]);
        await sweepTaskExecution({ now: NOW });
        expect(asked.select).toContain('brands!inner(is_demo');
        expect(asked.filters).toContainEqual(['actions.brands.is_demo', false]);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });
});
