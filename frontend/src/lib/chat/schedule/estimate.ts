import { API_BASE_URL } from '@/config/api';
import { chatRunsOnOwnKey } from '../key';

/**
 * About how much of the monthly AI limit one run of a scheduled job uses,
 * for its card (CHAT-12 item 7: "≈ 2% of monthly AI usage per run"): the
 * server's average of the workspace's Chat runs over the last 30 days
 * (GET /api/internal/chat/budget/run-estimate), as a share. On the
 * workspace's own key a run doesn't draw on the limit: `own_key`. Never
 * throws: a read that fails is `unknown`, and the card says the run uses
 * the limit without a figure. Kept 5 minutes a workspace. Server only
 * (CRON_SECRET).
 */

export type RunEstimate =
  | { kind: 'share'; share: number }
  | { kind: 'own_key' }
  | { kind: 'unlimited' }
  | { kind: 'unknown' };

export const RUN_ESTIMATE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 3_000;

const cache = new Map<string, { at: number; value: RunEstimate }>();

/** Forget what was read (tests). */
export function clearRunEstimates(): void {
  cache.clear();
}

async function serverEstimate(organizationId: string): Promise<RunEstimate> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/schedules] CRON_SECRET must be configured for run estimates');
    return { kind: 'unknown' };
  }
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/internal/chat/budget/run-estimate?${new URLSearchParams({ orgId: organizationId })}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return { kind: 'unknown' };
    const body = (await res.json().catch(() => null)) as {
      unlimited?: unknown;
      share?: unknown;
    } | null;
    if (body?.unlimited === true) return { kind: 'unlimited' };
    const share = body?.share;
    return typeof share === 'number' && Number.isFinite(share) && share >= 0
      ? { kind: 'share', share }
      : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

/** The workspace's run estimate (above). */
export async function readRunEstimate(organizationId: string): Promise<RunEstimate> {
  const kept = cache.get(organizationId);
  if (kept && Date.now() - kept.at < RUN_ESTIMATE_TTL_MS) return kept.value;
  const value = (await chatRunsOnOwnKey(organizationId).catch(() => false))
    ? ({ kind: 'own_key' } as const)
    : await serverEstimate(organizationId);
  if (value.kind !== 'unknown') cache.set(organizationId, { at: Date.now(), value });
  return value;
}
