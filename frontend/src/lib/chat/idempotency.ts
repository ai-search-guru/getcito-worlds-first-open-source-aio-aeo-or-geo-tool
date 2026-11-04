import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';

/**
 * A change Chat makes runs once per key (CHAT-20 §11c): a double-clicked
 * approval, a reconnect or a retry (§11b) gets the first call's result back
 * and makes nothing new. Keys live 24 hours per workspace in
 * chat_idempotency_keys (00402), written with the service role. Server only.
 *
 * A key is claimed before the change runs (the table's primary key lets one
 * call claim it), so of two calls at once one makes the change and the other
 * waits for its result. A call that fails gives its key back: nothing was
 * made, and a retry with the key runs again. A claim left by a server that
 * stopped mid-change is taken over after STALE_CLAIM_MS.
 *
 * Chat's key is the approval's: its tool's label key and the run step that
 * asks for the change (the card the person clicks, or the step that ran it
 * without one), so one approval makes one change. What the key was claimed
 * for is kept too (requestHash: the tool and its input), and the same key
 * with another request is an approval mismatch (§11a), never the old result.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A claim this old whose change never finished is taken over. */
export const STALE_CLAIM_MS = 5 * 60 * 1000;
/** How long a repeat waits for the first call to finish, and how often it looks. */
const WAIT_MS = 15_000;
const POLL_MS = 250;
/** Claims tried before giving up, when keys keep expiring or freeing meanwhile. */
const CLAIM_ATTEMPTS = 3;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** JSON with object keys sorted at every level, so equal values write equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

/**
 * A key: what it is for (a tool's label key, or `undo`) and the parts that
 * make it one approval (the run step), hashed: `saveDraft:{sha-256}`.
 */
export function idempotencyKey(scope: string, parts: readonly string[]): string {
  if (!/^[a-z][A-Za-z0-9]{1,63}$/.test(scope)) throw new Error(`Not a key scope: ${scope}`);
  if (parts.length === 0 || parts.some((part) => part === '')) {
    throw new Error('A key needs the approval it is for');
  }
  return `${scope}:${sha256(JSON.stringify(parts))}`;
}

/** What a key is claimed for: the tool, by label key, and its input. */
export function requestHash(toolKey: string, input: unknown): string {
  return sha256(canonicalJson([toolKey, input ?? null]));
}

export interface IdempotentRequest {
  organizationId: string;
  key: string;
  requestHash: string;
}

/** What the change returns: its result (kept as JSON) and the log row it wrote. */
export interface IdempotentWork<T extends Json> {
  result: T;
  activityId: string | null;
}

export type IdempotentOutcome<T extends Json> =
  /** This call made the change. */
  | ({ kind: 'ran' } & IdempotentWork<T>)
  /** A call before it with the key did: its result, nothing new made. */
  | ({ kind: 'repeat' } & IdempotentWork<T>)
  /** The key was claimed for another request: approval_mismatch (§11a). */
  | { kind: 'mismatch' }
  /** The first call is still running after the wait. */
  | { kind: 'busy' };

