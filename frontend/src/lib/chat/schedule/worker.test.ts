// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fakeSupabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from '../testing/chatFixtures';

/**
 * Chat's scheduled jobs at work (CHAT-12; W3-01), with an in-memory
 * database and a stand-in for the Chat engine: a due job is claimed once
 * (two workers, one run), runs in its own chat as its creator on Auto ·
 * Normal, and moves to its next slot; the checks before each run turn it
 * off for a lost role or brand, a deleted brand or a skill that's off, and
 * pause it at the AI limit; its run follows its Chat run, a failure is
 * retried once 10 minutes on and 3 in a row turn it off; after the reset a
 * paused job goes on at its next slot. No model is called.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const fakes = vi.hoisted(() => ({
  usage: vi.fn(),
  drive: vi.fn(),
  endHeld: vi.fn(),
  key: { source: 'getcito' } as { source: string },
  /** The brands the creator may use now; null: as the database says (all). */
  access: null as string[] | null,
}));
vi.mock('@/lib/mcp/account', () => ({ getAiUsageFor: fakes.usage }));
vi.mock('../key', () => ({
  OwnKeyUnreadableError: class OwnKeyUnreadableError extends Error {},
  resolveChatModelKey: vi.fn(async () => fakes.key),
}));
vi.mock('../engine', () => ({
  driveRun: fakes.drive,
  endHeldRun: fakes.endHeld,
  validTimezone: (value?: string) => value ?? 'UTC',
}));
vi.mock('../precedenceContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('../precedenceContext')>();
  return {
    ...real,
    readPrecedenceContext: vi.fn(async (req: Parameters<typeof real.readPrecedenceContext>[0]) => {
      const ctx = await real.readPrecedenceContext(req);
      return ctx && fakes.access ? { ...ctx, brandAccess: fakes.access } : ctx;
    }),
  };
});

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const worker = await import('./worker');

const JOB = 'abababab-0000-4000-8000-000000000001';
// Monday 2 November 2026, 09:00 in Istanbul (UTC+3).
const SLOT = '2026-11-02T06:00:00.000Z';
const NEXT_SLOT = '2026-11-09T06:00:00.000Z';
const NOW = new Date('2026-11-02T06:00:30.000Z');
const minutes = (n: number, from = NOW) => new Date(from.getTime() + n * 60_000);

const jobRow = () => db.tables.chat_schedules.find((j) => j.id === JOB)!;
const runsOf = () => db.tables.chat_schedule_runs.filter((r) => r.schedule_id === JOB);
const chatRun = (id: unknown) => db.tables.chat_runs.find((r) => r.id === id)!;

function seedJob(over: Record<string, unknown> = {}) {
  db.tables.chat_schedules.push({
    id: JOB,
    organization_id: ORG,
    kind: 'recurring',
    run_mode: 'run_at',
    due_at: null,
    next_run_at: SLOT,
    rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    timezone: 'Europe/Istanbul',
    title: 'Weekly visibility report',
    prompt: 'Summarise last week for the team',
    skill_name: 'report',
    brand_id: BRAND,
    created_by: PEOPLE.manager,
    conversation_id: null,
    mode: 'auto',
    model: 'auto',
    effort: 'normal',
    enabled: true,
    paused_reason: null,
    fail_count: 0,
    retry_at: null,
    last_run_at: null,
    ...over,
  });
}

/** How busy the workspace's runs are, as chat_run_limits counts them. */
let busy: { workspace: number; user: number };
let opened: { scheduleRunId: string; chatRunId: string; actor: { userId: string } }[];
const driver = vi.fn(async (run: (typeof opened)[number]) => {
  opened.push(run);
});

