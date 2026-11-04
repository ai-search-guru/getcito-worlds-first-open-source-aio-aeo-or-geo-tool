'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';

/**
 * The AI bot report's connections (AT-010): each way a brand sends AI-bot
 * requests from its own Cloudflare or Vercel, read and made through the
 * server (/api/bots/connections). The secret comes back once, with what to
 * copy into Cloudflare or Vercel; only its hash is kept.
 *
 * Errors are returned, not thrown: a thrown error's message is masked in
 * production.
 */

export type BotConnectionKind = 'cloudflare_worker' | 'cloudflare_logpush' | 'vercel_drain';

export interface BotConnection {
  id: string;
  kind: BotConnectionKind;
  createdAt: string;
  /** The last request it sent; null until the first. */
  lastEventAt: string | null;
}

export interface BotUsage {
  /** The month's first day, "2026-10-01". */
  month: string;
  /** Verified rows stored this month. */
  stored: number;
  /** Verified requests counted this month, stored or past the cap. */
  counted: number;
  /** When this month's cap was reached; null while under it. */
  cappedAt: string | null;
  /** Rows a month: -1 no cap, 0 the report is locked (Starter). */
  cap: number;
  /** Log records (Logpush, Vercel drain) received this month, read or not. */
  raw: number;
  /** When this month's raw cap was reached: log files aren't read after it. */
  rawCappedAt: string | null;
  /** Log records a month: -1 no cap, 0 the report is locked. */
  rawCap: number;
  /**
   * No active plan (read-only): both caps read 0, yet the report isn't
   * locked; its connections and stored data still show. Never sent on a plan.
   */
  noPlan?: boolean;
}

export interface BotConnections {
  connections: BotConnection[];
  usage: BotUsage;
}

/** What to copy into Cloudflare or Vercel, with the secret in it once. */
export interface NewBotConnection {
  connection: BotConnection;
  secret: string;
  endpoint: string;
  workerScript: string | null;
  /** The Worker Secret the script reads the connection secret from; null for other senders. */
  workerSecretName: string | null;
  logpushJob: Record<string, unknown> | null;
  vercelDrain: { endpoint: string; format: string; headers: string[]; sources: string[] } | null;
}

type Failure = { error: string; code?: 'plan_limit' };

function connectionOf(row: Record<string, unknown>): BotConnection {
  return {
    id: String(row.id),
    kind: row.kind as BotConnectionKind,
    createdAt: String(row.created_at),
    lastEventAt: typeof row.last_event_at === 'string' ? row.last_event_at : null,
  };
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; status: number; body: Record<string, unknown> } | Failure> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };
  const res = await fetch(`${API_BASE_URL}/api/bots${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      error: String(body.message || body.error || `Server error: ${res.status}`),
      ...(body.error === 'plan_limit' ? { code: 'plan_limit' as const } : {}),
    };
  }
  return { ok: true, status: res.status, body };
}

export async function getBotConnections(brandId: string): Promise<BotConnections | Failure> {
  const res = await call(`/connections/${encodeURIComponent(brandId)}`);
  if ('error' in res) return res;
  const usage = (res.body.usage ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v) || 0;
  return {
    connections: (Array.isArray(res.body.connections) ? res.body.connections : []).map((r) =>
      connectionOf(r as Record<string, unknown>),
    ),
    usage: {
      month: String(usage.month ?? ''),
      stored: n(usage.stored),
      counted: n(usage.counted),
      cappedAt: typeof usage.cappedAt === 'string' ? usage.cappedAt : null,
      cap: Number(usage.cap ?? 0),
      raw: n(usage.raw),
      rawCappedAt: typeof usage.rawCappedAt === 'string' ? usage.rawCappedAt : null,
      rawCap: Number(usage.rawCap ?? 0),
      ...(usage.noPlan === true ? { noPlan: true } : {}),
    },
  };
}

export async function createBotConnection(
  brandId: string,
  kind: BotConnectionKind,
): Promise<NewBotConnection | Failure> {
  const res = await call(`/connections/${encodeURIComponent(brandId)}`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
  if ('error' in res) return res;
  const b = res.body;
  return {
    connection: connectionOf((b.connection ?? {}) as Record<string, unknown>),
    secret: String(b.secret),
    endpoint: String(b.endpoint),
    workerScript: typeof b.workerScript === 'string' ? b.workerScript : null,
    workerSecretName: typeof b.workerSecretName === 'string' ? b.workerSecretName : null,
    logpushJob: (b.logpushJob as Record<string, unknown> | null) ?? null,
    vercelDrain: (b.vercelDrain as NewBotConnection['vercelDrain']) ?? null,
  };
}

export async function revokeBotConnection(
  brandId: string,
  id: string,
): Promise<{ ok: true } | Failure> {
  const res = await call(`/connections/${encodeURIComponent(brandId)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if ('error' in res) return res;
  return { ok: true };
}
