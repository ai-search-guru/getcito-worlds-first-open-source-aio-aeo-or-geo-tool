/**
 * Google Search Console property matching (#642).
 *
 * A GSC property is either a URL-prefix ("https://www.example.com/") or a
 * domain property ("sc-domain:example.com"). A brand knows its domains
 * (brand_domains). Auto-mapping picks the property that matches a brand
 * domain — and only auto-applies when the match is unambiguous.
 *
 * The matching itself is shared with the Google Analytics mapping (#694);
 * this module only adapts GSC's "the property is the URL" shape to it.
 */

import { matchProperty } from './propertyMatch';

export { propertyMatchesDomain } from './propertyMatch';

/**
 * The single property matching any of the brand's domains, or null when
 * none or several match (ambiguity needs a human pick).
 */
export function matchGscProperty(propertyUrls: string[], brandDomains: string[]): string | null {
  return matchProperty(
    propertyUrls.map((siteUrl) => ({ value: siteUrl, siteUrls: [siteUrl] })),
    brandDomains,
  );
}