/** Its Chat run ended (or waits) as `status`, with what its progress says. */
function chatEnds(runRowId: unknown, status: string, progress: Record<string, unknown> = {}) {
  const row = db.tables.chat_schedule_runs.find((r) => r.id === runRowId)!;
  chatRun(row.run_id).status = status;
  const state = db.tables.chat_run_state.find((s) => s.run_id === row.run_id)!;
  state.progress = { ...(state.progress as object), ...progress };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorkspace(db);
  fakes.key = { source: 'getcito' };
  fakes.access = null;
  fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 5 });
  fakes.drive.mockResolvedValue(undefined);
  fakes.endHeld.mockImplementation(async (chatRunId: string, from: string, reason: string) => {
    const run = chatRun(chatRunId);
    if (!run || run.status !== from) return false;
    run.status = 'stopped';
    const state = db.tables.chat_run_state.find((s) => s.run_id === chatRunId)!;
    state.progress = { ...(state.progress as object), stoppedFor: reason };
    return true;
  });
  busy = { workspace: 0, user: 0 };
  opened = [];
  db.unique = { ...db.unique, chat_schedule_runs: [['schedule_id', 'slot_at', 'attempt']] };
  db.tables.brands = [{ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false }];
  db.tables.chat_schedules = [];
  db.tables.chat_schedule_runs = [];
  db.tables.chat_conversations = [];
  db.tables.chat_messages = [];
  db.tables.chat_runs = [];
  db.tables.chat_run_state = [];
  db.tables.chat_notices = [];
  db.tables.chat_files = [];
  db.unique = { ...db.unique, chat_notices: [['user_id', 'dedupe_key']] };
  db.rpcs = {
    chat_run_limits: () => ({
      workspaceRunning: busy.workspace,
      userRunning: busy.user,
      messagesHour: 0,
      messagesDay: 0,
    }),
    // A free slot moves the queued run to running, as 00406's function does.
    chat_claim_run_slot: (args) => {
      const run = chatRun(args.p_run_id);
      if (!run || run.status !== 'queued') return false;
      if (busy.workspace >= (args.p_workspace_limit as number)) return false;
      run.status = 'running';
      return true;
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('running a due job', () => {
  it('runs it in its own chat as its creator, on Auto · Normal, and moves on to its next slot', async () => {
    seedJob();
    const counts = await worker.fireDueJobs(NOW, driver);
    expect(counts).toEqual({ due: 1, started: 1, skipped: 0, paused: 0, busy: 0, failed: 0 });

    expect(jobRow()).toMatchObject({
      next_run_at: NEXT_SLOT,
      last_run_at: NOW.toISOString(),
      enabled: true,
    });
    const [run] = runsOf();
    expect(run).toMatchObject({ slot_at: SLOT, attempt: 1, status: 'running' });
    expect(db.tables.chat_conversations).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        user_id: PEOPLE.manager,
        brand_id: BRAND,
        origin: 'schedule',
        schedule_id: JOB,
        title: 'Weekly visibility report',
      }),
    ]);
    expect(jobRow().conversation_id).toBe(db.tables.chat_conversations[0].id);
    const [question, answer] = db.tables.chat_messages;
    // The person's own words, the skill first: the chat shows what the job asks.
    expect(question).toMatchObject({
      role: 'user',
      content_md: '/report Summarise last week for the team',
    });
    expect(answer).toMatchObject({ role: 'assistant', timezone: 'Europe/Istanbul' });
    expect(run).toMatchObject({ run_id: db.tables.chat_runs[0].id, message_id: answer.id });
    // Always Auto · Normal; a free slot: running.
    expect(db.tables.chat_runs[0]).toMatchObject({
      status: 'running',
      model: 'auto',
      effort: 'normal',
      message_id: answer.id,
    });
    const state = db.tables.chat_run_state[0];
    expect(state).toMatchObject({ user_id: PEOPLE.manager, organization_id: ORG, mode: 'auto' });
    const progress = state.progress as { question: string; brandId: string; timezone: string };
    expect(progress.question).toMatch(/^\/report Summarise last week for the team\n\n/);
    expect(progress.question).toContain('nobody watching');
    // The job's own run: nobody watches it, and it is metered as the job's (engine.ts).
    expect(progress).toMatchObject({
      brandId: BRAND,
      timezone: 'Europe/Istanbul',
      scheduled: true,
    });
    expect(opened).toEqual([
      {
        scheduleRunId: run.id,
        chatRunId: db.tables.chat_runs[0].id,
        actor: { userId: PEOPLE.manager, email: null, organizationId: ORG },
      },
    ]);

    // Not due again this minute.
    expect((await worker.fireDueJobs(NOW, driver)).due).toBe(0);

    // A week on, after the first ended: the same chat, a second run.
    chatEnds(run.id, 'done');
    await worker.settleOpenRuns(minutes(5));
    await worker.fireDueJobs(new Date('2026-11-09T06:00:10.000Z'), driver);
    expect(runsOf().map((r) => r.slot_at)).toEqual([SLOT, NEXT_SLOT]);
    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(db.tables.chat_messages).toHaveLength(4);
  });

  it('runs a slot once with two workers at once, and the slot’s row is the backstop', async () => {
    seedJob();
    const [a, b] = await Promise.all([
      worker.fireDueJobs(NOW, driver),
      worker.fireDueJobs(NOW, driver),
    ]);
    expect(a.started + b.started).toBe(1);
    expect(runsOf()).toHaveLength(1);
    expect(db.tables.chat_runs).toHaveLength(1);
    expect(opened).toHaveLength(1);

    // A worker that read the job before the claim moved it: the slot's row stops it.
    jobRow().next_run_at = SLOT;
    expect((await worker.fireDueJobs(NOW, driver)).started).toBe(0);
    expect(runsOf()).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });

  it('waits for the next minute while the workspace or the creator has no free run slot', async () => {
    seedJob();
    busy = { workspace: 10, user: 0 };
    expect(await worker.fireDueJobs(NOW, driver)).toMatchObject({ busy: 1, due: 0, started: 0 });
    expect(jobRow().next_run_at).toBe(SLOT);
    busy = { workspace: 0, user: 5 };
    expect((await worker.fireDueJobs(minutes(1), driver)).busy).toBe(1);
    expect(runsOf()).toEqual([]);

    busy = { workspace: 0, user: 0 };
    expect((await worker.fireDueJobs(minutes(2), driver)).started).toBe(1);
    expect(runsOf()).toHaveLength(1);
  });

  it('passes over a recurring slot more than an hour late, and runs a one-time job however late', async () => {
    seedJob();
    const late = new Date('2026-11-02T07:30:00.000Z');
    expect(await worker.fireDueJobs(late, driver)).toMatchObject({ due: 1, skipped: 1 });
    expect(runsOf()).toEqual([
      expect.objectContaining({
        slot_at: SLOT,
        status: 'skipped',
        reason: "It couldn't start within an hour of its time.",
      }),
    ]);
    // No catch-up: the next slot after now.
    expect(jobRow().next_run_at).toBe(NEXT_SLOT);
    expect(opened).toEqual([]);

    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    seedJob({ kind: 'once', rrule: null, due_at: SLOT, skill_name: null });
    expect((await worker.fireDueJobs(late, driver)).started).toBe(1);
    // A one-time job has nothing after it.
    expect(jobRow().next_run_at).toBeNull();
    expect(db.tables.chat_messages[0].content_md).toBe('Summarise last week for the team');
  });

  it('turns off a job whose rule it can’t read, rather than guess', async () => {
    seedJob({ rrule: 'FREQ=HOURLY' });
    expect(await worker.fireDueJobs(NOW, driver)).toMatchObject({ due: 1, paused: 1 });
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'failed' });
    expect(runsOf()).toEqual([]);
  });
});

