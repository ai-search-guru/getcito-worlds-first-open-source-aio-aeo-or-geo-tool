import { after } from 'next/server';
import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { getAiUsageFor } from '@/lib/mcp/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { UserRole } from '@/types';
import type { Json } from '@/types/supabase';
import { driveRun, endHeldRun, validTimezone, type ChatActor } from '../engine';
import { loadRun, type LoadedRun } from '../engineStore';
import { chatAgenticEnabled } from '../flag';
import { openHeadlessRun } from '../headlessRun';
import { OwnKeyUnreadableError, resolveChatModelKey } from '../key';
import { planFactsFromOrgRow, type OrgPlanRow, type PlanFacts } from '../planFacts';
import type { ChatMode } from '../precedence';
import { readPrecedenceContext } from '../precedenceContext';
import { RUNS_PER_USER, claimRunSlot, readRunCounts, workspaceRunLimit } from '../runLimits';
import { enabledSkillsFor, loadSkillBodies } from '../skills/store';
import { closeJobNotices, keepRunResult, noticeJobPaused, type PausedReason } from './deliver';
import { nextJobRun } from './rule';

/**
 * Chat's scheduled jobs at work (CHAT-12 items 11–17, 26–27; W3-01), on
 * the server's minute cron after the agents' tick (/api/internal/chat/
 * schedules/tick). Each minute:
 *
 *   - Runs that are still open follow their Chat run (settleOpenRuns):
 *     Needs you, Paused · AI limit reached, done or failed.
 *   - Jobs paused at the AI limit (cap) go on once the workspace's limit
 *     has room again, from their next slot: missed slots aren't replayed
 *     (resumeCapPausedJobs).
 *   - Jobs that are due run (fireDueJobs). A job is claimed by moving its
 *     next run (or its retry) from what was read to the next slot, so two
 *     workers at once run a slot once; chat_schedule_runs' unique slot and
 *     attempt is the database's backstop. A recurring slot more than an
 *     hour late is passed over (Skipped), a one-time job runs late. A
 *     workspace with every run slot busy, or the creator with every one of
 *     theirs, waits for the next minute.
 *
 * Before each run, read again for the job's creator, whom it acts as:
 * still an Admin or a Manager of the workspace, and still able to use the
 * job's brand (else it turns off, owner_role); its brand still there
 * (missing_source) and its skill still one they may use, the library's or
 * the workspace's (skill_off); the AI limit not used up (the run is Paused · AI limit reached and the job pauses, cap).
 * A read-only workspace runs nothing (Skipped); with Chat off nothing is
 * read or written. A run whose job's last run is still open is Skipped.
 *
 * The run is a Chat run in the job's own chat (one live chat per job,
 * made on its first run), as its creator, headless (headlessRun.ts): its
 * prompt or /skill as the message, the job's mode, always Auto · Normal
 * (Wave 3 decision); it takes a slot of the workspace's runs at once
 * (claimRunSlot), else waits Queued as any chat's run does. Nobody watches
 * it: a question takes its Recommended option and the answer lists what
 * was assumed (schedule/unattended.ts); no session is behind it, so every
 * change waits as a card in the chat (engine.ts askWithoutSession; the
 * session-free writers' own rule comes with their PRs).
 *
 * A failed run is tried once more 10 minutes later; 3 failed runs in a
 * row turn the job off (failed). Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.run' });

/** The one retry after a failed run (CHAT-12 item 26). */
export const RETRY_AFTER_MS = 10 * 60_000;
/** Failed runs in a row that turn a job off (CHAT-12 item 26). */
export const FAILURES_TO_TURN_OFF = 3;
/** A recurring slot later than this is passed over: no catch-up (CHAT-12 item 17). */
export const LATE_GRACE_MS = 60 * 60_000;
/** A run with no Chat run after this long lost its driver: it failed. */
export const HANDOVER_GRACE_MS = 5 * 60_000;
/** Most jobs, runs or paused jobs each part reads a minute. */
const TICK_ROWS = 200;

const JOB_COLUMNS =
  'id, organization_id, kind, run_mode, due_at, next_run_at, rrule, timezone, title, prompt, skill_name, brand_id, created_by, conversation_id, mode, enabled, paused_reason, fail_count, retry_at, change_only, last_fingerprint';
const RUN_COLUMNS = 'id, schedule_id, slot_at, attempt, run_id, status, started_at';

