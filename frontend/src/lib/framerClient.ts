import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrationsClient';

/**
 * A brand's Framer connection for Send to CMS (#1331, phase 2; 00295), from
 * the browser through the API's same-origin proxy. The API key goes from
 * here to the API once, which checks it with Framer and keeps it encrypted:
 * never through a server action, a log or a response.
 */

/** The parts of a page a field map places: a page's title and body always. */
export const FRAMER_PARTS = [
  'title',
  'body',
  'metaTitle',
  'metaDescription',
  'jsonLd',
  'reviewer',
] as const;
export type FramerPart = (typeof FRAMER_PARTS)[number];
export type FramerFieldMap = Partial<Record<FramerPart, string>>;
/** The Framer field type each part may go to (backend/src/lib/cms/framer.js). */
export const FRAMER_PART_TYPES: Record<FramerPart, string> = {
  title: 'string',
  body: 'formattedText',
  metaTitle: 'string',
  metaDescription: 'string',
  jsonLd: 'string',
  reviewer: 'string',
};
/** The parts every map places. */
export const FRAMER_NEEDED: readonly FramerPart[] = ['title', 'body'];
/**
 * The parts every page has, so a field the collection requires may take
 * one: a page's meta title falls back to its title, its meta description to
 * its opening words. A page may have no JSON-LD.
 */
const ALWAYS_FILLED: readonly FramerPart[] = ['title', 'body', 'metaTitle', 'metaDescription'];
const FILLABLE_TYPES = new Set(ALWAYS_FILLED.map((part) => FRAMER_PART_TYPES[part]));

export interface FramerConnection {
  status: 'connected' | 'auth_failed';
  projectId: string;
  projectName: string | null;
  /** The project's published address, when it has one. */
  siteUrl: string | null;
  /** The Framer user the key acts as. */
  account: string | null;
  collectionId: string | null;
  collectionName: string | null;
  fieldMap: FramerFieldMap;
  connectedAt: string;
  updatedAt: string;
}
export interface FramerField {
  id: string;
  name: string;
  /** Framer's own type: 'string', 'formattedText', 'image', 'date'… */
  type: string;
  required: boolean;
}
export interface FramerCollection {
  id: string;
  name: string;
  /** The field its items' slugs are made from: the one a page's title suits. */
  titleField: string | null;
  fields: FramerField[];
}

export type FramerError =
  | 'not_configured'
  | 'invalid'
  | 'forbidden'
  | 'not_connected'
  | 'auth_failed'
  | 'no_access'
  | 'not_found'
  | 'invalid_map'
  | 'changed'
  | 'busy'
  | 'unreachable'
  | 'session'
  | 'workspace'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const KNOWN: readonly FramerError[] = [
  'not_configured',
  'invalid',
  'forbidden',
  'not_connected',
  'auth_failed',
  'no_access',
  'not_found',
  'invalid_map',
  'changed',
  'busy',
  'unreachable',
];

export type FramerResult<T> =
  ({ ok: true } & T) | { ok: false; code: FramerError; problems?: string[] };