describe('the checks before each run', () => {
  it('turns the job off when its creator is no longer an Admin or a Manager, or left', async () => {
    seedJob();
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'analyst';
    expect(await worker.fireDueJobs(NOW, driver)).toMatchObject({ due: 1, paused: 1 });
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'owner_role' });
    expect(runsOf()[0]).toMatchObject({
      status: 'skipped',
      reason: "Its creator can't run scheduled jobs any more.",
      ended_at: NOW.toISOString(),
    });
    expect(db.tables.chat_conversations).toEqual([]);
    expect(opened).toEqual([]);

    // Moved to another workspace: the same.
    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    seedJob();
    const manager = db.tables.profiles.find((p) => p.id === PEOPLE.manager)!;
    manager.role = 'manager';
    manager.organization_id = OTHER_ORG;
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'owner_role' });
  });

  it('turns it off when its creator can no longer use its brand', async () => {
    seedJob();
    fakes.access = ['33333333-3333-4333-8333-333333333333'];
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'owner_role' });
    expect(runsOf()[0].reason).toBe("Its creator can't use its brand any more.");
    expect(opened).toEqual([]);

    // With it among their brands, it runs.
    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    seedJob();
    fakes.access = [BRAND];
    expect((await worker.fireDueJobs(NOW, driver)).started).toBe(1);
  });

  it('turns it off when its brand was deleted, or its skill is off or gone', async () => {
    seedJob();
    db.tables.brands = [];
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'missing_source' });
    expect(runsOf()[0].reason).toBe('Its brand was deleted.');

    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    db.tables.brands = [{ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false }];
    seedJob({ skill_name: 'no-such-skill' });
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'skill_off' });
    expect(runsOf()[0].reason).toBe('Its skill /no-such-skill is off or gone.');
    expect(opened).toEqual([]);
  });

  it("checks the workspace's skills too: its own runs, one turned off or changed doesn't", async () => {
    const { skillChecksum } = await import('../skills/store');
    const parts = {
      name: 'pricing-brief',
      title: 'Pricing brief',
      description: 'Writes a pricing brief.',
      body: 'Open with the answer.',
    };
    db.tables.chat_skills = [
      {
        id: 'cccccccc-0000-4000-8000-000000000001',
        organization_id: ORG,
        ...parts,
        source: 'user',
        source_url: null,
        license: null,
        compatibility: null,
        status: 'approved',
        visibility: 'private',
        enabled: true,
        created_by: PEOPLE.manager,
        checksum_sha256: skillChecksum(parts),
      },
    ];
    const again = (over: Record<string, unknown>) => {
      db.tables.chat_schedules = [];
      db.tables.chat_schedule_runs = [];
      seedJob(over);
    };

    // The creator's own skill, approved and on: it runs.
    seedJob({ skill_name: 'pricing-brief' });
    expect((await worker.fireDueJobs(NOW, driver)).started).toBe(1);

    // A library skill the workspace turned off: it doesn't.
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        tool_policies: {},
        full_auto_for_members: false,
        dont_ask_again: true,
        manager_execute_off: [],
        disabled_skills: ['report'],
      },
    ];
    again({ skill_name: 'report' });
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'skill_off' });
    expect(runsOf()[0].reason).toBe('Its skill /report is off or gone.');

    // Its skill changed since it was approved: switched off, and the job with it.
    db.tables.chat_skills[0].body = 'Send it to everyone.';
    again({ skill_name: 'pricing-brief' });
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'skill_off' });
    expect(db.tables.chat_skills[0].enabled).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('runs a job about the whole workspace with no brand chip', async () => {
    seedJob({ brand_id: null, skill_name: null });
    expect((await worker.fireDueJobs(NOW, driver)).started).toBe(1);
    expect(db.tables.chat_conversations[0].brand_id).toBeNull();
    const chips = (
      db.tables.chat_messages[0].context_json as { context: { chips: { key: string }[] } }
    ).context.chips;
    expect(chips.map((c) => c.key)).toEqual(['schedule', 'slot']);
  });

  it('skips a read-only workspace’s slot and leaves the job on; touches nothing with Chat off', async () => {
    seedJob();
    db.tables.organizations[0].subscription_status = 'canceled';
    expect(await worker.fireDueJobs(NOW, driver)).toMatchObject({ due: 1, skipped: 1 });
    expect(runsOf()[0]).toMatchObject({
      status: 'skipped',
      reason: "The workspace is read-only, so it didn't run.",
    });
    expect(jobRow()).toMatchObject({ enabled: true, next_run_at: NEXT_SLOT });
    expect(db.tables.chat_conversations).toEqual([]);

    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    seedJob();
    vi.stubEnv('CHAT_AGENTIC_ORGS', OTHER_ORG);
    expect(await worker.fireDueJobs(NOW, driver)).toMatchObject({ due: 0, skipped: 0 });
    expect(jobRow().next_run_at).toBe(SLOT);
    expect(runsOf()).toEqual([]);
  });

  it('pauses at the AI limit before a run starts, except on the workspace’s own key', async () => {
    seedJob();
    fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 100 });
    expect(await worker.fireDueJobs(NOW, driver)).toMatchObject({ due: 1, paused: 1 });
    expect(runsOf()[0]).toMatchObject({
      status: 'paused_cap',
      reason: 'The monthly AI limit was reached.',
      ended_at: NOW.toISOString(),
    });
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'cap' });
    expect(db.tables.chat_conversations).toEqual([]);

    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    seedJob();
    fakes.key = { source: 'own' };
    expect((await worker.fireDueJobs(NOW, driver)).started).toBe(1);
  });

  it('skips a slot while the job’s last run still waits on a card', async () => {
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'waiting');
    await worker.settleOpenRuns(minutes(1));
    expect(runsOf()[0].status).toBe('needs_you');

    await worker.fireDueJobs(new Date('2026-11-09T06:00:10.000Z'), driver);
    expect(runsOf()[1]).toMatchObject({
      slot_at: NEXT_SLOT,
      status: 'skipped',
      reason: "Its last run hadn't finished.",
    });
    // Skipped, not off: the job goes on at its next slot.
    expect(jobRow()).toMatchObject({ enabled: true, next_run_at: '2026-11-16T06:00:00.000Z' });
    expect(opened).toHaveLength(1);
  });
});

