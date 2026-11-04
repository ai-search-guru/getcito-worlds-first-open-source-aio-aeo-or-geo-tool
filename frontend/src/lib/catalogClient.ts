import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrationsClient';
import {
  CATALOG_UPLOAD_MAX_BYTES,
  type CatalogCounts,
  type CatalogFormat,
  type CatalogSyncStatus,
} from '@/lib/catalog';

/**
 * A catalog sync from the browser (#1263), through the API's same-origin
 * proxy: a feed or a store read now, or a file uploaded. Not a server
 * action, whose body is limited to 1 MB. Stores are connected here too
 * (00282): their sign-in goes to the API, which alone keeps it. So is an
 * account of a platform read with the workspace's own sign-in, like Google
 * Merchant Center (#1270): picked from the accounts that sign-in opens.
 */

export type CatalogSyncError =
  | 'recent'
  | 'too_large'
  | 'too_many'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

export type CatalogSyncResult =
  | {
      ok: true;
      /** How the sync went: a feed that can't be read is still an answer. */
      status: CatalogSyncStatus;
      error: string | null;
      counts: CatalogCounts | null;
    }
  | { ok: false; code: CatalogSyncError };

const KNOWN: readonly CatalogSyncError[] = [
  'recent',
  'too_large',
  'too_many',
  'forbidden',
  'not_found',
  'invalid',
];

async function call(path: string, init: RequestInit): Promise<CatalogSyncResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      status?: CatalogSyncStatus;
      error?: string | null;
      counts?: CatalogCounts | null;
    };
    if (!res.ok) {
      if (res.status === 413) return { ok: false, code: 'too_large' };
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
    return {
      ok: true,
      status: body.status ?? 'failed',
      error: body.error ?? null,
      counts: body.counts ?? null,
    };
  } catch (err) {
    console.error('Failed to sync the catalog:', err);
    return { ok: false, code: 'failed' };
  }
}

/** Reads a feed or a store now. */
export function syncCatalogSource(id: string): Promise<CatalogSyncResult> {
  return call(`/sources/${encodeURIComponent(id)}/sync`, { method: 'POST' });
}

/** Imports a file as the brand's upload: up to 4 MB, CSV or a Google feed's XML. */
export async function uploadCatalogFile(
  brandId: string,
  file: File,
  format: CatalogFormat = 'auto',
): Promise<CatalogSyncResult> {
  if (file.size > CATALOG_UPLOAD_MAX_BYTES) return { ok: false, code: 'too_large' };
  const text = await file.text();
  const query = new URLSearchParams({ brandId, format });
  return call(`/upload?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  });
}

/** A field a store's connector asks for, as the API lists it. */
export interface StoreField {
  name: string;
  label: string;
  secret: boolean;
  placeholder: string | null;
  help: string | null;
}

/** A store or marketplace a person can connect (00282): its connector on the API. */
export interface StoreConnector {
  kind: string;
  label: string;
  fields: StoreField[];
}

export type StoreError =
  | 'connect_failed'
  | 'not_connected'
  | 'auth_failed'
  | 'unreachable'
  | 'duplicate'
  | 'too_many'
  | 'other_account'
  | 'not_configured'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

/** `message`: the store's own words for what to fix, when it has them. */
export type StoreResult = { ok: true } | { ok: false; code: StoreError; message: string | null };

const STORE_KNOWN: readonly StoreError[] = [
  'connect_failed',
  'not_connected',
  'auth_failed',
  'unreachable',
  'duplicate',
  'too_many',
  'other_account',
  'not_configured',
  'forbidden',
  'not_found',
  'invalid',
];

/** A store call: the sign-in the person typed goes to the API only, over its proxy. */
async function storeCall(path: string, init: RequestInit): Promise<StoreResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session', message: null };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog${path}`, {
      ...init,
      headers: {
        ...init.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    const known = STORE_KNOWN.find((c) => c === body.code);
    if (known) {
      return {
        ok: false,
        code: known,
        message: known === 'connect_failed' ? (body.error ?? null) : null,
      };
    }
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
      message: null,
    };
  } catch (err) {
    console.error('Failed to reach the catalog API:', err);
    return { ok: false, code: 'failed', message: null };
  }
}

/**
 * A platform read with the workspace's own sign-in (#1270): its Composio
 * provider, connected in Settings › Integrations, and whether this server
 * has that sign-in set up.
 */
export interface SignInConnector {
  kind: string;
  label: string;
  provider: string;
  configured: boolean;
}

/**
 * The stores a person can connect, whether the API can keep a sign-in, and
 * the platforms read with the workspace's sign-in; null when unreadable.
 */
export async function listStoreConnectors(): Promise<{
  connectors: StoreConnector[];
  ready: boolean;
  signIns: SignInConnector[];
} | null> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return null;
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog/connectors`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      connectors?: StoreConnector[];
      ready?: boolean;
      signIns?: SignInConnector[];
    };
    return { connectors: body.connectors ?? [], ready: !!body.ready, signIns: body.signIns ?? [] };
  } catch (err) {
    console.error('Failed to read the store connectors:', err);
    return null;
  }
}

/** Connects a store to a brand with what the person typed; the API reads it right after. */
export function connectStore(
  brandId: string,
  kind: string,
  input: Record<string, string>,
): Promise<StoreResult> {
  return storeCall('/sources', { method: 'POST', body: JSON.stringify({ brandId, kind, input }) });
}

/** Replaces a store's sign-in, for the same store. */
export function updateStoreSignIn(id: string, input: Record<string, string>): Promise<StoreResult> {
  return storeCall(`/sources/${encodeURIComponent(id)}/credentials`, {
    method: 'PUT',
    body: JSON.stringify({ input }),
  });
}

/** Removes a store, its sign-in and its products. */
export function removeStore(id: string): Promise<StoreResult> {
  return storeCall(`/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** An account the workspace's sign-in opens on a platform, to connect to a brand. */
export interface SignInAccount {
  id: string;
  name: string | null;
}

/** The accounts the workspace's sign-in opens on a platform (#1270), for a brand to pick one. */
export async function listSignInAccounts(
  brandId: string,
  kind: string,
): Promise<{ ok: true; accounts: SignInAccount[] } | { ok: false; code: StoreError }> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const query = new URLSearchParams({ brandId, kind });
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog/accounts?${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      accounts?: SignInAccount[];
      code?: string;
    };
    if (res.ok) return { ok: true, accounts: body.accounts ?? [] };
    const known = STORE_KNOWN.find((c) => c === body.code);
    if (known) return { ok: false, code: known };
    const general = apiFailure(res.status, body);
    return {
      ok: false,
      code:
        general === 'session' || general === 'workspace' || general === 'busy' ? general : 'failed',
    };
  } catch (err) {
    console.error('Failed to read the accounts:', err);
    return { ok: false, code: 'failed' };
  }
}

