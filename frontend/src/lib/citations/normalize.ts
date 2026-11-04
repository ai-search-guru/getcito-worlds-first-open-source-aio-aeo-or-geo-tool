/**
 * Identity-bearing query parameters for citation URLs.
 *
 * Hostnames are matched after removing a leading `www.`. Keep this table
 * deliberately small: query parameters are discarded unless a host/path pair
 * explicitly identifies them as part of the page identity.
 */
const IDENTITY_QUERY_PARAMS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> =
  {
    'youtube.com': { '/watch': ['v'] },
    'm.youtube.com': { '/watch': ['v'] },
  };

/**
 * Canonical URL key for citation aggregation.
 *
 * Query parameters and fragments are normally discarded, and one trailing
 * slash is stripped. Known query-keyed pages retain only the parameters that
 * identify the page.
 */
export function normalizeCitationUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const identityParams = IDENTITY_QUERY_PARAMS[host]?.[parsed.pathname] ?? [];
    const preservedParams = identityParams.flatMap((param) =>
      parsed.searchParams.getAll(param).map((value) => [param, value] as const),
    );

    parsed.search = '';
    for (const [param, value] of preservedParams) {
      parsed.searchParams.append(param, value);
    }
    parsed.hash = '';

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

/**
 * Looser cross-source match key: host without `www.` plus path without
 * trailing slashes. This intentionally ignores protocol, query and fragment.
 */
export function citationUrlMatchKey(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}
