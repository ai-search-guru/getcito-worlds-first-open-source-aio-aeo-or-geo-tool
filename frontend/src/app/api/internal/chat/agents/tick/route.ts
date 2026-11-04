import { NextResponse } from 'next/server';
import { z } from 'zod';
import { agentRunDriver } from '@/lib/chat/agentDriver';
import { sweepAgents } from '@/lib/chat/agentSweep';
import { fireDueSchedules } from '@/lib/chat/agentTriggers';
import { internalCallRefusal } from '@/lib/chat/internalCall';
import { purgeDeletedMemory } from '@/lib/chat/memory/store';

// The runs it starts are driven past the answer (after()), within this.
export const maxDuration = 300;

const tickInput = z.strictObject({
  jobs: z
    .array(z.enum(['schedules', 'sweep', 'memory']))
    .min(1)
    .default(['schedules', 'sweep', 'memory']),
});

/**
 * POST /api/internal/chat/agents/tick `{ jobs? }`
 *
 * The agents' minute (CHAT-21 §E, §G, §H; W2-16), called by the API
 * server's cron with `Authorization: Bearer ${CHAT_INTERNAL_SECRET}`:
 * fires the Schedule triggers that are due, then sweeps (lost and stale
 * runs, failures, the AI limit's pauses) and starts what each workspace has
 * room for; and deletes for good the memory lines deleted past their Undo
 * (CHAT-14 item 23). `jobs` picks some; all by default. Also called by hand
 * in development, where the server's crons don't run.
 *
 * 404 with the new Chat off, 401 without the secret, 400 a bad body. Each
 * job runs on its own: one that fails doesn't stop the other, and the
 * answer is 500 naming it (`failed`), with what the other did; else 200.
 * A workspace that is read-only, or where Chat is off, starts nothing.
 */
export async function POST(req: Request) {
  const refusal = internalCallRefusal(req);
  if (refusal) return refusal;
  const input = tickInput.safeParse(await req.json().catch(() => ({})));
  if (!input.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const now = new Date();
  const jobs = new Set(input.data.jobs);
  const failed: string[] = [];
  const run = async <T>(
    name: 'schedules' | 'sweep' | 'memory',
    job: () => Promise<T>,
  ): Promise<T | null> => {
    if (!jobs.has(name)) return null;
    try {
      return await job();
    } catch (error) {
      failed.push(name);
      console.error(`[chat/agents] the tick's ${name} failed:`, error);
      return null;
    }
  };
  // In turn, so the sweep sees what the schedules queued; each apart from the other.
  const schedules = await run('schedules', () => fireDueSchedules(now, agentRunDriver));
  const sweep = await run('sweep', () => sweepAgents(now, agentRunDriver));
  const memory = await run('memory', async () => ({ purged: await purgeDeletedMemory(now) }));
  return NextResponse.json(
    failed.length > 0
      ? { ok: false, error: 'failed', failed, schedules, sweep, memory }
      : { ok: true, schedules, sweep, memory },
    { status: failed.length > 0 ? 500 : 200 },
  );
}
