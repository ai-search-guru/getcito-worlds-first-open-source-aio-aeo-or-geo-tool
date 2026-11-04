import { API_BASE_URL } from '@/config/api';
import { chatRunsOnOwnKey } from './key';
import type { OwnKeyGuard } from './ownKeyGuard';

/**
 * The key guard (AGENT-OWN-KEY §4.2): the most all agents may spend on the
 * workspace's own key in a month, $250 unless an Admin set it. Kept by the
 * server (GET /api/internal/chat/budget/own-key); the agent checks read only
 * whether it is reached and when the period renews, never the dollars.
 * Server only (CRON_SECRET).
 */
export interface OwnKeyCap {
  reached: boolean;
  /** When the AI period renews, and the guard with it. */
  renewsAt: string | null;
}

/** How long a read is kept: a fire, its run and a Run now a minute apart read it once. */
export const OWN_KEY_CAP_TTL_MS = 60_000;

/** How long a read waits for the server. */
const OWN_KEY_CAP_TIMEOUT_MS = 3_000;

const cache = new Map<string, { at: number; value: OwnKeyCap }>();

/** For tests: forget the reads kept. */
export function clearOwnKeyCap(): void {
  cache.clear();
}

/** The guard as the server answers it, or null when it didn't. `fresh` skips the kept read. */
export async function readOwnKeyCap(
  organizationId: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<OwnKeyCap | null> {
  const kept = cache.get(organizationId);
  if (!fresh && kept && Date.now() - kept.at < OWN_KEY_CAP_TTL_MS) return kept.value;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/agents] CRON_SECRET must be configured for the key guard');
    return null;
  }
  const query = new URLSearchParams({ orgId: organizationId });
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/budget/own-key?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(OWN_KEY_CAP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      reached?: unknown;
      renewsAt?: unknown;
    } | null;
    if (!body) return null;
    const value: OwnKeyCap = {
      reached: body.reached === true,
      renewsAt: typeof body.renewsAt === 'string' ? body.renewsAt : null,
    };
    cache.set(organizationId, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error('[chat/agents] the key guard got no answer:', (err as Error)?.name ?? err);
    return null;
  }
}

/**
 * The guard with this period's spend, for the Admins' card (PR 9): always
 * read fresh, and only by the settings route, which checks the caller is an
 * Admin. Null when the server didn't answer.
 */
export async function readOwnKeyGuard(organizationId: string): Promise<OwnKeyGuard | null> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/agents] CRON_SECRET must be configured for the key guard');
    return null;
  }
  const query = new URLSearchParams({ orgId: organizationId });
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/budget/own-key?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(OWN_KEY_CAP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      capUsd?: unknown;
      usedUsd?: unknown;
      renewsAt?: unknown;
    } | null;
    const capUsd = Number(body?.capUsd);
    const usedUsd = Number(body?.usedUsd);
    if (!Number.isFinite(capUsd) || !Number.isFinite(usedUsd)) return null;
    return {
      capUsd,
      usedUsd,
      renewsAt: typeof body?.renewsAt === 'string' ? body.renewsAt : null,
    };
  } catch (err) {
    console.error('[chat/agents] the key guard got no answer:', (err as Error)?.name ?? err);
    return null;
  }
}

/** A guard changed on this server: its next read is fresh. */
export function forgetOwnKeyCap(organizationId: string): void {
  cache.delete(organizationId);
}

/**
 * The guard when it is reached and Chat runs on the workspace's own key, else
 * null. Read on a fire, before every run starts and on Run now; a guard that
 * can't be read lets it run: each run stays within its own cap.
 */
export async function ownKeyCapReached(
  organizationId: string,
  options: { fresh?: boolean } = {},
): Promise<OwnKeyCap | null> {
  if (!(await chatRunsOnOwnKey(organizationId))) return null;
  const cap = await readOwnKeyCap(organizationId, options);
  return cap?.reached ? cap : null;
}