describe('keeping runs in step', () => {
  it('follows its Chat run: Needs you, then done; a success clears the failures in a row', async () => {
    seedJob({ fail_count: 2 });
    await worker.fireDueJobs(NOW, driver);
    const id = runsOf()[0].id;
    chatEnds(id, 'waiting');
    expect(await worker.settleOpenRuns(minutes(1))).toBe(1);
    expect(runsOf()[0]).toMatchObject({ status: 'needs_you' });
    expect(runsOf()[0].ended_at).toBeUndefined();

    chatEnds(id, 'done');
    expect(await worker.settleScheduleRun(id as string, { now: minutes(2) })).toBe('done');
    expect(runsOf()[0]).toMatchObject({ status: 'done', ended_at: minutes(2).toISOString() });
    expect(jobRow().fail_count).toBe(0);
    // Twice is once.
    expect(await worker.settleOpenRuns(minutes(3))).toBe(0);
  });

  it('tries a failed run once more 10 minutes on, for the same slot', async () => {
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'error');
    await worker.settleOpenRuns(minutes(1));
    expect(runsOf()[0]).toMatchObject({ status: 'failed', reason: 'Something went wrong.' });
    expect(jobRow()).toMatchObject({
      enabled: true,
      fail_count: 1,
      retry_at: minutes(11).toISOString(),
    });

    // Not before its time.
    expect((await worker.fireDueJobs(minutes(5), driver)).due).toBe(0);
    expect((await worker.fireDueJobs(minutes(11), driver)).started).toBe(1);
    expect(runsOf()[1]).toMatchObject({ slot_at: SLOT, attempt: 2, status: 'running' });
    expect(jobRow()).toMatchObject({ retry_at: null, next_run_at: NEXT_SLOT });

    // The retry fails too: Failed, no third try; the job stays on for its next slot.
    chatEnds(runsOf()[1].id, 'error');
    await worker.settleOpenRuns(minutes(12));
    expect(jobRow()).toMatchObject({ enabled: true, fail_count: 2, retry_at: null });
    expect((await worker.fireDueJobs(minutes(30), driver)).due).toBe(0);
  });

  it('turns the job off after 3 failed runs in a row', async () => {
    seedJob({ fail_count: 2 });
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'error');
    await worker.settleOpenRuns(minutes(1));
    expect(jobRow()).toMatchObject({
      enabled: false,
      paused_reason: 'failed',
      fail_count: 3,
      retry_at: null,
    });
    expect((await worker.fireDueJobs(minutes(11), driver)).due).toBe(0);
  });

  it('fails a run whose Chat run was never made, after 5 minutes', async () => {
    seedJob();
    db.tables.chat_schedule_runs.push({
      id: 'r-lost',
      schedule_id: JOB,
      slot_at: SLOT,
      attempt: 1,
      run_id: null,
      status: 'running',
      started_at: NOW.toISOString(),
    });
    expect(await worker.settleScheduleRun('r-lost', { now: minutes(4) })).toBe('running');
    expect(await worker.settleScheduleRun('r-lost', { now: minutes(6) })).toBe('failed');
    expect(runsOf()[0].reason).toBe('It stopped before it could start.');
    expect(jobRow().fail_count).toBe(1);
  });

  it('keeps a card left 7 days, or a person’s Stop, as Skipped, not a failure', async () => {
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'stopped', { stoppedFor: 'expired' });
    await worker.settleOpenRuns(minutes(1));
    expect(runsOf()[0]).toMatchObject({ status: 'skipped', reason: 'No answer in 7 days.' });
    expect(jobRow().fail_count).toBe(0);
    expect(worker.scheduleRunStateOf({ status: 'stopped', progress: {} as never })).toEqual({
      status: 'skipped',
      reason: 'stopped',
    });
  });
});