async function call<T>(
  brandId: string,
  path: string,
  init: RequestInit = {},
): Promise<FramerResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/cms/brands/${encodeURIComponent(brandId)}/framer${path}`,
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
    console.error('Framer call failed:', err);
    return { ok: false, code: 'failed' };
  }
}

/** The brand's connection, and whether this server can keep a Framer key. */
export function readFramer(brandId: string) {
  return call<{ configured: boolean; connection: FramerConnection | null }>(brandId, '', {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/**
 * Connects the brand's project (its address or id) with an API key made in
 * it, or replaces the key: the API checks them with Framer first.
 */
export function connectFramer(brandId: string, input: { project: string; apiKey: string }) {
  return call<{ connection: FramerConnection }>(brandId, '', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The project's collections pages may go to, with their fields. */
export function readFramerCollections(brandId: string) {
  return call<{ collections: FramerCollection[] }>(brandId, '/collections');
}

/** Where the brand's pages go: the collection, and which of its fields takes each part. */
export function saveFramerTarget(
  brandId: string,
  target: { collectionId: string; fieldMap: FramerFieldMap },
) {
  return call<{ connection: FramerConnection }>(brandId, '', {
    method: 'PUT',
    body: JSON.stringify(target),
  });
}

/** Disconnects the brand's project; `revoked` is false, as Framer can't revoke a key. */
export function disconnectFramer(brandId: string) {
  return call<{ success: boolean; revoked: boolean }>(brandId, '', { method: 'DELETE' });
}

/** The words a field's name is read for, by part: the first field that has them is suggested. */
const HINTS: Record<FramerPart, RegExp[]> = {
  // Whole names only: "SEO Title" is a meta title's.
  title: [/^((post|page|article|blog)-)?(title|name)$/, /^(heading|headline)$/],
  body: [/(^|-)(post-)?body($|-)/, /content/, /article/, /rich/],
  metaTitle: [/(meta|seo)-?title/],
  metaDescription: [/(meta|seo)-?desc/, /summary/, /excerpt/, /description/],
  jsonLd: [/json-?ld/, /schema/, /structured/],
  reviewer: [/reviewed?-?by/, /reviewer/],
};

/**
 * The field map a collection suggests, as Webflow's does (server
 * suggestFieldMap): for each part, the first field of its type whose name
 * reads as that part, one field a part. A page's title goes first to the
 * field the slugs are made from; its body falls back to the first
 * formatted text.
 */
export function suggestFramerMap(collection: FramerCollection): FramerFieldMap {
  const map: FramerFieldMap = {};
  const taken = new Set<string>();
  const words = (f: FramerField) => f.name.trim().toLowerCase().replace(/\s+/g, '-');
  for (const part of FRAMER_PARTS) {
    const fits = collection.fields.filter(
      (f) => f.type === FRAMER_PART_TYPES[part] && !taken.has(f.id),
    );
    let pick = part === 'title' ? fits.find((f) => f.id === collection.titleField) : undefined;
    for (const hint of HINTS[part]) {
      if (pick) break;
      pick = fits.find((f) => hint.test(words(f)));
    }
    if (!pick && part === 'body') pick = fits[0];
    if (pick) {
      map[part] = pick.id;
      taken.add(pick.id);
    }
  }
  return map;
}

/** The parts of a map whose field is still one of that part's choices, each field once. */
export function fittingFramerMap(map: FramerFieldMap, fields: FramerField[]): FramerFieldMap {
  const kept: FramerFieldMap = {};
  const used = new Set<string>();
  for (const part of FRAMER_PARTS) {
    const id = map[part];
    const field = fields.find((f) => f.id === id);
    if (!id || !field || field.type !== FRAMER_PART_TYPES[part] || used.has(id)) continue;
    kept[part] = id;
    used.add(id);
  }
  return kept;
}

/**
 * The fields a collection requires that Send to CMS can't fill whatever the
 * map: of a type no part a page always has can go to (an image, a date…).
 * The API refuses such a collection until they're optional in Framer.
 */
export function unfillableFramerFields(collection: FramerCollection): FramerField[] {
  return collection.fields.filter((f) => f.required && !FILLABLE_TYPES.has(f.type));
}

/**
 * The parts every map places that the collection has no field for (no
 * formatted text for a page's body, say): pages can't go to it until one is
 * added in Framer.
 */
export function missingFramerParts(collection: FramerCollection): FramerPart[] {
  return FRAMER_NEEDED.filter(
    (part) => !collection.fields.some((f) => f.type === FRAMER_PART_TYPES[part]),
  );
}

/**
 * The fields a collection requires that Send to CMS could fill but the map
 * leaves to no part a page always has: the API refuses the map until each
 * takes one (JSON-LD doesn't count, as a page may have none).
 */
export function unmappedFramerFields(map: FramerFieldMap, fields: FramerField[]): FramerField[] {
  const filled = new Set(ALWAYS_FILLED.map((part) => map[part]).filter(Boolean));
  return fields.filter((f) => f.required && FILLABLE_TYPES.has(f.type) && !filled.has(f.id));
}