/** Run statuses still open: working, waiting on a person, or held at the AI limit. */
const OPEN_RUN = ['running', 'needs_you', 'paused_cap'] as const;

export type JobPauseReason = 'cap' | 'failed' | 'skill_off' | 'missing_source' | 'owner_role';

export interface JobRow {
  id: string;
  organization_id: string;
  kind: string;
  run_mode: string;
  due_at: string | null;
  next_run_at: string | null;
  rrule: string | null;
  timezone: string;
  title: string;
  prompt: string | null;
  skill_name: string | null;
  brand_id: string | null;
  created_by: string | null;
  conversation_id: string | null;
  mode: string;
  enabled: boolean;
  paused_reason: string | null;
  fail_count: number;
  retry_at: string | null;
  /** "Notify only if the answer changed" (CHAT-12 item 20), and what its last delivered run read. */
  change_only?: boolean;
  last_fingerprint?: string | null;
}

interface RunRow {
  id: string;
  schedule_id: string;
  slot_at: string;
  attempt: number;
  run_id: string | null;
  status: string;
  started_at: string;
}

/** The words a run row keeps for why it didn't run or failed (never a raw error). */
type Reason =
  | 'readOnly'
  | 'ownerRole'
  | 'brandAccess'
  | 'brandGone'
  | 'skillOff'
  | 'aiLimit'
  | 'missed'
  | 'stillOpen'
  | 'failed'
  | 'lost'
  | 'stopped'
  | 'noAnswer';

const reasonWords = (reason: Reason, skill?: string | null) =>
  t(`reason.${reason}`, { skill: skill ?? '' }).slice(0, 200);

// ─── What a tick did ─────────────────────────────────────────────────────────

/** A round of due jobs, for the cron's log; `failed`: jobs that failed, the rest went on. */
export interface DueCounts {
  due: number;
  started: number;
  skipped: number;
  paused: number;
  /** Left due: the workspace (or the creator) had no free run slot. */
  busy: number;
  failed: number;
}

const noDue = (): DueCounts => ({
  due: 0,
  started: 0,
  skipped: 0,
  paused: 0,
  busy: 0,
  failed: 0,
});

// ─── The driver ──────────────────────────────────────────────────────────────

/** A job's run handed to Chat: who it acts as and its Chat run. */
export interface OpenedScheduleRun {
  scheduleRunId: string;
  chatRunId: string;
  actor: ChatActor;
}

/** Drives a job's opened run in the background, and keeps its row in step after. */
export type ScheduleRunDriver = (run: OpenedScheduleRun) => Promise<void>;

export interface ScheduleRunDriverDeps {
  /** Runs the drive past the request's answer (next/server's after()). */
  background: (task: () => Promise<void>) => void;
  /** The Chat engine's driver: no session is behind a job's run. */
  drive: (actor: ChatActor, chatRunId: string) => Promise<void>;
  now: () => Date;
}

