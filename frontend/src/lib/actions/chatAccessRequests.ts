'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberAuth } from '@/lib/memberEmails';
import type { TeamRole } from '@/components/context/RoleProvider';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { parseTeamRole } from '@/lib/chat/precedence';
import {
  REQUEST_HISTORY_DAYS,
  type AccessRequest,
  type AccessRequestStatus,
} from '@/lib/chat/accessRequests';
import {
  draftedMemoryText,
  isServerDraftedChange,
  sendAccessRequest,
  type AccessRequestInput,
  type RequestAccessResult,
} from '@/lib/chat/accessRequestStore';

/**
 * "Ask your Admin" (CHAT-20 §4c, registry row 80a `access.request`), behind
 * CHAT_AGENTIC: a person whose role, plan or tool policy kept Chat from a
 * change asks the workspace's Admins, only by their own click. Admins see
 * the requests in Settings › Team › Roles & access › Requests and approve
 * or dismiss them; the first to act decides for all. The requester sees
 * theirs, and may withdraw one while it is pending. Rows in
 * chat_access_requests (00403), written here with the service role after
 * these checks.
 */

interface Member {
  userId: string;
  organizationId: string;
  role: TeamRole;
}

async function member(): Promise<Member | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const role = parseTeamRole(profile?.role);
  const organizationId = profile?.organization_id;
  if (!organizationId || !role || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId, role };
}

export type { AccessRequestInput, RequestAccessResult };

/**
 * Sends a request to the workspace's Admins. Admins don't need to ask. A
 * drafted Workspace memory line isn't the browser's to send: an Admin's
 * approval saves it as is, so only the memory store makes one.
 */
export async function requestAccess(input: AccessRequestInput): Promise<RequestAccessResult> {
  const who = await member();
  if (!who) return { ok: false, reason: 'chat_off' };
  if (isServerDraftedChange(input?.draftedChange)) return { ok: false, reason: 'invalid' };
  return sendAccessRequest(who, input);
}

