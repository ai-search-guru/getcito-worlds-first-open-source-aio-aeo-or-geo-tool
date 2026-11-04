'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assertWritable } from '@/lib/subscriptionGuard';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { newSchedule, scheduleInputSchema } from '@/lib/chat/schedule/input';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import {
  createSchedule,
  type MadeSchedule,
  type NewSchedule,
  type ScheduleRefusal,
} from '@/lib/chat/schedule/store';

/**
 * Chat's scheduled jobs, as the signed-in person (CHAT-12; W3-02): the
 * change the schedule card's Create schedule makes, through their session
 * as the app's other changes are, refused while the workspace is read-only
 * or on the demo brand. The job is written with the service role after
 * schedule/store.ts's checks for them (role, brand, skill, the plan's active
 * jobs). Behind CHAT_AGENTIC.
 */

/** The signed-in person and their workspace, with Chat on; null otherwise. */
async function member(): Promise<{ userId: string; organizationId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the member: ${error.message}`);
  const organizationId = profile?.organization_id as string | null | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId };
}

/** Where the card was: the run's clock and the run. */
const placeSchema = z.object({
  timezone: z.string().max(100),
  runId: contentUuid.nullable(),
});

/**
 * Makes a scheduled job from its card's click: the job as the card had it,
 * read on the person's clock (`timezone`, the run's), named with the run
 * whose card made it. Read again with the create_schedule tool's schema: a
 * server action can be called with anything.
 */
export async function createChatSchedule(
  input: NewSchedule,
  place: { timezone: string; runId: string | null },
): Promise<MadeSchedule | ScheduleRefusal> {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<NewSchedule>;
  const parsed = scheduleInputSchema.safeParse({
    brand_id: raw.brandId ?? undefined,
    title: raw.title,
    when: raw.when,
    prompt: raw.prompt,
    skill: raw.skill,
    deliver_to: raw.deliver,
    change_only: raw.changeOnly,
  });
  const where = placeSchema.safeParse(place);
  if (!parsed.success || !where.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: (parsed.error ?? where.error)?.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const job = newSchedule(parsed.data);
  await assertWritable({ brandId: job.brandId });
  const who = await member();
  if (!who) return { ok: false, reason: 'forbidden_role', message: 'Chat is off.' };
  return createSchedule({ ...who, ...where.data }, job);
}