/** after() in a request; outside one (a script, a test), on its own. */
function inBackground(task: () => Promise<void>) {
  const guarded = () =>
    task().catch((err) => console.error('[chat/schedules] a background run failed:', err));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/** The driver: drives the run with no session (every change a card), then settles its row. */
export function createScheduleRunDriver(
  deps: Partial<ScheduleRunDriverDeps> = {},
): ScheduleRunDriver {
  const {
    background = inBackground,
    drive = (actor, chatRunId) => driveRun(actor, chatRunId, undefined, { sessionUserId: null }),
    now = () => new Date(),
  } = deps;
  return async (run) => {
    background(async () => {
      try {
        await drive(run.actor, run.chatRunId);
      } finally {
        await settleScheduleRun(run.scheduleRunId, { now: now() });
      }
    });
  };
}

/** The driver the tick starts jobs' runs with. */
export const scheduleRunDriver: ScheduleRunDriver = createScheduleRunDriver();

// ─── Workspaces ──────────────────────────────────────────────────────────────

/** The plans of the workspaces where Chat is on, by id: read-only ones too. */
async function readJobOrgs(orgIds: readonly string[]): Promise<Map<string, PlanFacts>> {
  const plans = new Map<string, PlanFacts>();
  const wanted = [...new Set(orgIds)].filter((id) => chatAgenticEnabled(id));
  if (wanted.length === 0) return plans;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(`id, ${ORG_PLAN_COLUMNS}`)
    .in('id', wanted);
  if (error) throw new Error(`Could not read the workspaces' plans: ${error.message}`);
  for (const row of (data ?? []) as unknown as ({ id: string } & NonNullable<OrgPlanRow>)[]) {
    plans.set(row.id, planFactsFromOrgRow(row));
  }
  return plans;
}

/**
 * Whether the workspace's monthly AI limit is used up, as agents.ts reads
 * it before an agent's run: never on the workspace's own key. A limit that
 * can't be read lets the run start: each step is held on the budget anyway.
 */
async function aiLimitReached(actor: ChatActor, role: UserRole): Promise<boolean> {
  try {
    const key = await resolveChatModelKey(actor.organizationId).catch((err: unknown) => {
      if (err instanceof OwnKeyUnreadableError) return { source: 'own' as const };
      throw err;
    });
    if (key?.source === 'own') return false;
    const usage = await getAiUsageFor({
      userId: actor.userId,
      email: actor.email,
      organizationId: actor.organizationId,
      role,
      apiKeyId: 'chat-schedules',
    });
    return !!usage && !usage.unlimited && (usage.percent_used ?? 0) >= 100;
  } catch (err) {
    console.error('[chat/schedules] could not read the AI limit:', err);
    return false;
  }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

/** Turns a job off for a reason, only while it is on; false when it was off already. */
async function pauseJob(jobId: string, reason: JobPauseReason): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .update({ enabled: false, paused_reason: reason, retry_at: null })
    .eq('id', jobId)
    .eq('enabled', true)
    .select('id');
  if (error) throw new Error(`Could not pause a scheduled job: ${error.message}`);
  const paused = (data ?? []).length > 0;
  // Its creator is told at the top of their Inbox (W3-04a).
  if (paused) await noticeJobPaused(jobId, reason as PausedReason);
  return paused;
}

/**
 * Moves a run row from `from` to a status with its words, ending it unless
 * the status is open (running, needs_you) or `held` (at the AI limit until
 * its job goes on). False when another moved it first.
 */
async function moveRunRow(
  runId: string,
  from: string,
  to: 'done' | 'unchanged' | 'failed' | 'paused_cap' | 'skipped' | 'needs_you' | 'running',
  { reason = null, now, held = false }: { reason?: string | null; now: Date; held?: boolean },
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedule_runs')
    .update({
      status: to,
      reason,
      ...(to === 'running' || to === 'needs_you' || held ? {} : { ended_at: now.toISOString() }),
    })
    .eq('id', runId)
    .eq('status', from)
    .is('ended_at', null)
    .select('id');
  if (error) throw new Error(`Could not keep a scheduled run: ${error.message}`);
  return (data ?? []).length > 0;
}

/** A job's run that is due, and how it was found: its next run, or its one retry. */
interface DueRun {
  job: JobRow;
  slot: string;
  attempt: 1 | 2;
  by: 'next' | 'retry';
}

/**
 * The jobs due now: on and due by their next run, or by their retry, whose
 * slot is the failed first attempt's. Oldest first, at most TICK_ROWS each.
 */
async function readDueRuns(now: Date): Promise<DueRun[]> {
  const at = now.toISOString();
  const [byNext, byRetry] = await Promise.all([
    supabaseAdmin
      .from('chat_schedules')
      .select(JOB_COLUMNS)
      .eq('enabled', true)
      .lte('next_run_at', at)
      .order('next_run_at', { ascending: true })
      .limit(TICK_ROWS),
    supabaseAdmin
      .from('chat_schedules')
      .select(JOB_COLUMNS)
      .eq('enabled', true)
      .lte('retry_at', at)
      .order('retry_at', { ascending: true })
      .limit(TICK_ROWS),
  ]);
  for (const result of [byNext, byRetry]) {
    if (result.error) throw new Error(`Could not read the due jobs: ${result.error.message}`);
  }
  const due: DueRun[] = ((byNext.data ?? []) as JobRow[]).map((job) => ({
    job,
    slot: job.next_run_at!,
    attempt: 1,
    by: 'next',
  }));
  for (const job of (byRetry.data ?? []) as JobRow[]) {
    const { data, error } = await supabaseAdmin
      .from('chat_schedule_runs')
      .select('slot_at')
      .eq('schedule_id', job.id)
      .eq('attempt', 1)
      .eq('status', 'failed')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`Could not read a job's runs: ${error.message}`);
    const slot = ((data ?? []) as { slot_at: string }[])[0]?.slot_at;
    // No failed first attempt to retry: the retry is dropped when claimed.
    due.push({ job, slot: slot ?? job.retry_at!, attempt: slot ? 2 : 1, by: 'retry' });
  }
  return due;
}

