import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrationsClient';

/**
 * A brand's Webflow connection for Send to CMS (#1331, phase 2), from the
 * browser through the API's same-origin proxy. The site token goes from
 * here to the API once, which hands it to Composio: never through a server
 * action, a log or a response.
 */

/** The parts of a page a field map places. */
export const WEBFLOW_PARTS = [
  'body',
  'metaTitle',
  'metaDescription',
  'jsonLd',
  'reviewer',
  'date',
] as const;
export type WebflowPart = (typeof WEBFLOW_PARTS)[number];
export type WebflowFieldMap = Partial<Record<WebflowPart, string>>;
/** The Webflow field types each part may go to. */
export const WEBFLOW_PART_TYPES: Record<WebflowPart, string> = {
  body: 'RichText',
  metaTitle: 'PlainText',
  metaDescription: 'PlainText',
  jsonLd: 'PlainText',
  reviewer: 'PlainText',
  date: 'DateTime',
};

export interface WebflowConnection {
  status: 'connected' | 'auth_failed';
  siteId: string | null;
  siteName: string | null;
  collectionId: string | null;
  collectionName: string | null;
  fieldMap: WebflowFieldMap;
  connectedAt: string;
  updatedAt: string;
}
export interface WebflowSite {
  id: string;
  name: string;
}
export interface WebflowCollection {
  id: string;
  name: string;
  slug: string;
}
export interface WebflowField {
  slug: string;
  name: string;
  type: string;
  required: boolean;
}

export type WebflowError =
  | 'not_configured'
  | 'invalid'
  | 'forbidden'
  | 'not_connected'
  | 'auth_failed'
  | 'missing_scopes'
  | 'no_access'
  | 'no_site'
  | 'not_found'
  | 'invalid_map'
  | 'changed'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const KNOWN: readonly WebflowError[] = [
  'not_configured',
  'invalid',
  'forbidden',
  'not_connected',
  'auth_failed',
  'missing_scopes',
  'no_access',
  'no_site',
  'not_found',
  'invalid_map',
  'changed',
];

export type WebflowResult<T> =
  ({ ok: true } & T) | { ok: false; code: WebflowError; problems?: string[] };

async function call<T>(
  brandId: string,
  path: string,
  init: RequestInit = {},
): Promise<WebflowResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/cms/brands/${encodeURIComponent(brandId)}/webflow${path}`,
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
      const problems = Array.isArray(body.problems)
        ? body.problems.filter((p): p is string => typeof p === 'string')
        : undefined;
      if (known) return { ok: false, code: known, ...(problems ? { problems } : {}) };
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
    console.error('Webflow call failed:', err);
    return { ok: false, code: 'failed' };
  }
}

/** The brand's connection, and whether this server has Webflow set up. */
export function readWebflow(brandId: string) {
  return call<{ configured: boolean; connection: WebflowConnection | null }>(brandId, '', {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** Connects the brand's site with its token, or replaces the token. */
export function connectWebflow(brandId: string, token: string) {
  return call<{ connection: WebflowConnection; sites: WebflowSite[] }>(brandId, '', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/** The sites the token reaches, and the collections of one (the connection's unless named). */
export function listWebflowCollections(brandId: string, siteId?: string | null) {
  const query = siteId ? `?${new URLSearchParams({ siteId })}` : '';
  return call<{ sites: WebflowSite[]; siteId: string | null; collections: WebflowCollection[] }>(
    brandId,
    `/collections${query}`,
  );
}

/** A collection's fields, and the map they suggest. */
export function readWebflowCollection(
  brandId: string,
  collectionId: string,
  siteId?: string | null,
) {
  const query = siteId ? `?${new URLSearchParams({ siteId })}` : '';
  return call<{ id: string; name: string; fields: WebflowField[]; suggested: WebflowFieldMap }>(
    brandId,
    `/collections/${encodeURIComponent(collectionId)}${query}`,
  );
}

/** Where the brand's pages go: the site, the collection and the field map. */
export function saveWebflowSettings(
  brandId: string,
  settings: { siteId: string; collectionId: string; fieldMap: WebflowFieldMap },
) {
  return call<{ connection: WebflowConnection }>(brandId, '', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

/** Disconnects the brand's Webflow site: Composio lets go of the token. */
export function disconnectWebflow(brandId: string) {
  return call<{ success: boolean }>(brandId, '', { method: 'DELETE' });
}