describe('the AI limit', () => {
  it('pauses the job at the monthly limit, and goes on after the reset at its next slot', async () => {
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    const run = runsOf()[0];
    chatEnds(run.id, 'paused_cap', { capHit: 'month' });
    await worker.settleOpenRuns(minutes(1));
    // Held at the limit: its row stays open; the job is off (cap).
    expect(runsOf()[0]).toMatchObject({ status: 'paused_cap' });
    expect(runsOf()[0].ended_at).toBeUndefined();
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'cap' });
    expect(await worker.settleOpenRuns(minutes(2))).toBe(0);

    // Still used up: it waits.
    fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 100 });
    expect(await worker.resumeCapPausedJobs(minutes(60))).toBe(0);

    // After the reset, two slots later: the next one after now, the missed one never run.
    fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 0 });
    const later = new Date('2026-11-10T08:00:00.000Z');
    expect(await worker.resumeCapPausedJobs(later)).toBe(1);
    expect(jobRow()).toMatchObject({
      enabled: true,
      paused_reason: null,
      next_run_at: '2026-11-16T06:00:00.000Z',
    });
    // Its held run stops at the limit, kept as it was.
    expect(fakes.endHeld).toHaveBeenCalledWith(run.run_id, 'paused_cap', 'limit');
    expect(chatRun(run.run_id).status).toBe('stopped');
    expect(runsOf()[0]).toMatchObject({ status: 'paused_cap', ended_at: later.toISOString() });
    expect((await worker.fireDueJobs(later, driver)).due).toBe(0);
  });

  it('starts a one-time job ready by a date to come again, and leaves one whose time passed', async () => {
    seedJob({
      kind: 'once',
      run_mode: 'ready_by',
      rrule: null,
      due_at: '2026-11-04T06:00:00.000Z',
      next_run_at: null,
      enabled: false,
      paused_reason: 'cap',
    });
    expect(await worker.resumeCapPausedJobs(minutes(60))).toBe(1);
    expect(jobRow()).toMatchObject({ enabled: true, next_run_at: minutes(60).toISOString() });

    db.tables.chat_schedules = [];
    seedJob({
      kind: 'once',
      rrule: null,
      due_at: SLOT,
      next_run_at: null,
      enabled: false,
      paused_reason: 'cap',
    });
    expect(await worker.resumeCapPausedJobs(minutes(60))).toBe(1);
    expect(jobRow()).toMatchObject({ enabled: true, next_run_at: null });
  });

  it('leaves a read-only workspace’s paused jobs paused', async () => {
    seedJob({ enabled: false, paused_reason: 'cap' });
    db.tables.organizations[0].subscription_status = 'canceled';
    expect(await worker.resumeCapPausedJobs(minutes(60))).toBe(0);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'cap' });
  });
});

