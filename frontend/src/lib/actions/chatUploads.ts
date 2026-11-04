'use server';

import { randomUUID } from 'node:crypto';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  CHAT_UPLOAD_BUCKET,
  MAX_UPLOAD_BYTES,
  SNIFF_BYTES,
  contentMatchesType,
  isUploadType,
  type ChatUploadType,
} from '@/lib/chat/uploads';

/**
 * Chat's attachments (CHAT-02 items 18–22, 00409), behind CHAT_AGENTIC. The
 * app checks, not the bucket's policies (members have none on it): a
 * signed-in member of a workspace with Chat on and an active plan attaches
 * a file of a listed type up to 10 MB. Its row is written first (pending),
 * then the browser sends the file itself to a one-time address (no server
 * action's body limit), and finishChatUpload marks it ready once it is
 * there. The run's start links it to its message (startChatRun). Every
 * action answers { ok } and never throws (#1777).
 */

export type ChatUploadFailure =
  | 'session'
  | 'chat_off'
  | 'read_only'
  | 'type'
  | 'size'
  | 'not_found'
  | 'failed';

export interface ChatUploadTicket {
  id: string;
  /** The object in chat-uploads, and the one-time token to send it with. */
  path: string;
  token: string;
}

/** The person, their workspace, and whether Chat is on for it: null without a session. */
async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id ?? null;
  return { supabase, userId: user.id, organizationId };
}

/**
 * A one-time address for one file. `conversationId` is the chat it goes
 * with; none for a new chat's draft.
 */
export async function prepareChatUpload(input: {
  name: string;
  type: string;
  size: number;
  conversationId?: string | null;
}): Promise<{ ok: true; ticket: ChatUploadTicket } | { ok: false; failure: ChatUploadFailure }> {
  try {
    const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 255) : '';
    if (!name || !isUploadType(input.type)) return { ok: false, failure: 'type' };
    const size = Number(input.size);
    if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
      return { ok: false, failure: 'size' };
    }
    const me = await member();
    if (!me) return { ok: false, failure: 'session' };
    if (!me.organizationId || !chatAgenticEnabled(me.organizationId)) {
      return { ok: false, failure: 'chat_off' };
    }
    if (isCloud()) {
      const { data: org } = await me.supabase
        .from('organizations')
        .select('subscription_status')
        .eq('id', me.organizationId)
        .maybeSingle();
      if (!isSubscriptionActive(org?.subscription_status))
        return { ok: false, failure: 'read_only' };
    }
    const conversationId = input.conversationId ?? null;
    if (conversationId) {
      // Their own chat (RLS reads it only for them, or a shared one).
      const { data: chat } = await me.supabase
        .from('chat_conversations')
        .select('id, user_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (!chat || chat.user_id !== me.userId) return { ok: false, failure: 'not_found' };
    }

    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const id = randomUUID();
    const path = `${me.organizationId}/${id}`;
    const { error: rowError } = await supabaseAdmin.from('chat_uploads').insert({
      id,
      organization_id: me.organizationId,
      user_id: me.userId,
      conversation_id: conversationId,
      name,
      mime_type: input.type as ChatUploadType,
      size_bytes: size,
      storage_path: path,
    });
    if (rowError) {
      console.error('[chat-uploads] could not keep the attachment:', rowError.message);
      return { ok: false, failure: 'failed' };
    }
    const { data, error } = await supabaseAdmin.storage
      .from(CHAT_UPLOAD_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[chat-uploads] could not prepare the upload:', error?.message);
      await supabaseAdmin.from('chat_uploads').delete().eq('id', id);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true, ticket: { id, path: data.path, token: data.token } };
  } catch (error) {
    console.error('[chat-uploads] prepare failed:', error);
    return { ok: false, failure: 'failed' };
  }
}

