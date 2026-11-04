'use server';

import { z } from 'zod';
import { OPENED_CLOSES, noticeOf, type ChatNotice, type NoticeRow } from '@/lib/chat/notices';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { createClient } from '@/lib/supabase/server';

/**
 * The person's own notices from the system (00441), for the top of their
 * Inbox's Needs you: their workspace's own AI key fails (AGENT-OWN-KEY §5.3),
 * or its agents reached 80% or all of their monthly limit on it (§4.2 item
 * 4, PR 10), for Admins; an agent went live on its own, or an edit stopped
 * it (AUTONOMOUS-GO-LIVE §6.4, 00446), for its owner and the people it
 * notifies; a scheduled job's run failed or the job paused (00461), for its
 * owner. The server writes them. Read with the person's session (RLS:
 * their own rows, about brands they reach), open ones only: a key that works
 * again, a period that renews or a limit raised resolves its notice; one
 * about an agent closes once the person opens it.
 */

export type { ChatNotice, ScheduleNotice } from '@/lib/chat/notices';

export type ChatNoticesRead = { ok: true; notices: ChatNotice[] } | { ok: false };

/** How many open notices the Inbox lists at most. */
const NOTICES_MAX = 10;

async function signedIn() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id ?? null;
  if (!orgId || !chatAgenticEnabled(orgId)) return null;
  return { client, userId: user.id };
}

/** The person's open notices, newest first; { ok: false } when they can't be read. */
export async function readChatNotices(): Promise<ChatNoticesRead> {
  try {
    const me = await signedIn();
    if (!me) return { ok: true, notices: [] };
    const { data, error } = await me.client
      .from('chat_notices')
      .select('id, kind, payload, created_at, read_at')
      .eq('user_id', me.userId)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(NOTICES_MAX);
    if (error) {
      console.error('[chat/notices] could not read the notices:', error.message);
      return { ok: false };
    }
    const notices = ((data ?? []) as NoticeRow[])
      .map(noticeOf)
      .filter((notice): notice is ChatNotice => notice !== null);
    return { ok: true, notices };
  } catch (err) {
    console.error('[chat/notices] could not read the notices:', err);
    return { ok: false };
  }
}

const idsSchema = z.array(z.uuid()).min(1).max(NOTICES_MAX);

/**
 * A notice about an agent the person opened (Open page, Open run, Open
 * agent): it leaves Needs you (resolved_at). Their own row only, and only
 * one that opening closes; a key's stays until the key works. Open while
 * the workspace is read-only, as reading. Never throws.
 */
export async function closeChatNotice(id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  try {
    const me = await signedIn();
    if (!me) return false;
    const { error } = await me.client
      .from('chat_notices')
      .update({ resolved_at: new Date().toISOString() })
      .eq('user_id', me.userId)
      .eq('id', id)
      .in('kind', [...OPENED_CLOSES])
      .is('resolved_at', null);
    if (error) {
      console.error('[chat/notices] could not close a notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chat/notices] could not close a notice:', err);
    return false;
  }
}

/**
 * The notices on screen are read (read_at). Open while the workspace is
 * read-only: it is the person's own record, nothing that runs or costs.
 * Never throws; false when they couldn't be marked.
 */
export async function markChatNoticesRead(ids: string[]): Promise<boolean> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return false;
  try {
    const me = await signedIn();
    if (!me) return false;
    const { error } = await me.client
      .from('chat_notices')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', me.userId)
      .in('id', parsed.data)
      .is('read_at', null);
    if (error) {
      console.error('[chat/notices] could not mark the notices read:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chat/notices] could not mark the notices read:', err);
    return false;
  }
}
