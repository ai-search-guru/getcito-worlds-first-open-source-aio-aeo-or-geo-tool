import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrationsClient';

/**
 * A brand's WordPress connection for Send to CMS (#1331, phase 2; 00294),
 * from the browser through the API's same-origin proxy. The Application
 * Password goes from here to the API once, which checks it with the site
 * and keeps it encrypted: never through a server action, a log or a
 * response.
 */

export interface WordPressConnection {
  status: 'connected' | 'auth_failed';
  siteUrl: string;
  siteName: string | null;
  /** The WordPress user the connection signs in as. */
  account: string;
  connectedAt: string;
  updatedAt: string;
}

export type WordPressError =
  | 'not_configured'
  | 'invalid'
  | 'forbidden'
  | 'not_wordpress'
  | 'no_app_passwords'
  | 'auth_failed'
  | 'header_dropped'
  | 'users_hidden'
  | 'site_refused'
  | 'redirect'
  | 'no_access'
  | 'unreachable'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const KNOWN: readonly WordPressError[] = [
  'not_configured',
  'invalid',
  'forbidden',
  'not_wordpress',
  'no_app_passwords',
  'auth_failed',
  'header_dropped',
  'users_hidden',
  'site_refused',
  'redirect',
  'no_access',
  'unreachable',
];

export type WordPressResult<T> = ({ ok: true } & T) | { ok: false; code: WordPressError };

async function call<T>(brandId: string, init: RequestInit = {}): Promise<WordPressResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/cms/brands/${encodeURIComponent(brandId)}/wordpress`,
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
    console.error('WordPress call failed:', err);
    return { ok: false, code: 'failed' };
  }
}

/** The brand's connection, and whether this server can keep a WordPress sign-in. */
export function readWordPress(brandId: string) {
  return call<{ configured: boolean; connection: WordPressConnection | null }>(brandId, {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** Connects the brand's site, or replaces its sign-in: the API checks it with the site first. */
export function connectWordPress(
  brandId: string,
  input: { siteUrl: string; username: string; password: string },
) {
  return call<{ connection: WordPressConnection }>(brandId, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Disconnects the brand's site; `revoked` says whether its Application Password went too. */
export function disconnectWordPress(brandId: string) {
  return call<{ success: boolean; revoked: boolean }>(brandId, { method: 'DELETE' });
}