/** Connects the picked account to a brand; the API reads it right after. */
export function connectSignInAccount(
  brandId: string,
  kind: string,
  account: string,
): Promise<StoreResult> {
  return connectStore(brandId, kind, { account });
}

/**
 * A catalog category and its page on the brand's site (shopping path,
 * 00350): `how` says how it was found; 'manual' is a person's decision,
 * a page or none (`page` null), and null is no match.
 */
export interface CategoryPage {
  name: string;
  products: number;
  inStock: number;
  page: { url: string; title: string | null } | null;
  how: 'manual' | 'address' | 'title' | 'words' | null;
}

export type CategoryPageError =
  | 'invalid'
  | 'off_site'
  | 'not_found'
  | 'forbidden'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const CATEGORY_KNOWN: readonly CategoryPageError[] = [
  'invalid',
  'off_site',
  'not_found',
  'forbidden',
];

/**
 * `whenMissing`: what a 404 with no code of ours means, the route not there
 * yet (an API older than the web).
 */
async function categoryCall<T>(
  path: string,
  init: RequestInit,
  read: (body: Record<string, unknown>) => T,
  whenMissing?: T,
): Promise<{ ok: true; value: T } | { ok: false; code: CategoryPageError }> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog${path}`, {
      ...init,
      headers: {
        ...init.headers,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, value: read(body) };
    if (res.status === 404 && body.code === undefined && whenMissing !== undefined) {
      return { ok: true, value: whenMissing };
    }
    const known = CATEGORY_KNOWN.find((c) => c === body.code);
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
  } catch (err) {
    console.error('Failed to reach the catalog API:', err);
    return { ok: false, code: 'failed' };
  }
}

/** The brand's catalog categories and their pages on its site; none while the API has no such route. */
export function listCategoryPages(brandId: string) {
  return categoryCall<CategoryPage[]>(
    `/categories?${new URLSearchParams({ brandId })}`,
    { signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS) },
    (body) => (body.categories as CategoryPage[] | undefined) ?? [],
    [],
  );
}

/** A category's page set by hand (`url`), or set to none (null). */
export function setCategoryPage(brandId: string, category: string, url: string | null) {
  return categoryCall(
    '/categories',
    { method: 'PUT', body: JSON.stringify({ brandId, category, url }) },
    () => true,
  );
}

/** A category back to its automatic match. */
export function resetCategoryPage(brandId: string, category: string) {
  return categoryCall(
    `/categories?${new URLSearchParams({ brandId, category })}`,
    { method: 'DELETE' },
    () => true,
  );
}
