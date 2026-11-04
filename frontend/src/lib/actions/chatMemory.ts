'use server';

import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  deleteMemory,
  memoryRefusal,
  readMemoryViewer,
  saidRefusal,
  saveMemory,
  type MemoryViewer,
  type SaveMemoryInput,
  type SavedMemory,
} from '@/lib/chat/memory/store';
import { assertWritable } from '@/lib/subscriptionGuard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Chat's memory changes (CHAT-14 items 7–11, CHAT-20 §9 rows 73–74),
 * behind CHAT_AGENTIC: what save_memory and forget_memory call once their
 * card is approved (forget_memory also in Full auto), as the signed-in
 * member, through their session, after the read-only check. The rules are
 * memory/store.ts's. A refusal is a value (#1777) the engine reads, `{ ok:
 * false, reason, message }`, which Chat says in words.
 */

type Refused = ReturnType<typeof saidRefusal>;

/** The signed-in member as the memory's rules read them; null when Chat is off for them. */
async function viewer(): Promise<MemoryViewer | null> {
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
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  return readMemoryViewer({ userId: user.id, organizationId });
}

/** Saves a line from Chat's card: in the person's words, the scope they picked (item 7). */
export async function saveChatMemory(input: {
  scope: SaveMemoryInput['scope'];
  text: string;
  brand_id?: string | null;
  replaces?: string | null;
}): Promise<SavedMemory | Refused> {
  await assertWritable();
  const who = await viewer();
  if (!who) return saidRefusal(memoryRefusal('not_found').refusal);
  const saved = await saveMemory(
    who,
    {
      scope: input.scope,
      text: input.text,
      brandId: input.brand_id ?? null,
      replaces: input.replaces ?? null,
    },
    'chat',
  );
  return saved.ok ? saved.value : saidRefusal(saved.refusal);
}

/** Removes a line Chat found for "Forget that…" (item 11): Undo brings it back for 10 seconds. */
export async function forgetChatMemory(input: {
  memory_id: string;
}): Promise<{ id: string; scope: string; text: string; undoUntil: string } | Refused> {
  await assertWritable();
  const who = await viewer();
  if (!who) return saidRefusal(memoryRefusal('not_found').refusal);
  const removed = await deleteMemory(who, input.memory_id);
  return removed.ok ? removed.value : saidRefusal(removed.refusal);
}
