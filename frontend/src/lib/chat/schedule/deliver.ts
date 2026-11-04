import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { LoadedRun } from '../engineStore';
import { readStrips, weekEndIn } from '../taskStrip';

/**
 * What a scheduled job's run leaves once it moves (CHAT-12 items 13, 16,
 * 18, 20, 26–27; W3-04a), beside its run row (worker.ts):
 *
 *   - Chat: the answer is in the job's own chat, its creator's, so it comes
 *     to their Inbox as an unread result: no notice of its own.
 *   - "1 of 3 ready": its parts, the tasks of its strip ready of all of
 *     them (a /tasks job), else the files it made, as it works and when it
 *     ends.
 *   - "Notify only if the answer changed": a delivered run's fingerprint is
 *     the job's last (last_fingerprint), what the next run compares to; a
 *     run with no change ("No change") keeps the one before.
 *   - Notices (chat_notices, 00461) at the top of the creator's Inbox: a run
 *     that failed after its retry ("{Job} didn't run: {reason}"), and a job
 *     that turned itself off (the AI limit, its creator's role or brand
 *     access, its brand or skill gone, 3 failed runs). One per event; a run
 *     that goes on, or the job turned back on, closes them.
 *
 * Never throws: what is left here is told, not what runs. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.notice' });

export const SCHEDULE_NOTICE_KINDS = ['schedule_failed', 'schedule_paused'] as const;
export type ScheduleNoticeKind = (typeof SCHEDULE_NOTICE_KINDS)[number];

/** Why a job turned itself off (chat_schedules.paused_reason, but a person's own Off). */
export type PausedReason = 'cap' | 'failed' | 'skill_off' | 'missing_source' | 'owner_role';

/** A job as its notices name it. */
interface NoticeJob {
  id: string;
  organization_id: string;
  created_by: string | null;
  title: string;
  conversation_id: string | null;
  skill_name: string | null;
}

const NOTICE_JOB_COLUMNS = 'id, organization_id, created_by, title, conversation_id, skill_name';

async function readNoticeJob(jobId: string): Promise<NoticeJob | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .select(NOTICE_JOB_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a scheduled job: ${error.message}`);
  return (data as NoticeJob | null) ?? null;
}

/** One notice for the job's creator; a second for the same event (`key`) is kept out. */
async function notify(
  job: NoticeJob,
  kind: ScheduleNoticeKind,
  reason: string,
  key: string,
): Promise<void> {
  if (!job.created_by) return;
  const { error } = await supabaseAdmin.from('chat_notices').insert({
    organization_id: job.organization_id,
    user_id: job.created_by,
    kind,
    payload: {
      scheduleId: job.id,
      title: job.title,
      reason: reason.slice(0, 200),
      conversationId: job.conversation_id,
    },
    dedupe_key: `schedule:${job.id}:${key}`.slice(0, 200),
  });
  if (error && error.code !== '23505') {
    throw new Error(`Could not write a scheduled job's notice: ${error.message}`);
  }
}

/**
 * The job turned itself off (above): its creator is told why, once per
 * reason a day. Never throws.
 */
export async function noticeJobPaused(
  jobId: string,
  reason: PausedReason,
  now: Date = new Date(),
): Promise<void> {
  try {
    const job = await readNoticeJob(jobId);
    if (!job) return;
    const words = t(`paused.${reason}`, { skill: job.skill_name ?? '' });
    await notify(
      job,
      'schedule_paused',
      words,
      `paused:${reason}:${now.toISOString().slice(0, 10)}`,
    );
  } catch (err) {
    console.error('[chat/schedules] could not tell that a job paused:', err);
  }
}

/** A run failed after its retry: "{Job} didn't run: {reason}". Never throws. */
export async function noticeRunFailed(
  jobId: string,
  runRowId: string,
  reason: string,
): Promise<void> {
  try {
    const job = await readNoticeJob(jobId);
    if (job) await notify(job, 'schedule_failed', reason, `failed:${runRowId}`);
  } catch (err) {
    console.error('[chat/schedules] could not tell that a run failed:', err);
  }
}

