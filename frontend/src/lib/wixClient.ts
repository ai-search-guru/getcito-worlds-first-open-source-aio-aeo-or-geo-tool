import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrationsClient';

/**
 * A brand's Wix connection for Send to CMS (#1331, phase 2; 00372), from the
 * browser through the API's same-origin proxy. The API key goes from here
 * to the API once, which checks it with Wix and keeps it encrypted: never
 * through a server action, a log or a response.
 */

export interface WixConnection {
  status: 'connected' | 'auth_failed';
  siteId: string;
  siteName: string | null;
  connectedAt: string;
  updatedAt: string;
}

export type WixError =
  | 'not_configured'
  | 'invalid'
  | 'forbidden'
  | 'auth_failed'
  | 'no_access'
  | 'no_ricos_permission'
  | 'no_blog'
  | 'no_member'
  | 'unreachable'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const KNOWN: readonly WixError[] = [
  'not_configured',
  'invalid',
  'forbidden',
  'auth_failed',
  'no_access',
  'no_ricos_permission',
  'no_blog',
  'no_member',
  'unreachable',
];

export type WixResult<T> = ({ ok: true } & T) | { ok: false; code: WixError };

async function call<T>(brandId: string, init: RequestInit = {}): Promise<WixResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/cms/brands/${encodeURIComponent(brandId)}/wix`,
      {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const known = KNOWN.find((c) => c === body.code);
      if (known) return { ok: false, code: known };
      const general = apiFailure(res.status, body);
      return {
        ok: false,
        code:
          general === 'session' ||
          general === 'workspace' ||
          general === 'busy' ||
          general === 'subscription'
            ? general
            : 'failed',
      };
    }
    return { ok: true, ...(body as T) };
  } catch (err) {
    console.error('Wix call failed:', err);
    return { ok: false, code: 'failed' };
  }
}

/** The brand's connection, and whether this server can keep a Wix API key. */
export function readWix(brandId: string) {
  return call<{ configured: boolean; connection: WixConnection | null }>(brandId, {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** Connects the brand's site, or replaces its key: the API checks it with Wix first. */
export function connectWix(brandId: string, input: { siteId: string; apiKey: string }) {
  return call<{ connection: WixConnection }>(brandId, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Disconnects the brand's site; its key is deleted with the connection. */
export function disconnectWix(brandId: string) {
  return call<{ success: boolean }>(brandId, { method: 'DELETE' });
}
