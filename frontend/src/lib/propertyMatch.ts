/**
 * Brand ↔ analytics property matching (#642, generalised for GA4 in #694).
 *
 * Both Search Console and Google Analytics let a brand be mapped to exactly
 * one property, and both can guess that mapping from the brand's domains — the
 * only difference is where the property's URL comes from. GSC properties *are*
 * URLs ("https://www.example.com/" or "sc-domain:example.com"); a GA4 property
 * is a numeric id whose site URLs live on its web data streams. Once both are
 * expressed as a list of URLs per property, the matching is identical.
 */

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

/** True when the property URL covers the given brand domain. */
export function propertyMatchesDomain(siteUrl: string, domain: string): boolean {
  const host = normalizeHost(domain);
  if (!host) return false;

  if (siteUrl.startsWith('sc-domain:')) {
    // GSC domain properties cover the apex and every subdomain.
    const apex = siteUrl.slice('sc-domain:'.length).trim().toLowerCase();
    return host === apex || host.endsWith(`.${apex}`);
  }

  return normalizeHost(siteUrl) === host;
}

/** A property reduced to what matching needs: its stored value and its URLs. */
export interface MatchableProperty {
  value: string;
  siteUrls: string[];
}

/**
 * The single property whose URLs match any of the brand's domains, or null
 * when none or several match — ambiguity needs a human pick.
 */
export function matchProperty(
  properties: MatchableProperty[],
  brandDomains: string[],
): string | null {
  const matches = properties.filter((property) =>
    property.siteUrls.some((siteUrl) =>
      brandDomains.some((domain) => propertyMatchesDomain(siteUrl, domain)),
    ),
  );
  return matches.length === 1 ? matches[0].value : null;
}
