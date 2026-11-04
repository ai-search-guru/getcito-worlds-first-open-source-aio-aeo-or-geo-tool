/**
 * Page state kept in the query string, so a refresh or a shared link restores
 * a filtered view. Pages read it after mount — useSearchParams would need a
 * Suspense boundary around the page — and write it with replaceState, which
 * adds no history entry and keeps the router's own history state.
 */

/** A query param's value, or `fallback` when it is absent or not one of `allowed`. */
export function readUrlChoice<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = new URLSearchParams(window.location.search).get(name);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A free-form query param (an id, a search), or '' when absent. */
export function readUrlParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

/**
 * Merge `updates` into the current query string. A value equal to its entry
 * in `defaults`, an empty string or null removes the param, so a page in its
 * default state has a clean URL. Params not named in `updates` are kept.
 */
export function writeUrlParams(
  updates: Record<string, string | null | undefined>,
  defaults: Record<string, string> = {},
): void {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(updates)) {
    if (value == null || value === '' || value === defaults[name]) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url);
  }
}