/**
 * Claims a due run: its next run moves on to the next slot (none for a
 * one-time job), or its retry is cleared, only from what was read. False
 * when another worker claimed it first. A recurring job whose rule doesn't
 * read turns off instead (failed).
 */
async function claimDueRun(due: DueRun, now: Date): Promise<'claimed' | 'lost' | 'unreadable'> {
  const { job } = due;
  const next = due.by === 'next' ? nextJobRun(job, now) : null;
  if (next?.unreadable) return (await pauseJob(job.id, 'failed')) ? 'unreadable' : 'lost';
  const claim = supabaseAdmin
    .from('chat_schedules')
    .update(
      next
        ? { next_run_at: next.at, last_run_at: now.toISOString() }
        : { retry_at: null, last_run_at: now.toISOString() },
    )
    .eq('id', job.id)
    .eq('enabled', true);
  const { data, error } = await (
    next ? claim.eq('next_run_at', job.next_run_at!) : claim.eq('retry_at', job.retry_at!)
  ).select('id');
  if (error) throw new Error(`Could not claim a scheduled job: ${error.message}`);
  return (data ?? []).length > 0 ? 'claimed' : 'lost';
}

/** The run's row for its slot and attempt; null when another worker made it (a slot runs once). */
async function insertRunRow(due: DueRun, now: Date): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedule_runs')
    .insert({
      schedule_id: due.job.id,
      slot_at: due.slot,
      attempt: due.attempt,
      status: 'running',
      started_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (error?.code === '23505') return null;
  if (error || !data) {
    throw new Error(`Could not start a scheduled run: ${error?.message ?? 'no row'}`);
  }
  return (data as { id: string }).id;
}

/** What stops a claimed run before it starts: its row's status, its words, and the job's pause. */
interface Refusal {
  status: 'skipped' | 'paused_cap';
  reason: Reason;
  pause?: JobPauseReason;
}

/** The facts a run starts with, once its checks passed. */
interface RunFacts {
  actor: ChatActor;
  plan: PlanFacts;
  brand: { id: string; name: string } | null;
}

const canRunJobs = (role: UserRole) => role === 'admin' || role === 'manager';

/**
 * The checks before a job's run (above), for its creator now. Answers the
 * facts it runs with, or why it doesn't.
 */
async function checkJob(
  job: JobRow,
  runRowId: string,
): Promise<{ ok: true; facts: RunFacts } | { ok: false; refusal: Refusal }> {
  const refuse = (refusal: Refusal) => ({ ok: false as const, refusal });
  if (!job.created_by)
    return refuse({ status: 'skipped', reason: 'ownerRole', pause: 'owner_role' });
  const ctx = await readPrecedenceContext({
    userId: job.created_by,
    organizationId: job.organization_id,
    mode: job.mode as ChatMode,
    surface: 'chat',
  });
  if (!ctx || !canRunJobs(ctx.role)) {
    return refuse({ status: 'skipped', reason: 'ownerRole', pause: 'owner_role' });
  }
  const actor: ChatActor = {
    userId: job.created_by,
    email: null,
    organizationId: job.organization_id,
  };

  let brand: RunFacts['brand'] = null;
  if (job.brand_id) {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('id, name')
      .eq('id', job.brand_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle();
    if (error) throw new Error(`Could not read a job's brand: ${error.message}`);
    if (!data) return refuse({ status: 'skipped', reason: 'brandGone', pause: 'missing_source' });
    // The creator may no longer use it (brand access): they can't run this job now.
    if (ctx.brandAccess !== 'all' && !ctx.brandAccess.includes(job.brand_id)) {
      return refuse({ status: 'skipped', reason: 'brandAccess', pause: 'owner_role' });
    }
    brand = data as { id: string; name: string };
  }
  if (job.skill_name && !(await skillOn(actor, job.skill_name))) {
    return refuse({ status: 'skipped', reason: 'skillOff', pause: 'skill_off' });
  }
  // One run of a job at a time: its last one still works or waits on a card.
  const { data: open, error: openError } = await supabaseAdmin
    .from('chat_schedule_runs')
    .select('id')
    .eq('schedule_id', job.id)
    .in('status', ['running', 'needs_you'])
    .neq('id', runRowId)
    .limit(1);
  if (openError) throw new Error(`Could not read a job's runs: ${openError.message}`);
  if ((open ?? []).length > 0) return refuse({ status: 'skipped', reason: 'stillOpen' });
  if (await aiLimitReached(actor, ctx.role)) {
    return refuse({ status: 'paused_cap', reason: 'aiLimit', pause: 'cap' });
  }
  return { ok: true, facts: { actor, plan: ctx.plan, brand } };
}

/**
 * Whether the job's /skill is one its creator may use now (skills/store.ts):
 * a library skill the workspace didn't turn off, or a workspace skill that
 * is approved, on, theirs or shared, and still matches its checksum (one
 * that doesn't is switched off, as a run's load does).
 */
async function skillOn(actor: ChatActor, name: string): Promise<boolean> {
  const skill = (await enabledSkillsFor(actor.organizationId, actor.userId)).find(
    (s) => s.name === name,
  );
  if (!skill) return false;
  await loadSkillBodies(actor, [skill], [name]);
  return skill.body !== null;
}

/** The job's live chat, its creator's; null when it has none yet. */
async function jobChat(job: JobRow): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, user_id')
    .eq('schedule_id', job.id)
    .is('deleted_at', null)
    .limit(1);
  if (error) throw new Error(`Could not read a job's chat: ${error.message}`);
  const chat = ((data ?? []) as { id: string; user_id: string }[])[0];
  return chat && chat.user_id === job.created_by ? chat.id : null;
}

/** The run's message: the job's /skill and prompt, as the person would type them. */
export function jobMessage(job: Pick<JobRow, 'prompt' | 'skill_name'>): string {
  const prompt = job.prompt?.trim() ?? '';
  if (!job.skill_name) return prompt;
  return prompt ? `/${job.skill_name} ${prompt}` : `/${job.skill_name}`;
}

/**
 * Opens the run in the job's chat (made on its first run, or again when it
 * was deleted) as its creator: Queued, then a run slot taken when one is
 * free. Null when its chat clashed with another worker's twice over.
 */
async function openJobRun(
  job: JobRow,
  due: DueRun,
  runRowId: string,
  facts: RunFacts,
  now: Date,
): Promise<OpenedScheduleRun | null> {
  const message = jobMessage(job);
  const timezone = validTimezone(job.timezone);
  const chips = [
    { key: 'schedule', label: t('chip.job'), value: job.title },
    ...(facts.brand ? [{ key: 'brand', label: t('chip.brand'), value: facts.brand.name }] : []),
    { key: 'slot', label: t('chip.slot'), value: due.slot },
  ];
  const scope = { context: { route: '/dashboard/chat', chips } };
  let opened = null;
  for (let attempt = 0; attempt < 2 && !opened; attempt++) {
    const chatId = await jobChat(job);
    opened = await openHeadlessRun({
      origin: 'schedule',
      organizationId: job.organization_id,
      userId: facts.actor.userId,
      chat: chatId
        ? { id: chatId }
        : { create: { brandId: facts.brand?.id ?? null, title: job.title, scheduleId: job.id } },
      message: { text: message, context: scope as unknown as Json },
      // Nobody watches it: what the model is told beyond the person's words.
      question: `${message}\n\n${t('background', { title: job.title })}`,
      timezone,
      brandId: facts.brand?.id ?? null,
      mode: job.mode as ChatMode,
      // Always Auto · Normal (Wave 3 decision): a job's cost stays predictable.
      model: 'auto',
      effort: 'normal',
      status: 'queued',
      progress: {
        scope,
        scheduled: true,
        // Change-only: what its last delivered run read, to stop on No change (CHAT-12 item 20).
        ...(job.change_only ? { changeOnly: { last: job.last_fingerprint ?? null } } : {}),
      },
      now,
    });
  }
  if (!opened) return null;
  const updates = [
    supabaseAdmin
      .from('chat_schedule_runs')
      .update({ run_id: opened.chatRunId, message_id: opened.answerId })
      .eq('id', runRowId),
    ...(job.conversation_id !== opened.conversationId
      ? [
          supabaseAdmin
            .from('chat_schedules')
            .update({ conversation_id: opened.conversationId })
            .eq('id', job.id),
        ]
      : []),
  ];
  for (const { error } of await Promise.all(updates)) {
    if (error) throw new Error(`Could not keep a scheduled run: ${error.message}`);
  }
  // A free slot of the workspace's runs at once; else it waits Queued as any chat's run.
  await claimRunSlot(opened.chatRunId, facts.plan);
  return { scheduleRunId: runRowId, chatRunId: opened.chatRunId, actor: facts.actor };
}

/** Whether the workspace, and the creator, have a run slot free now; true when it can't be read. */
async function hasRoom(job: JobRow, plan: PlanFacts): Promise<boolean> {
  if (!job.created_by) return true;
  const counts = await readRunCounts(job.organization_id, job.created_by);
  if (!counts) return true;
  return counts.workspaceRunning < workspaceRunLimit(plan) && counts.userRunning < RUNS_PER_USER;
}

/** One due run: claimed, checked, then started; what it came to is counted. */
async function fireDueRun(
  due: DueRun,
  plan: PlanFacts,
  now: Date,
  driver: ScheduleRunDriver,
  counts: DueCounts,
): Promise<void> {
  const { job } = due;
  const late =
    job.kind === 'recurring' &&
    due.by === 'next' &&
    now.getTime() - Date.parse(due.slot) > LATE_GRACE_MS;
  // Every slot busy: it waits for the next minute, unless it is too late for this slot.
  if (plan.writable && !late && !(await hasRoom(job, plan))) {
    counts.busy += 1;
    return;
  }
  const claimed = await claimDueRun(due, now);
  if (claimed === 'lost') return;
  counts.due += 1;
  if (claimed === 'unreadable') {
    counts.paused += 1;
    return;
  }
  // A retry with no failed run to retry: nothing more.
  if (due.by === 'retry' && due.attempt === 1) return;
  const runRowId = await insertRunRow(due, now);
  if (!runRowId) return;

  const skip = async (refusal: Refusal) => {
    await moveRunRow(runRowId, 'running', refusal.status, {
      reason: reasonWords(refusal.reason, job.skill_name),
      now,
    });
    if (refusal.pause && (await pauseJob(job.id, refusal.pause))) counts.paused += 1;
    else counts.skipped += 1;
  };
  if (late) return skip({ status: 'skipped', reason: 'missed' });
  // Read-only after the trial: nothing runs (the AI budget can't be spent).
  if (!plan.writable) return skip({ status: 'skipped', reason: 'readOnly' });
  const checked = await checkJob(job, runRowId);
  if (!checked.ok) return skip(checked.refusal);

  const opened = await openJobRun(job, due, runRowId, checked.facts, now);
  if (!opened) {
    // Counted as any failed run: tried again 10 minutes on.
    if (await moveRunRow(runRowId, 'running', 'failed', { reason: reasonWords('failed'), now })) {
      await countRun(job.id, due.attempt, true, now);
    }
    counts.failed += 1;
    return;
  }
  counts.started += 1;
  await driver(opened);
}

/**
 * Runs every job that is due (above): in workspaces where Chat is on, one
 * job's failure apart from the others'. Answers what the round did.
 */
export async function fireDueJobs(now: Date, driver: ScheduleRunDriver): Promise<DueCounts> {
  const counts = noDue();
  const due = await readDueRuns(now);
  if (due.length === 0) return counts;
  const plans = await readJobOrgs(due.map((d) => d.job.organization_id));
  for (const run of due) {
    const plan = plans.get(run.job.organization_id);
    // Chat off for the workspace: nothing is read or written.
    if (!plan) continue;
    try {
      await fireDueRun(run, plan, now, driver, counts);
    } catch (err) {
      counts.failed += 1;
      console.error('[chat/schedules] a due job failed:', err);
    }
  }
  return counts;
}

// ─── Keeping runs in step ────────────────────────────────────────────────────

/**
 * A job's run row for its Chat run (CHAT-12 items 12, 15–16, 26): Needs you
 * while a card waits, Paused · AI limit reached at the month's limit, Done,
 * Failed (the workspace's own key failing too), Skipped when a person
 * stopped it or no card was answered in 7 days. Pure.
 */
export function scheduleRunStateOf(chat: Pick<LoadedRun, 'status' | 'progress'>): {
  status: 'running' | 'needs_you' | 'paused_cap' | 'done' | 'unchanged' | 'failed' | 'skipped';
  reason?: Reason;
} {
  switch (chat.status) {
    case 'waiting':
      return { status: 'needs_you' };
    case 'paused_cap':
      return { status: 'paused_cap', reason: 'aiLimit' };
    case 'done':
      // Read what its last delivered run read: No change, nothing sent (CHAT-12 item 20).
      return { status: chat.progress?.unchanged ? 'unchanged' : 'done' };
    case 'error':
      return { status: 'failed', reason: 'failed' };
    case 'stopped': {
      const why = chat.progress?.stoppedFor;
      if (why === 'limit') return { status: 'paused_cap', reason: 'aiLimit' };
      return { status: 'skipped', reason: why === 'expired' ? 'noAnswer' : 'stopped' };
    }
    default:
      return { status: 'running' };
  }
}

/**
 * Counts an ended run toward the job's failed runs in a row: a success
 * clears them; a failure adds one and, while the job is on, sets the one
 * retry 10 minutes on after a first attempt, or at 3 turns the job off
 * (failed). A job a person turned off meanwhile keeps their reason. Moved
 * only from what was read, so two settles at once count once.
 */
async function countRun(
  jobId: string,
  attempt: number,
  failed: boolean,
  now: Date,
): Promise<boolean> {
  for (let tries = 0; tries < 3; tries++) {
    const { data, error } = await supabaseAdmin
      .from('chat_schedules')
      .select('fail_count, enabled')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw new Error(`Could not read a scheduled job: ${error.message}`);
    if (!data) return false;
    const { enabled } = data as { enabled: boolean };
    const before = Number((data as { fail_count: number }).fail_count) || 0;
    const after = failed ? before + 1 : 0;
    if (after === before) return enabled;
    const patch =
      !failed || !enabled
        ? { fail_count: after }
        : after >= FAILURES_TO_TURN_OFF
          ? { fail_count: after, enabled: false, paused_reason: 'failed', retry_at: null }
          : {
              fail_count: after,
              retry_at:
                attempt === 1 ? new Date(now.getTime() + RETRY_AFTER_MS).toISOString() : null,
            };
    const { data: moved, error: moveError } = await supabaseAdmin
      .from('chat_schedules')
      .update(patch)
      .eq('id', jobId)
      .eq('fail_count', before)
      .eq('enabled', enabled)
      .select('id');
    if (moveError) throw new Error(`Could not count a scheduled run: ${moveError.message}`);
    if ((moved ?? []).length > 0) {
      const off = 'enabled' in patch && patch.enabled === false;
      // Its creator is told it turned off (W3-04a).
      if (off) await noticeJobPaused(jobId, 'failed', now);
      return enabled && !off;
    }
  }
  return true;
}

/**
 * Brings a job's run row in step with its Chat run (above), and the job
 * with how it ended. Safe to call at any time, and twice: each move is made
 * only from the state it read. Answers its status after.
 */
export async function settleScheduleRun(
  scheduleRunId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedule_runs')
    .select(RUN_COLUMNS)
    .eq('id', scheduleRunId)
    .is('ended_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read a scheduled run: ${error.message}`);
  const run = data as RunRow | null;
  if (!run || !(OPEN_RUN as readonly string[]).includes(run.status)) return run?.status ?? null;

  let target: ReturnType<typeof scheduleRunStateOf>;
  let held = false;
  let chat: LoadedRun | null = null;
  if (!run.run_id) {
    // Claimed, never handed to Chat: its worker was lost before the run was made.
    if (now.getTime() - Date.parse(run.started_at) <= HANDOVER_GRACE_MS) return run.status;
    target = { status: 'failed', reason: 'lost' };
  } else {
    chat = await loadRun(run.run_id);
    target = chat ? scheduleRunStateOf(chat) : { status: 'failed', reason: 'lost' };
    // Held at the limit: its row stays open until the job goes on (resumeCapPausedJobs).
    held = chat?.status === 'paused_cap';
  }
  if (target.status === run.status && (held || target.status !== 'paused_cap')) {
    // Still working: its "1 of 3 ready" follows the parts it made so far.
    if (chat && target.status !== 'paused_cap') {
      await keepRunResult(run, target.status, chat, { now });
    }
    return run.status;
  }
  const reason = target.reason ? reasonWords(target.reason) : null;
  if (!(await moveRunRow(run.id, run.status, target.status, { reason, now, held }))) {
    return null;
  }
  let jobOn = true;
  if (target.status === 'paused_cap') await pauseJob(run.schedule_id, 'cap');
  if (target.status === 'done' || target.status === 'unchanged') {
    jobOn = await countRun(run.schedule_id, run.attempt, false, now);
  }
  if (target.status === 'failed') {
    jobOn = await countRun(run.schedule_id, run.attempt, true, now);
  }
  // Its parts, fingerprint and notices (W3-04a: deliver.ts).
  await keepRunResult(run, target.status, chat, { reason, jobOn, now });
  return target.status;
}

/** Every run still open follows its Chat run (settleScheduleRun). Answers how many moved. */
export async function settleOpenRuns(now: Date): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedule_runs')
    .select('id, status')
    .in('status', [...OPEN_RUN])
    .is('ended_at', null)
    .order('started_at', { ascending: true })
    .limit(TICK_ROWS);
  if (error) throw new Error(`Could not read the open scheduled runs: ${error.message}`);
  let settled = 0;
  for (const { id, status } of (data ?? []) as { id: string; status: string }[]) {
    try {
      const after = await settleScheduleRun(id, { now });
      if (after !== null && after !== status) settled += 1;
    } catch (err) {
      console.error('[chat/schedules] could not settle a run:', err);
    }
  }
  return settled;
}

// ─── The AI limit's pauses ───────────────────────────────────────────────────

/**
 * Jobs paused at the AI limit (cap) go on once their workspace's limit has
 * room again (the monthly reset, credits, an upgrade; CHAT-12 item 17):
 * the run held at the limit stops ("Stopped at its limit"), and a
 * recurring job runs at its next slot after now, missed ones never
 * replayed; a one-time job ready by a date still to come starts again now,
 * one whose time passed keeps what is ready in its chat. Read-only
 * workspaces wait. Answers how many went on.
 */
export async function resumeCapPausedJobs(now: Date): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .select(JOB_COLUMNS)
    .eq('enabled', false)
    .eq('paused_reason', 'cap')
    .order('id', { ascending: true })
    .limit(TICK_ROWS);
  if (error) throw new Error(`Could not read the paused jobs: ${error.message}`);
  const jobs = (data ?? []) as JobRow[];
  if (jobs.length === 0) return 0;
  const plans = await readJobOrgs(jobs.map((j) => j.organization_id));
  let resumed = 0;
  for (const [orgId, plan] of plans) {
    if (!plan.writable) continue;
    const mine = jobs.filter((j) => j.organization_id === orgId);
    // The limit as an Admin reads it: the workspace's, whoever made the jobs.
    const actor: ChatActor = { userId: '', email: null, organizationId: orgId };
    if (await aiLimitReached(actor, 'admin')) continue;
    for (const job of mine) {
      try {
        if (await resumeJob(job, now)) resumed += 1;
      } catch (err) {
        console.error('[chat/schedules] could not resume a job:', err);
      }
    }
  }
  return resumed;
}