export interface IdempotencyOptions<T extends Json> {
  /** Keep this result for repeats; otherwise the key goes back, as after a failure. Default: keep. */
  keep?: (result: T) => boolean;
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface KeyRow {
  request_hash: string;
  status: string;
  result_json: Json | null;
  activity_id: string | null;
  created_at: string;
  expires_at: string;
}

const KEY_COLUMNS = 'request_hash, status, result_json, activity_id, created_at, expires_at';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function keys() {
  return supabaseAdmin.from('chat_idempotency_keys');
}

async function readKey(req: IdempotentRequest): Promise<KeyRow | null> {
  const { data, error } = await keys()
    .select(KEY_COLUMNS)
    .eq('organization_id', req.organizationId)
    .eq('key', req.key)
    .maybeSingle();
  if (error) throw new Error(`Could not read an idempotency key: ${error.message}`);
  return data as KeyRow | null;
}

/** A key past its 24 hours, or a claim whose change stopped: free to take. */
function isFree(row: KeyRow, now: number): boolean {
  return (
    Date.parse(row.expires_at) <= now ||
    (row.status === 'pending' && Date.parse(row.created_at) <= now - STALE_CLAIM_MS)
  );
}

/** Claims the key, or returns the row that holds it. */
async function claim(req: IdempotentRequest): Promise<'claimed' | KeyRow> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const { error } = await keys().insert({
      organization_id: req.organizationId,
      key: req.key,
      request_hash: req.requestHash,
      status: 'pending',
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    });
    if (!error) return 'claimed';
    if (error.code !== '23505')
      throw new Error(`Could not claim an idempotency key: ${error.message}`);
    const row = await readKey(req);
    if (!row) continue; // Given back meanwhile: claim again.
    if (!isFree(row, Date.now())) return row;
    // Only the row that was read: another call may have taken it over already.
    const { error: freeError } = await keys()
      .delete()
      .eq('organization_id', req.organizationId)
      .eq('key', req.key)
      .eq('created_at', row.created_at);
    if (freeError) throw new Error(`Could not free an idempotency key: ${freeError.message}`);
  }
  throw new Error('Could not claim an idempotency key');
}

/** Gives a claimed key back: its change failed, or made nothing to keep. */
async function release(req: IdempotentRequest): Promise<void> {
  const { error } = await keys()
    .delete()
    .eq('organization_id', req.organizationId)
    .eq('key', req.key)
    .eq('status', 'pending');
  if (error) console.error('Could not give an idempotency key back:', error.message);
}

function settled<T extends Json>(row: KeyRow): IdempotentOutcome<T> {
  return { kind: 'repeat', result: row.result_json as T, activityId: row.activity_id };
}

/**
 * Runs `work` once for the key. A repeat gets the first result; a call made
 * while the first still runs waits for it (up to WAIT_MS), and runs itself
 * if the first failed and gave the key back.
 */
export async function withIdempotencyKey<T extends Json>(
  req: IdempotentRequest,
  work: () => Promise<IdempotentWork<T>>,
  options: IdempotencyOptions<T> = {},
): Promise<IdempotentOutcome<T>> {
  const { keep = () => true, waitMs = WAIT_MS, pollMs = POLL_MS, sleep = wait } = options;
  const deadline = Date.now() + waitMs;

  for (;;) {
    const held = await claim(req);
    if (held === 'claimed') break;
    if (held.request_hash !== req.requestHash) return { kind: 'mismatch' };
    if (held.status === 'done') return settled(held);
    // The first call is still running: wait for its result.
    let row: KeyRow | null = held;
    while (row?.status === 'pending' && Date.now() < deadline && !isFree(row, Date.now())) {
      await sleep(pollMs);
      row = await readKey(req);
    }
    if (row?.status === 'done') {
      return row.request_hash === req.requestHash ? settled(row) : { kind: 'mismatch' };
    }
    if (row && !isFree(row, Date.now())) return { kind: 'busy' };
    // Given back or stale: claim it for this call.
  }

  let done: IdempotentWork<T>;
  try {
    done = await work();
  } catch (err) {
    await release(req);
    throw err;
  }
  if (!keep(done.result)) {
    await release(req);
    return { kind: 'ran', ...done };
  }
  const { error } = await keys()
    .update({ status: 'done', result_json: done.result, activity_id: done.activityId })
    .eq('organization_id', req.organizationId)
    .eq('key', req.key);
  // The change is made: a key that can't be closed is logged, never a second change.
  if (error) console.error('Could not keep an idempotency key’s result:', error.message);
  return { kind: 'ran', ...done };
}

/** Removes the workspace's keys past their 24 hours. */
export async function sweepExpiredKeys(organizationId: string): Promise<void> {
  const { error } = await keys()
    .delete()
    .eq('organization_id', organizationId)
    .lt('expires_at', new Date().toISOString());
  if (error) console.error('Could not sweep idempotency keys:', error.message);
}
