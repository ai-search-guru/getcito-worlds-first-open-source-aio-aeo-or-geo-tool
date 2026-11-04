import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';

/**
 * AI Traffic's Check again: the server reads the brand's home page for its
 * tracking snippet and keeps what it found (server
 * lib/trackingSnippetCheck.js, 00433). From the browser through the API's
 * same-origin proxy, as Settings › Integrations' reads are.
 */

export type SnippetCheckStatus = 'found' | 'not_found' | 'no_domain' | 'unreachable';

export type SnippetCheckResult =
  | { ok: true; status: SnippetCheckStatus; domain: string | null; checkedAt: string | null }
  | { ok: false };

const STATUSES: readonly SnippetCheckStatus[] = ['found', 'not_found', 'no_domain', 'unreachable'];

/** A check gives up after this: one home page read, at most 10 s a try. */
const CHECK_TIMEOUT_MS = 30_000;

export async function checkTrackingSnippet(brandId: string): Promise<SnippetCheckResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/brands/${encodeURIComponent(brandId)}/tracking-snippet/check`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      },
    );
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as Record<string, unknown>;
    const status = STATUSES.find((s) => s === body.status);
    if (!status) return { ok: false };
    return {
      ok: true,
      status,
      domain: typeof body.domain === 'string' ? body.domain : null,
      checkedAt: typeof body.checkedAt === 'string' ? body.checkedAt : null,
    };
  } catch {
    return { ok: false };
  }
}
