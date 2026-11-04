import { createHash } from 'crypto';
import { z } from 'zod';
import type { TeamRole } from '@/components/context/RoleProvider';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  ACCESS_REQUEST_RULES,
  MAX_DRAFTED_CHANGE_CHARS,
  MAX_PENDING_REQUESTS,
  MAX_REQUESTS_PER_DAY,
} from './accessRequests';

/**
 * Writing an "Ask your Admin" request (CHAT-20 §4c, chat_access_requests
 * 00403), after the checks every request passes. Not a server action: the
 * browser's requests go through requestAccess (lib/actions/
 * chatAccessRequests.ts), which turns away a drafted change only the
 * server makes; the stores (a Manager's Workspace memory line) send theirs
 * from here. Server only.
 */

/** The person a request is from. */
export interface AccessRequester {
  userId: string;
  organizationId: string;
  role: TeamRole;
}

const requestSchema = z.object({
  asked: z.string().trim().min(1).max(500),
  ruleKind: z.enum(ACCESS_REQUEST_RULES),
  ruleDetail: z.string().trim().max(500).default(''),
  toolKey: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]{1,63}$/)
    .nullish(),
  // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
  brandId: z.guid().nullish(),
  conversationId: z.guid().nullish(),
  draftedChange: z
    .record(z.string(), z.unknown())
    .nullish()
    .refine(
      (change) => change == null || JSON.stringify(change).length <= MAX_DRAFTED_CHANGE_CHARS,
    ),
});

export type AccessRequestInput = z.input<typeof requestSchema>;

export type RequestAccessResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'chat_off' | 'admin' | 'invalid' | 'too_many' | 'daily_limit' | 'already_today';
    };

/** The fingerprint of an asked change: one request a day for the same one. */
function askedHash(toolKey: string | null, asked: string): string {
  return createHash('sha256')
    .update(`${toolKey ?? ''}\n${asked.toLowerCase().replace(/\s+/g, ' ')}`)
    .digest('hex');
}

/** Sends a request to the workspace's Admins. Admins don't need to ask. */
export async function sendAccessRequest(
  who: AccessRequester,
  input: AccessRequestInput,
): Promise<RequestAccessResult> {
  if (who.role === 'admin') return { ok: false, reason: 'admin' };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const req = parsed.data;

  const [pending, sentToday, brand, conversation] = await Promise.all([
    supabaseAdmin
      .from('chat_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requester_id', who.userId)
      .eq('status', 'pending'),
    // The table's requested_on: today in UTC.
    supabaseAdmin
      .from('chat_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requester_id', who.userId)
      .eq('requested_on', new Date().toISOString().slice(0, 10)),
    req.brandId
      ? supabaseAdmin
          .from('brands')
          .select('id')
          .eq('id', req.brandId)
          .eq('organization_id', who.organizationId)
          .maybeSingle()
      : null,
    req.conversationId
      ? supabaseAdmin
          .from('chat_conversations')
          .select('id')
          .eq('id', req.conversationId)
          .eq('user_id', who.userId)
          .eq('organization_id', who.organizationId)
          .is('deleted_at', null)
          .maybeSingle()
      : null,
  ]);
  if (pending.error) throw new Error(pending.error.message);
  if ((pending.count ?? 0) >= MAX_PENDING_REQUESTS) return { ok: false, reason: 'too_many' };
  if (sentToday.error) throw new Error(sentToday.error.message);
  if ((sentToday.count ?? 0) >= MAX_REQUESTS_PER_DAY) return { ok: false, reason: 'daily_limit' };

  const toolKey = req.toolKey ?? null;
  const { data, error } = await supabaseAdmin
    .from('chat_access_requests')
    .insert({
      organization_id: who.organizationId,
      requester_id: who.userId,
      // A brand or chat that isn't theirs is dropped, not trusted.
      brand_id: brand?.data ? req.brandId! : null,
      conversation_id: conversation?.data ? req.conversationId! : null,
      asked: req.asked,
      asked_hash: askedHash(toolKey, req.asked),
      tool_key: toolKey,
      rule_kind: req.ruleKind,
      rule_detail: req.ruleDetail,
      drafted_change: (req.draftedChange ?? null) as never,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'already_today' };
    throw new Error(error.message);
  }
  return { ok: true, id: data.id };
}

/**
 * The tool key and drafted change of a Workspace memory line's request
 * (CHAT-14 item 25): only the memory store makes one, and an Admin's
 * approval saves its text as is.
 */
export const MEMORY_REQUEST_TOOL_KEY = 'memorySave';
export const MEMORY_REQUEST_KIND = 'save_memory';

/** A drafted change only the server makes: a request from the browser can't carry one. */
export function isServerDraftedChange(change: unknown): boolean {
  return (
    typeof change === 'object' &&
    change !== null &&
    (change as { kind?: unknown }).kind === MEMORY_REQUEST_KIND
  );
}

/** The line an approved Workspace memory request saves; null for any other request. */
export function draftedMemoryText(toolKey: string | null, change: unknown): string | null {
  if (toolKey !== MEMORY_REQUEST_TOOL_KEY || !isServerDraftedChange(change)) return null;
  const text = (change as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}
