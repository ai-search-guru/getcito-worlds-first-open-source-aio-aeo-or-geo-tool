import { BROWSER_API_BASE_URL } from '@/config/api';
import { isSubscriptionInactive } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import type {
  GaProperty,
  GscProperty,
  IntegrationProvider,
  IntegrationStatus,
} from '@/lib/actions/integrations';

/**
 * Settings › Integrations' Google reads and Connect, from the browser through
 * the API's same-origin proxy: never through a server action, which Next runs
 * one at a time. Each card's status is a Composio round trip, so a slow one
 * left the cards after it on their skeletons, and Connect, queued behind them
 * all, seemed to do nothing. Each call here runs on its own and gives up
 * after its timeout, so a card says it couldn't be read rather than wait.
 */

/** A read that hangs gives up after this: a status is one Composio round trip (~450 ms). */
export const INTEGRATION_READ_TIMEOUT_MS = 10_000;
/** Connect (the sign-in address Composio makes) and the properties Google lists wait longer. */
const GOOGLE_CALL_TIMEOUT_MS = 20_000;

/**
 * Why a call came back without its answer: it took too long, the person's
 * role can't do it, the workspace is read-only (the upgrade dialog, not a
 * message), or anything else, with the API's own words when it gave them.
 */
export type IntegrationFailure = 'timeout' | 'forbidden' | 'subscription' | 'failed';
export type IntegrationResult<T> =
  { ok: true; value: T } | { ok: false; reason: IntegrationFailure; error?: string };

/** Which integrations this server has credentials for: env only, no Composio round trip. */
export interface IntegrationsConfig {
  googleSearchConsole: boolean;
  googleAnalytics: boolean;
  googleMerchantCenter: boolean;
  dataForSeo: boolean;
}

/** A call given up on after its timeout: AbortSignal.timeout's TimeoutError, or withReadTimeout's. */
export function isTimeout(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError'
  );
}

async function call<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  read: (body: Record<string, unknown>) => T | undefined,
): Promise<IntegrationResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, reason: 'failed' };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/integrations${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const value = res.ok ? read(body) : undefined;
    if (value !== undefined) return { ok: true, value };
    if (isSubscriptionInactive(body)) return { ok: false, reason: 'subscription' };
    if (res.status === 403) return { ok: false, reason: 'forbidden' };
    console.error(`Integration call ${path} failed:`, res.status, body.error);
    return {
      ok: false,
      reason: 'failed',
      ...(typeof body.error === 'string' ? { error: body.error } : {}),
    };
  } catch (err) {
    if (isTimeout(err)) return { ok: false, reason: 'timeout' };
    console.error(`Integration call ${path} failed:`, err);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * The server's integrations config, or null when it can't be read: an API
 * older than the web (404), or one that is down. Null offers nothing.
 */
export async function readIntegrationsConfig(): Promise<IntegrationsConfig | null> {
  const result = await call(
    '/config',
    {},
    INTEGRATION_READ_TIMEOUT_MS,
    (body) => body as unknown as IntegrationsConfig,
  );
  return result.ok ? result.value : null;
}

const STATUSES: readonly IntegrationStatus[] = ['not_configured', 'not_connected', 'connected'];

/** A provider's live status, which the API checks with Composio. */
export function readIntegrationStatus(
  provider: IntegrationProvider,
): Promise<IntegrationResult<IntegrationStatus>> {
  return call(`/${provider}/status`, {}, INTEGRATION_READ_TIMEOUT_MS, (body) =>
    STATUSES.find((s) => s === body.status),
  );
}

/** Starts the provider's OAuth: the address to open, where the person signs in with Google. */
export function startIntegrationConnect(
  provider: IntegrationProvider,
  callbackUrl: string,
): Promise<IntegrationResult<string>> {
  return call(
    `/${provider}/connect`,
    { method: 'POST', body: JSON.stringify({ callbackUrl }) },
    GOOGLE_CALL_TIMEOUT_MS,
    (body) => (typeof body.redirectUrl === 'string' ? body.redirectUrl : undefined),
  );
}

/** The Search Console properties the connected Google account opens. */
export function readGscProperties(): Promise<IntegrationResult<GscProperty[]>> {
  return call('/google-search-console/properties', {}, GOOGLE_CALL_TIMEOUT_MS, (body) =>
    Array.isArray(body.properties) ? (body.properties as GscProperty[]) : [],
  );
}

/** The GA4 properties the connected Google account opens. */
export function readGaProperties(): Promise<IntegrationResult<GaProperty[]>> {
  return call('/google-analytics/properties', {}, GOOGLE_CALL_TIMEOUT_MS, (body) =>
    Array.isArray(body.properties) ? (body.properties as GaProperty[]) : [],
  );
}

/**
 * A server action's answer, or a TimeoutError once it's taken longer than a
 * read should. A server action can't be called off: this only stops waiting
 * for it, so a card can say it couldn't be read instead of a lasting skeleton.
 */
export function withReadTimeout<T>(
  promise: Promise<T>,
  ms: number = INTEGRATION_READ_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('The read took too long.');
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