describe('the driver', () => {
  it('drives the run with no session behind it, then keeps its row in step', async () => {
    seedJob();
    const tasks: (() => Promise<void>)[] = [];
    const drive = vi.fn(async (_actor: unknown, chatRunId: string) => {
      chatRun(chatRunId).status = 'done';
    });
    const real = worker.createScheduleRunDriver({
      background: (task) => tasks.push(task),
      drive,
      now: () => minutes(3),
    });
    await worker.fireDueJobs(NOW, real);
    expect(tasks).toHaveLength(1);
    expect(runsOf()[0].status).toBe('running');
    await tasks[0]();
    expect(drive).toHaveBeenCalledWith(
      { userId: PEOPLE.manager, email: null, organizationId: ORG },
      runsOf()[0].run_id,
    );
    expect(runsOf()[0]).toMatchObject({ status: 'done', ended_at: minutes(3).toISOString() });
  });

  it('drives with the engine, its session null: every change asks first', async () => {
    seedJob();
    const tasks: (() => Promise<void>)[] = [];
    await worker.fireDueJobs(
      NOW,
      worker.createScheduleRunDriver({ background: (t) => tasks.push(t) }),
    );
    await tasks[0]();
    expect(fakes.drive).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PEOPLE.manager }),
      runsOf()[0].run_id,
      undefined,
      { sessionUserId: null },
    );
  });
});

