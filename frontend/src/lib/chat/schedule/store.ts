import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isTimeZone } from '@/lib/timeZone';
import type { PlanFacts } from '../planFacts';
import { readPrecedenceContext } from '../precedenceContext';
import { enabledSkills } from '../skills/library';
import { nextJobRun } from './rule';
import {
  dateWords,
  readWhen,
  whenWords,
  type ScheduleWhen,
  type WhenReading,
  type WhenWords,
} from './when';

/**
 * Making a scheduled job (CHAT-12 items 7–9; W3-02): what the `schedule`
 * tool checks before its card and does once the card is clicked. Never
 * without that click: the tool is a WRITE that shows its card in every mode
 * (alwaysCard). Checked for the person now, as the worker checks before
 * each run: an Admin or a Manager, with the job's brand in their access, a
 * skill that is on, a phrase that reads as one schedule, and room in the
 * plan's active jobs (Trial 1 · Starter 5 · Growth 25 · Enterprise 100;
 * follow-up checks don't count). Its runs are always Auto · Normal (Wave 3
 * decision); its mode is Auto, ask before changes. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules' });
const whenT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatSchedules.when',
}) as unknown as WhenWords;

/** Active scheduled jobs each plan keeps on at once (Wave 3 decision 9). */
export const SCHEDULE_LIMITS = { trial: 1, starter: 5, growth: 25, enterprise: 100 } as const;

/**
 * The workspace's active job limit: the trial's in the trial, whatever its
 * plan; Enterprise's from the contract (plan_overrides.maxActiveSchedules),
 * 100 without one; none self-hosted.
 */
export function activeScheduleLimit(plan: PlanFacts): number | null {
  if (plan.selfHosted) return null;
  if (plan.isTrial) return SCHEDULE_LIMITS.trial;
  if (plan.planId === 'enterprise') {
    const contract = (plan.limits as { maxActiveSchedules?: unknown }).maxActiveSchedules;
    return typeof contract === 'number' && Number.isInteger(contract) && contract > 0
      ? contract
      : SCHEDULE_LIMITS.enterprise;
  }
  return plan.planId === 'growth' ? SCHEDULE_LIMITS.growth : SCHEDULE_LIMITS.starter;
}

/**
 * The workspace's live jobs: on, with a run or a retry still to come. A
 * one-time job that has run stays on with nothing due, and doesn't count;
 * follow-up checks don't either.
 */
const liveSchedules = (organizationId: string, options?: { count: 'exact'; head: true }) =>
  supabaseAdmin
    .from('chat_schedules')
    .select('id', options)
    .eq('organization_id', organizationId)
    .eq('enabled', true)
    .neq('kind', 'followup_check')
    .or('next_run_at.not.is.null,retry_at.not.is.null');

/** How many of the workspace's jobs are live (above): what the plan's limit counts. */
export async function countActiveSchedules(organizationId: string): Promise<number> {
  const { count, error } = await liveSchedules(organizationId, { count: 'exact', head: true });
  if (error) throw new Error(`Could not count the scheduled jobs: ${error.message}`);
  return count ?? 0;
}

/**
 * Whether a job just made fits the plan's limit: among the first `limit`
 * live jobs, oldest first. Two made at once both see each other, and the
 * later one is over.
 */
