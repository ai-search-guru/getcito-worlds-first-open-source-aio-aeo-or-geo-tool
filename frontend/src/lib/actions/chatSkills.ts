'use server';

import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  readSkillViewer,
  saveSkill,
  skillRefusal,
  type SaveSkillInput,
  type SavedSkill,
  type SkillResult,
} from '@/lib/chat/skills/store';
import { assertWritable } from '@/lib/subscriptionGuard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Saving a skill of one's own (CHAT-13 item 12, CHAT-20 §9 row 75), behind
 * CHAT_AGENTIC: what Chat's save_skill row calls once its card is approved
 * (or Full auto runs it), as the signed-in member, through their session,
 * after the read-only check. The rules (role, the SKILL.md check, the
 * library's names, the plan's limit) are skills/store.ts's. A refusal is a
 * value (#1777), which Chat says in words.
 */
export async function saveChatSkill(input: SaveSkillInput): Promise<SkillResult<SavedSkill>> {
  await assertWritable();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const organizationId = profile?.organization_id;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return skillRefusal('not_found');
  const viewer = await readSkillViewer({ userId: user.id, organizationId });
  if (!viewer) return skillRefusal('not_found');
  return saveSkill(viewer, input);
}
