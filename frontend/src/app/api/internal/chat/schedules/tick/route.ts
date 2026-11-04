import { NextResponse } from 'next/server';
import { z } from 'zod';
import { internalCallRefusal } from '@/lib/chat/internalCall';
import {
  fireDueJobs,
  resumeCapPausedJobs,
  scheduleRunDriver,
  settleOpenRuns,
} from '@/lib/chat/schedule/worker';
import { checkSkillUpdates } from '@/lib/chat/skills/updates';

// The runs it starts are driven past the answer (after()), within this.
export const maxDuration = 300;

const JOBS = ['settle', 'resume', 'due', 'skill_updates'] as const;
type Job = (typeof JOBS)[number];

const tickInput = z.strictObject({
  jobs: z
    .array(z.enum(JOBS))
    .min(1)
    .default([...JOBS]),
});

/**
 * POST /api/internal/chat/schedules/tick `{ jobs? }`
 *
 * Chat's scheduled jobs' minute (CHAT-12; W3-01), called by the API
 * server's cron right after the agents' tick, with `Authorization: Bearer
 * ${CHAT_INTERNAL_SECRET}` (lib/chat/schedule/worker.ts): settles the runs
 * still open, lets jobs paused at the AI limit go on once it has room, then
 * runs the jobs that are due; in its daily window, it also checks a few
 * imported skills' sources for a new SKILL.md (W4-31, skills/updates.ts).
 * `jobs` picks some; all by default. Also called by hand in development,
 * where the server's crons don't run: `skill_updates` named checks at once.
 *
 * 404 with the new Chat off, 401 without the secret, 400 a bad body. Each
 * job runs on its own: one that fails doesn't stop the others, and the
 * answer is 500 naming it (`failed`), with what the others did; else 200.
 * A workspace that is read-only, or where Chat is off, runs nothing.
 */
export async function POST(req: Request) {
  const refusal = internalCallRefusal(req);
  if (refusal) return refusal;
  const raw: unknown = await req.json().catch(() => ({}));
  const input = tickInput.safeParse(raw);
  if (!input.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const now = new Date();
  const jobs = new Set(input.data.jobs);
  const failed: Job[] = [];
  const run = async <T>(name: Job, job: () => Promise<T>): Promise<T | null> => {
    if (!jobs.has(name)) return null;
    try {
      return await job();
    } catch (error) {
      failed.push(name);
      console.error(`[chat/schedules] the tick's ${name} failed:`, error);
      return null;
    }
  };
  // In turn: a settled run frees its job before a due slot is checked.
  const settled = await run('settle', () => settleOpenRuns(now));
  const resumed = await run('resume', () => resumeCapPausedJobs(now));
  const due = await run('due', () => fireDueJobs(now, scheduleRunDriver));
  // Outside the daily window only when named (by hand).
  const named = Array.isArray((raw as { jobs?: unknown } | null)?.jobs);
  const skillUpdates = await run('skill_updates', () => checkSkillUpdates(now, { force: named }));
  const done = { settled, resumed, due, skillUpdates };
  return NextResponse.json(
    failed.length > 0 ? { ok: false, error: 'failed', failed, ...done } : { ok: true, ...done },
    { status: failed.length > 0 ? 500 : 200 },
  );
}