async function withinLimit(organizationId: string, id: string, limit: number): Promise<boolean> {
  const { data, error } = await liveSchedules(organizationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not count the scheduled jobs: ${error.message}`);
  return ((data ?? []) as { id: string }[]).some((row) => row.id === id);
}

/** Where a job's results go (CHAT-12 item 7): the card's Deliver to. */
export const DELIVER_CHOICES = ['chat', 'email', 'both'] as const;
export type DeliverChoice = (typeof DELIVER_CHOICES)[number];

export const deliverToOf = (choice: DeliverChoice): ('chat' | 'email')[] =>
  choice === 'both' ? ['chat', 'email'] : [choice];

export const deliverChoiceOf = (deliverTo: readonly string[]): DeliverChoice =>
  deliverTo.includes('chat') && deliverTo.includes('email')
    ? 'both'
    : deliverTo.includes('email')
      ? 'email'
      : 'chat';

/** A job as the card says it: its words for when and where. */
export function deliverWords(choice: DeliverChoice): string {
  return t(`deliver.${choice}`);
}

/** A job as the tool asks for it. */
export interface NewSchedule {
  title: string;
  /** The person's date phrase, in English. */
  when: string;
  prompt?: string;
  skill?: string;
  /** The chat's brand, fixed for the job; null: about the whole workspace. */
  brandId: string | null;
  deliver: DeliverChoice;
  changeOnly: boolean;
}

/** Who makes it, and where. */
export interface ScheduleMaker {
  userId: string;
  organizationId: string;
  /** The person's time zone: the run's (their browser's). */
  timezone: string;
  /** The Chat run whose card made it. */
  runId?: string | null;
}

/** A refusal the model is told, in a §11a code and words (the engine's saidFailure). */
export interface ScheduleRefusal {
  ok: false;
  reason: 'invalid' | 'quota_exceeded' | 'forbidden_role' | 'not_found';
  message: string;
}

const refuse = (reason: ScheduleRefusal['reason'], message: string): ScheduleRefusal => ({
  ok: false,
  reason,
  message,
});

/** What the model is told about a phrase that didn't read: why, and for an ambiguous one, what to ask. */
function whenRefusal(
  phrase: string,
  reading: Extract<WhenReading, { ok: false }>,
  timeZone: string,
  now: Date,
): ScheduleRefusal {
  if (reading.problem === 'ambiguous') {
    return refuse(
      'invalid',
      t('tool.ambiguous', {
        phrase,
        options: reading.options.map((o) => dateWords(o.at, timeZone, now, whenT)).join(' / '),
        phrases: reading.options.map((o) => `“${o.phrase}”`).join(', '),
      }),
    );
  }
  return refuse('invalid', t(`tool.${reading.problem}`, { phrase, zone: timeZone }));
}

/** The person's zone, or UTC: a job always reads its rule on a zone's clock. */
const zoneOf = (timezone: string) => (isTimeZone(timezone) ? timezone : 'UTC');

/**
 * The checks before the card, and again before the job is made (above).
 * Answers what it will run on, or the refusal the model is told.
 */
export async function checkNewSchedule(
  maker: ScheduleMaker,
  input: NewSchedule,
  now: Date,
): Promise<
  { ok: true; when: ScheduleWhen; plan: PlanFacts; limit: number | null } | ScheduleRefusal
> {
  const zone = zoneOf(maker.timezone);
  const reading = readWhen(input.when, { now, timeZone: zone });
  if (!reading.ok) return whenRefusal(input.when, reading, zone, now);
  if (input.skill && !enabledSkills(maker.organizationId).some((s) => s.name === input.skill)) {
    return refuse('not_found', t('tool.skill', { skill: input.skill }));
  }
  const ctx = await readPrecedenceContext({
    userId: maker.userId,
    organizationId: maker.organizationId,
    mode: 'auto',
    surface: 'chat',
  });
  if (!ctx || (ctx.role !== 'admin' && ctx.role !== 'manager')) {
    return refuse('forbidden_role', t('tool.role'));
  }
  if (input.brandId && ctx.brandAccess !== 'all' && !ctx.brandAccess.includes(input.brandId)) {
    return refuse('not_found', t('tool.role'));
  }
  const limit = activeScheduleLimit(ctx.plan);
  if (limit !== null) {
    const count = await countActiveSchedules(maker.organizationId);
    if (count >= limit) return refuse('quota_exceeded', t('tool.limit', { limit, count }));
  }
  return { ok: true, when: reading.when, plan: ctx.plan, limit };
}

/** A job once made, for the model and the step. */
export interface MadeSchedule {
  ok: true;
  schedule_id: string;
  title: string;
  /** "Every Monday, 09:00 · Europe/Istanbul" */
  when: string;
  /** Its first run, ISO; null for none. */
  next_run_at: string | null;
  deliver: string;
  ready_by: boolean;
}

/** When a new job first runs: its first slot, its time, or now for ready by (it starts at once). */
export function firstRunOf(when: ScheduleWhen, timeZone: string, now: Date): string | null {
  if (when.kind === 'recurring') {
    return nextJobRun({ kind: 'recurring', rrule: when.rrule, timezone: timeZone }, now).at;
  }
  return when.runMode === 'ready_by' ? now.toISOString() : when.dueAt;
}

/**
 * Makes the job, once its card was clicked: checked again (above), then
 * written with the service role, as its maker. Its chat is made on its
 * first run (the worker). A refusal answers instead, nothing written.
 */
export async function createSchedule(
  maker: ScheduleMaker,
  input: NewSchedule,
  now: Date = new Date(),
): Promise<MadeSchedule | ScheduleRefusal> {
  const checked = await checkNewSchedule(maker, input, now);
  if (!checked.ok) return checked;
  const { when } = checked;
  const zone = zoneOf(maker.timezone);
  const recurring = when.kind === 'recurring';
  const next = firstRunOf(when, zone, now);
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .insert({
      organization_id: maker.organizationId,
      kind: when.kind,
      run_mode: when.kind === 'once' ? when.runMode : 'run_at',
      due_at: when.kind === 'once' ? when.dueAt : null,
      next_run_at: next,
      rrule: recurring ? when.rrule : null,
      timezone: zone,
      title: input.title.trim().slice(0, 120),
      prompt: input.prompt?.trim() || null,
      skill_name: input.skill ?? null,
      brand_id: input.brandId,
      created_by: maker.userId,
      deliver_to: deliverToOf(input.deliver),
      recipient_ids: [],
      // Recurring only (the database checks it too).
      change_only: recurring && input.changeOnly,
      // Auto, ask before changes; always Auto · Normal (Wave 3 decision).
      mode: 'auto',
      model: 'auto',
      effort: 'normal',
      created_via: 'card',
      set_by_run_id: maker.runId ?? null,
      enabled: true,
      // Its place in the plan's limit when two are made at once (withinLimit).
      created_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Could not make the scheduled job: ${error?.message ?? 'no row'}`);
  }
  const id = (data as { id: string }).id;
  // Counted again with it in: another made at the same time may have taken the last room.
  if (checked.limit !== null && !(await withinLimit(maker.organizationId, id, checked.limit))) {
    const { error: undone } = await supabaseAdmin.from('chat_schedules').delete().eq('id', id);
    if (undone) throw new Error(`Could not undo the scheduled job: ${undone.message}`);
    const count = await countActiveSchedules(maker.organizationId);
    return refuse('quota_exceeded', t('tool.limit', { limit: checked.limit, count }));
  }
  return {
    ok: true,
    schedule_id: id,
    title: input.title.trim(),
    when: whenWords(when, zone, now, whenT, { withZone: true }),
    next_run_at: next,
    deliver: deliverWords(input.deliver),
    ready_by: when.kind === 'once' && when.runMode === 'ready_by',
  };
}

/** The step once made (CHAT-12 item 9): "Scheduled: {title}", "{when} · {deliver to}". */
export function madeStep(made: MadeSchedule): { label: string; detail: string } {
  return {
    label: t('step.done', { title: made.title }),
    detail: t(made.ready_by ? 'step.detailReadyBy' : 'step.detail', {
      when: made.when,
      deliver: made.deliver,
    }),
  };
}
