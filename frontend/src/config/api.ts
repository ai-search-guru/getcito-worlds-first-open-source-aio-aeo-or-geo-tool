export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:80';

/**
 * Base the *browser* uses to reach the API server.
 *
 * Deliberately same-origin and relative: a fetch from the visitor's machine
 * to another host makes their network a dependency of ours, and when that
 * fails there is nothing in any of our logs to see. Requests to this prefix
 * land on the proxy route handler, which forwards them to API_BASE_URL from
 * our own infrastructure. See `app/api/aeo/[...path]/route.ts`.
 *
 * Code that already runs on our side — server actions in `lib/actions/*`,
 * route handlers, cron — should keep using API_BASE_URL and call the server
 * directly rather than looping back through this.
 */
export const BROWSER_API_BASE_URL = '/api/aeo';

/**
 * Absolute, public origin of the API server.
 *
 * Only for URLs that are rendered for somewhere *outside* this app — today
 * that is the tracking snippet the customer pastes into their own site, whose
 * `<script src>` has to name a real host. Anything fetched by our own pages
 * belongs on BROWSER_API_BASE_URL instead.
 */
export function getPublicApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? '';
}