describe('delivering a run (W3-04a)', () => {
  const notices = () => db.tables.chat_notices;
  const FINGERPRINT = 'a'.repeat(64);

  it('asks a change-only run to stop on no change, keeps "No change" and the last delivered fingerprint', async () => {
    seedJob({ change_only: true, last_fingerprint: FINGERPRINT });
    await worker.fireDueJobs(NOW, driver);
    const state = db.tables.chat_run_state.find((s) => s.run_id === runsOf()[0].run_id)!;
    expect(state.progress).toMatchObject({ scheduled: true, changeOnly: { last: FINGERPRINT } });

    chatEnds(runsOf()[0].id, 'done', { unchanged: true, fingerprint: FINGERPRINT });
    await worker.settleOpenRuns(minutes(1));
    expect(runsOf()[0]).toMatchObject({ status: 'unchanged', fingerprint: FINGERPRINT });
    expect(jobRow()).toMatchObject({ fail_count: 0, last_fingerprint: FINGERPRINT });

    // The next run read something new: delivered, and its fingerprint is the job's last.
    const NEW = 'b'.repeat(64);
    await worker.fireDueJobs(new Date(Date.parse(NEXT_SLOT) + 30_000), driver);
    chatEnds(runsOf()[1].id, 'done', { fingerprint: NEW });
    await worker.settleOpenRuns(new Date(Date.parse(NEXT_SLOT) + 60_000));
    expect(runsOf()[1]).toMatchObject({ status: 'done', fingerprint: NEW });
    expect(jobRow().last_fingerprint).toBe(NEW);
    expect(worker.scheduleRunStateOf({ status: 'done', progress: {} as never })).toEqual({
      status: 'done',
    });
  });

  it('counts its parts: the files it made, or its task strip’s tasks ready', async () => {
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    const chatRunId = runsOf()[0].run_id;
    db.tables.chat_files.push({ id: 'f1', run_id: chatRunId }, { id: 'f2', run_id: chatRunId });
    await worker.settleOpenRuns(minutes(1));
    // Still working: "2 of 2 ready" so far.
    expect(runsOf()[0]).toMatchObject({ status: 'running', parts_done: 2, parts_total: 2 });
  });

  it('tells the creator a run failed only after its retry, in plain words', async () => {
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'error');
    await worker.settleOpenRuns(minutes(1));
    expect(notices()).toEqual([]);

    await worker.fireDueJobs(minutes(11), driver);
    chatEnds(runsOf()[1].id, 'error');
    await worker.settleOpenRuns(minutes(12));
    expect(notices()).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        user_id: PEOPLE.manager,
        kind: 'schedule_failed',
        payload: expect.objectContaining({
          scheduleId: JOB,
          title: 'Weekly visibility report',
          reason: 'Something went wrong.',
        }),
      }),
    ]);

    // The next run goes through: its notice closes.
    await worker.fireDueJobs(new Date(Date.parse(NEXT_SLOT) + 30_000), driver);
    chatEnds(runsOf()[2].id, 'done');
    await worker.settleOpenRuns(new Date(Date.parse(NEXT_SLOT) + 60_000));
    expect(notices()[0].resolved_at).toBeTruthy();
  });

  it('tells the creator, once, when the job turns itself off, and closes it when it goes on', async () => {
    seedJob({ fail_count: 2 });
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'error');
    await worker.settleOpenRuns(minutes(1));
    expect(notices()).toEqual([
      expect.objectContaining({
        kind: 'schedule_paused',
        payload: expect.objectContaining({
          reason: 'It failed 3 times in a row, so it was turned off.',
        }),
      }),
    ]);

    // At the AI limit: told why, and on again after the reset with the notice closed.
    db.tables.chat_schedules = [];
    db.tables.chat_schedule_runs = [];
    db.tables.chat_notices = [];
    seedJob();
    await worker.fireDueJobs(NOW, driver);
    chatEnds(runsOf()[0].id, 'paused_cap', { capHit: 'month' });
    await worker.settleOpenRuns(minutes(1));
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({ kind: 'schedule_paused' });
    expect(notices()[0].resolved_at ?? null).toBeNull();
    fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 0 });
    await worker.resumeCapPausedJobs(new Date('2026-11-10T08:00:00.000Z'));
    expect(notices()[0].resolved_at).toBe('2026-11-10T08:00:00.000Z');
  });

  it('tells the creator when it turns off before a run: its brand gone', async () => {
    seedJob();
    db.tables.brands = [];
    await worker.fireDueJobs(NOW, driver);
    expect(jobRow()).toMatchObject({ enabled: false, paused_reason: 'missing_source' });
    expect(notices().map((n) => [n.kind, (n.payload as { reason: string }).reason])).toEqual([
      ['schedule_paused', 'Its brand or what it worked on is gone.'],
    ]);
  });
});