/** Withdraws the person's own pending request. False when it isn't one any more. */
export async function withdrawAccessRequest(id: string): Promise<boolean> {
  const who = await member();
  if (!who || !z.guid().safeParse(id).success) return false;
  const { data, error } = await supabaseAdmin
    .from('chat_access_requests')
    .update({ status: 'withdrawn', decided_by: who.userId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('requester_id', who.userId)
    .eq('organization_id', who.organizationId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** What an Admin's decision did. */
export type DecideAccessResult =
  | { ok: true }
  /** Another Admin decided it first, or the requester withdrew it. */
  | { ok: false; reason: 'already_decided' }
  /** An approved Workspace memory line memory can't keep now: the request waits again. */
  | { ok: false; reason: 'not_saved'; message: string };

/**
 * An Admin approves or dismisses a pending request of their workspace. The
 * first Admin to act decides it. An approved request for a Workspace memory
 * line saves it (CHAT-14 item 25), checked again; when it can't be saved
 * the request is pending again and the Admin is told why, so an approval
 * never shows for a line that isn't there.
 */
export async function decideAccessRequest(
  id: string,
  decision: 'approved' | 'rejected',
): Promise<DecideAccessResult> {
  const who = await member();
  if (!who || who.role !== 'admin') throw new Error('Only Admins decide access requests');
  if (!z.guid().safeParse(id).success || !['approved', 'rejected'].includes(decision)) {
    return { ok: false, reason: 'already_decided' };
  }
  const { data, error } = await supabaseAdmin
    .from('chat_access_requests')
    .update({ status: decision, decided_by: who.userId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', who.organizationId)
    .eq('status', 'pending')
    .select('id, requester_id, tool_key, drafted_change');
  if (error) throw new Error(error.message);
  const decided = (data ?? []) as {
    requester_id: string;
    tool_key: string | null;
    drafted_change: unknown;
  }[];
  if (decided.length === 0) return { ok: false, reason: 'already_decided' };
  if (decision !== 'approved') return { ok: true };

  // Back to pending, as this Admin's approval left it: the line wasn't saved.
  const reopen = async () => {
    const { error: reopenError } = await supabaseAdmin
      .from('chat_access_requests')
      .update({ status: 'pending', decided_by: null, decided_at: null })
      .eq('id', id)
      .eq('organization_id', who.organizationId)
      .eq('status', 'approved')
      .eq('decided_by', who.userId);
    if (reopenError) throw new Error(reopenError.message);
  };
  // Loaded only on an approval: the memory store is a large module.
  const { applyMemoryRequest } = await import('@/lib/chat/memory/store');
  let applied: Awaited<ReturnType<typeof applyMemoryRequest>>;
  try {
    applied = await applyMemoryRequest(who, decided[0]);
  } catch (err) {
    await reopen();
    throw err;
  }
  if (applied && !applied.ok) {
    await reopen();
    return { ok: false, reason: 'not_saved', message: applied.refusal.message };
  }
  return { ok: true };
}

/** Why a read gave nothing: Chat is off for the person, or the database didn't answer. */
export type RequestsReadFailure = 'chat_off' | 'failed';

/**
 * The requests a person sees: an Admin, the workspace's; anyone else, their
 * own. Pending first, then the decided ones of the last weeks. Never throws
 * (#1777): a failed read is `failed`.
 */
export async function listAccessRequests(): Promise<
  | { ok: true; isAdmin: boolean; requests: AccessRequest[] }
  | { ok: false; failure: RequestsReadFailure }
> {
  try {
    const read = await readAccessRequests();
    return read ? { ok: true, ...read } : { ok: false, failure: 'chat_off' };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

async function readAccessRequests(): Promise<{
  isAdmin: boolean;
  requests: AccessRequest[];
} | null> {
  const who = await member();
  if (!who) return null;
  const isAdmin = who.role === 'admin';
  const since = new Date(Date.now() - REQUEST_HISTORY_DAYS * 86_400_000).toISOString();
  let query = supabaseAdmin
    .from('chat_access_requests')
    .select(
      'id, requester_id, asked, tool_key, rule_kind, rule_detail, drafted_change, status, created_at, decided_at',
    )
    .eq('organization_id', who.organizationId)
    .or(`status.eq.pending,created_at.gte."${since}"`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!isAdmin) query = query.eq('requester_id', who.userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const ids = [...new Set(rows.map((row) => row.requester_id))];
  const [profiles, auth] = await Promise.all([
    ids.length
      ? supabaseAdmin.from('profiles').select('id, full_name').in('id', ids)
      : { data: [], error: null },
    readMemberAuth(ids),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name?.trim() || null]));

  const requests = rows.map((row) => ({
    id: row.id,
    requester:
      names.get(row.requester_id) || auth.get(row.requester_id)?.email?.split('@')[0] || '',
    isYours: row.requester_id === who.userId,
    asked: row.asked,
    toolKey: row.tool_key,
    ruleKind: row.rule_kind as AccessRequest['ruleKind'],
    ruleDetail: row.rule_detail,
    draftedText: draftedMemoryText(row.tool_key, row.drafted_change),
    status: row.status as AccessRequestStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }));
  // Pending ones first, each part newest first.
  requests.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  return { isAdmin, requests };
}

/**
 * How many requests wait for an Admin: the count on Roles & access, 0 for
 * anyone else. Never throws, as above.
 */
export async function countPendingAccessRequests(): Promise<
  { ok: true; count: number } | { ok: false; failure: RequestsReadFailure }
> {
  try {
    const who = await member();
    if (!who) return { ok: false, failure: 'chat_off' };
    if (who.role !== 'admin') return { ok: true, count: 0 };
    const { count, error } = await supabaseAdmin
      .from('chat_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', who.organizationId)
      .eq('status', 'pending');
    return error ? { ok: false, failure: 'failed' } : { ok: true, count: count ?? 0 };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}