/** The job's open notices close: it ran, or it is on again. Never throws. */
export async function closeJobNotices(jobId: string, now: Date = new Date()): Promise<void> {
  try {
    const job = await readNoticeJob(jobId);
    if (!job?.created_by) return;
    const { data, error } = await supabaseAdmin
      .from('chat_notices')
      .select('id, payload')
      .eq('user_id', job.created_by)
      .in('kind', [...SCHEDULE_NOTICE_KINDS])
      .is('resolved_at', null);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as { id: string; payload: { scheduleId?: unknown } | null }[])
      .filter((row) => row.payload?.scheduleId === jobId)
      .map((row) => row.id);
    if (ids.length === 0) return;
    const { error: closeError } = await supabaseAdmin
      .from('chat_notices')
      .update({ resolved_at: now.toISOString() })
      .in('id', ids)
      .is('resolved_at', null);
    if (closeError) throw new Error(closeError.message);
  } catch (err) {
    console.error('[chat/schedules] could not close a job’s notices:', err);
  }
}

/** Most parts a run row counts (chat_schedule_runs.parts_total). */
const MAX_PARTS = 50;

/**
 * A run's parts ("1 of 3 ready", CHAT-12 item 13): its task strip's tasks
 * ready of all of them, else the files it made so far, each a part that is
 * ready. 0 of 0: one part, no bar.
 */
export async function partsOf(
  chat: Pick<LoadedRun, 'id' | 'conversationId' | 'progress'>,
): Promise<{ done: number; total: number }> {
  if (chat.progress.taskStrip) {
    const weekEnd = weekEndIn(new Date(), chat.progress.timezone);
    const strip = (await readStrips(supabaseAdmin, chat.conversationId, weekEnd, chat.id)).get(
      chat.id,
    );
    if (strip) {
      const total = Math.min(MAX_PARTS, strip.total);
      return { done: Math.min(total, strip.ready), total };
    }
  }
  const { count, error } = await supabaseAdmin
    .from('chat_files')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', chat.id);
  if (error) throw new Error(`Could not count a run's files: ${error.message}`);
  const files = Math.min(MAX_PARTS, count ?? 0);
  return { done: files, total: files };
}

/** The statuses a run row ends or waits in, as settleScheduleRun moves it. */
export type SettledStatus =
  'running' | 'needs_you' | 'paused_cap' | 'done' | 'unchanged' | 'failed' | 'skipped';

/**
 * Keeps what a run left (above) on its row and its job, after its row
 * moved to `status`: its parts and fingerprint; a delivered run's
 * fingerprint as the job's last; the job's notices closed once a run goes
 * on; a failed retry told. Never throws.
 */
export async function keepRunResult(
  run: { id: string; schedule_id: string; attempt: number },
  status: SettledStatus,
  chat: Pick<LoadedRun, 'id' | 'conversationId' | 'progress'> | null,
  {
    reason = null,
    jobOn = true,
    now = new Date(),
  }: {
    reason?: string | null;
    jobOn?: boolean;
    now?: Date;
  } = {},
): Promise<void> {
  try {
    if (chat) {
      const parts = await partsOf(chat);
      const { error } = await supabaseAdmin
        .from('chat_schedule_runs')
        .update({
          parts_done: parts.done,
          parts_total: parts.total,
          ...(chat.progress.fingerprint ? { fingerprint: chat.progress.fingerprint } : {}),
        })
        .eq('id', run.id);
      if (error) throw new Error(error.message);
    }
    if (status === 'done' || status === 'unchanged') {
      // A delivered run is what the next change-only run compares to; No change keeps the last.
      if (status === 'done' && chat?.progress.fingerprint) {
        const { error } = await supabaseAdmin
          .from('chat_schedules')
          .update({ last_fingerprint: chat.progress.fingerprint })
          .eq('id', run.schedule_id);
        if (error) throw new Error(error.message);
      }
      await closeJobNotices(run.schedule_id, now);
    }
    // The first failure is tried again in 10 minutes: only a failed retry is told (CHAT-12
    // item 26). A job that turned off on it is told so by its own notice.
    if (status === 'failed' && run.attempt >= 2 && jobOn) {
      await noticeRunFailed(run.schedule_id, run.id, reason ?? t('failed'));
    }
  } catch (err) {
    console.error('[chat/schedules] could not keep what a run left:', err);
  }
}
