/**
 * Where a visitor goes after signing in: the page they asked for before the
 * sign-in page stopped them, carried as `?next=` (the proxy writes it, the
 * sign-in form and the OAuth callback read it). Only a page on this site:
 * anything that could leave it — `//host`, `/\host`, a scheme, `@host` —
 * falls back to the dashboard, so a crafted link can't send someone who
 * just signed in to another site.
 */

export const DEFAULT_NEXT = '/dashboard';

/** The cookie that carries `next` through an OAuth round trip (10 minutes). */
export const NEXT_COOKIE = 'auth_next';
export const NEXT_COOKIE_MAX_AGE = 600;

// Any origin works: a path has to resolve on it to be one of ours.
const BASE = 'https://app.invalid';

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return DEFAULT_NEXT;
  // A backslash reads as a slash in browsers (`/\evil.com`), and control
  // characters are stripped before parsing.
  if (/[\\\u0000-\u001f]/.test(value)) return DEFAULT_NEXT;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return DEFAULT_NEXT;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

/**
 * The absolute URL to send a visitor to after an e-mail link (`/auth/confirm`).
 * `redirect_to` can be a whole URL, since Supabase expands `{{ .RedirectTo }}`
 * and we build that from NEXT_PUBLIC_APP_URL. Such a URL is kept only when its
 * origin is the request's or the app's own. A path goes through safeNextPath.
 * Anything else is the dashboard.
 */
export function safeRedirectUrl(value: string | null | undefined, origin: string): string {
  if (value && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (ownOrigins(origin).has(url.origin)) {
        return `${url.origin}${safeNextPath(`${url.pathname}${url.search}${url.hash}`)}`;
      }
    } catch {
      // Not a URL: falls through to the dashboard.
    }
    return `${origin}${DEFAULT_NEXT}`;
  }
  return `${origin}${safeNextPath(value)}`;
}

function ownOrigins(origin: string): Set<string> {
  const origins = new Set([origin]);
  try {
    if (process.env.NEXT_PUBLIC_APP_URL)
      origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  } catch {
    // A malformed NEXT_PUBLIC_APP_URL adds nothing.
  }
  return origins;
}

/** `next` as the OAuth buttons stored it in NEXT_COOKIE (URI-encoded). */
export function nextFromCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The page a signed-out visitor asked for, as `next`: without the locale prefix, with its query. */
export function nextFromRequest(pathnameWithoutLocale: string, search: string): string {
  return safeNextPath(`${pathnameWithoutLocale}${search}`);
}