/** One cap-paused job goes on (above); false when another worker got to it. */
async function resumeJob(job: JobRow, now: Date): Promise<boolean> {
  const next =
    job.kind === 'recurring'
      ? nextJobRun(job, now).at
      : job.run_mode === 'ready_by' && job.due_at && Date.parse(job.due_at) > now.getTime()
        ? now.toISOString()
        : null;
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .update({ enabled: true, paused_reason: null, next_run_at: next })
    .eq('id', job.id)
    .eq('enabled', false)
    .eq('paused_reason', 'cap')
    .select('id');
  if (error) throw new Error(`Could not resume a scheduled job: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  // On again: the notice that it paused closes (W3-04a).
  await closeJobNotices(job.id, now);
  // Its run held at the limit stops: the next slot runs, not the held run.
  const { data: held, error: heldError } = await supabaseAdmin
    .from('chat_schedule_runs')
    .select('id, run_id')
    .eq('schedule_id', job.id)
    .eq('status', 'paused_cap')
    .is('ended_at', null);
  if (heldError) throw new Error(`Could not read a job's runs: ${heldError.message}`);
  for (const row of (held ?? []) as { id: string; run_id: string | null }[]) {
    if (row.run_id) await endHeldRun(row.run_id, 'paused_cap', 'limit');
    await moveRunRow(row.id, 'paused_cap', 'paused_cap', { reason: reasonWords('aiLimit'), now });
  }
  return true;
}