/** The person's own attachment, still in a draft (not sent with a message). */
async function ownDraft(id: string) {
  const me = await member();
  if (!me) return { me: null, row: null };
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { data } = await supabaseAdmin
    .from('chat_uploads')
    .select('id, storage_path, status, size_bytes, mime_type')
    .eq('id', id)
    .eq('user_id', me.userId)
    .is('message_id', null)
    .maybeSingle();
  return { me, row: data, supabaseAdmin };
}

/** What firstBytes needs of the bucket: a short-lived address to read from. */
interface SignsUrls {
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
}

/** How long the server waits for a file's first bytes. */
const SNIFF_TIMEOUT_MS = 10_000;

/** The first SNIFF_BYTES of an object in chat-uploads, or null when they can't be read. */
async function firstBytes(bucket: SignsUrls, path: string): Promise<Uint8Array | null> {
  const { data, error } = await bucket.createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  const res = await fetch(data.signedUrl, {
    headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
    signal: AbortSignal.timeout(SNIFF_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok || !res.body) return null;
  // A server that ignores Range sends the whole file: read only the start.
  const reader = res.body.getReader();
  const head = new Uint8Array(SNIFF_BYTES);
  let got = 0;
  while (got < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const take = Math.min(value.length, SNIFF_BYTES - got);
    head.set(value.subarray(0, take), got);
    got += take;
  }
  await reader.cancel().catch(() => null);
  return head.subarray(0, got);
}

/**
 * The file arrived: ready for a message once the object is there with the
 * type it was prepared for, at most 10 MB, and its first bytes are that
 * type's; else failed, and a file that isn't what it said goes at once.
 */
export async function finishChatUpload(
  id: string,
): Promise<{ ok: true } | { ok: false; failure: ChatUploadFailure }> {
  try {
    const { me, row, supabaseAdmin } = await ownDraft(id);
    if (!me) return { ok: false, failure: 'session' };
    if (!row || !supabaseAdmin) return { ok: false, failure: 'not_found' };
    const bucket = supabaseAdmin.storage.from(CHAT_UPLOAD_BUCKET);
    const [folder, name] = row.storage_path.split('/');
    const { data: found, error } = await bucket.list(folder, { search: name, limit: 1 });
    const object = error ? undefined : (found ?? []).find((file) => file.name === name);
    let size: number | null = null;
    let ready = false;
    if (object) {
      const meta = (object.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
      size = typeof meta.size === 'number' ? meta.size : null;
      const fits = size !== null && Number.isInteger(size) && size >= 1 && size <= MAX_UPLOAD_BYTES;
      const type = row.mime_type as ChatUploadType;
      if (fits && meta.mimetype === type && isUploadType(type)) {
        const head = await firstBytes(bucket, row.storage_path).catch(() => null);
        ready = head !== null && contentMatchesType(type, head);
      }
      // Not what it said it is: it doesn't wait 90 days for the sweep.
      if (!ready) await bucket.remove([row.storage_path]).catch(() => null);
    }
    await supabaseAdmin
      .from('chat_uploads')
      .update(ready && size !== null ? { status: 'ready', size_bytes: size } : { status: 'failed' })
      .eq('id', id);
    return ready ? { ok: true } : { ok: false, failure: 'failed' };
  } catch (error) {
    console.error('[chat-uploads] finish failed:', error);
    return { ok: false, failure: 'failed' };
  }
}

/** × on a draft's file: its row and its file go. */
export async function removeChatUpload(
  id: string,
): Promise<{ ok: true } | { ok: false; failure: ChatUploadFailure }> {
  try {
    const { me, row, supabaseAdmin } = await ownDraft(id);
    if (!me) return { ok: false, failure: 'session' };
    if (!row || !supabaseAdmin) return { ok: false, failure: 'not_found' };
    await supabaseAdmin.storage.from(CHAT_UPLOAD_BUCKET).remove([row.storage_path]);
    const { error } = await supabaseAdmin.from('chat_uploads').delete().eq('id', id);
    return error ? { ok: false, failure: 'failed' } : { ok: true };
  } catch (error) {
    console.error('[chat-uploads] remove failed:', error);
    return { ok: false, failure: 'failed' };
  }
}
