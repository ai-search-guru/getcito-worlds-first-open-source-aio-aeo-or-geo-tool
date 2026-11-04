import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';
import { isTrustedHost } from './trustedSources';

/**
 * What kind of source a page's link is (Quality spec CE-046, Trust §2.2):
 * primary (official, research, standards), secondary (news and magazines,
 * review sites), weak (forums and social posts), a competitor's page, or the
 * brand's own. Read from the address alone, by the citations' categories
 * (classifyDomain) and a short list of research and standards sites; an
 * address the rules can't place is left out (null), so it neither raises
 * nor lowers Trust until the model has read its site (part b, Trust's
 * `ai` reads).
 */

export type SourceClass = 'primary' | 'secondary' | 'weak' | 'competitor' | 'own';
/**
 * What the model reads a site as (content_source_classes, 00264): unknown
 * when it doesn't know the site, which Trust leaves out as the rules do.
 */
export type AiSourceClass = 'primary' | 'secondary' | 'weak' | 'unknown';

/**
 * A public DNS name: letters, digits and hyphens in each label, a dot at
 * least and a letter top-level domain (punycode passes); no IP address, no
 * single-label name (localhost, an intranet's), no other characters. As
 * the API's and the table's check.
 */
export const SITE_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * A site the model may be asked about, as the API takes it (keptSite): a
 * public DNS name, no "www." left at its start, and no label that reads as
 * words (longer than 30 characters, or 3 hyphens or more; punycode aside).
 */
export function askableSite(site: string): boolean {
  return (
    SITE_NAME.test(site) &&
    !site.startsWith('www.') &&
    !site
      .split('.')
      .some(
        (label) =>
          !label.startsWith('xn--') && (label.length > 30 || (label.match(/-/g) ?? []).length >= 3),
      )
  );
}
/** Sites one ask of the model takes (the API's MAX_SOURCE_SITES). */
export const MAX_SOURCE_SITES = 20;

/** Research, journals and standards bodies: primary wherever they're cited. */
const RESEARCH_DOMAINS = [
  'doi.org',
  'arxiv.org',
  'nature.com',
  'science.org',
  'sciencedirect.com',
  'springer.com',
  'wiley.com',
  'ieee.org',
  'acm.org',
  'jstor.org',
  'ssrn.com',
  'plos.org',
  'thelancet.com',
  'bmj.com',
  'nejm.org',
  'w3.org',
  'ietf.org',
  'rfc-editor.org',
  'iso.org',
  'whatwg.org',
];

/**
 * Sites the citations' categories call institutional whose pages anyone
 * writes or uploads: an encyclopedia anyone edits reads as secondary, a
 * site of uploaded papers as weak.
 */
const SECONDARY_DOMAINS = ['wikipedia.org'];
const WEAK_DOMAINS = ['academia.edu'];

/**
 * Pages that compare: a link to a competitor's own page (its pricing, its
 * docs) is where its facts come from (spec §11), so it counts as primary.
 */
const COMPARING = new Set(['comparison', 'alternatives', 'best_of']);

const onList = (host: string, list: string[]) =>
  list.some((entry) => host === entry || host.endsWith(`.${entry}`));

export function sourceClass(
  url: string,
  {
    brandDomains,
    competitorDomains,
    pageType,
    trustedDomains = [],
  }: {
    brandDomains: string[];
    competitorDomains: string[];
    pageType: string | null;
    /** The sites the brand trusts (Settings › Content, 00449): primary, they and their pages. */
    trustedDomains?: readonly string[];
  },
): SourceClass | null {
  const host = normalizeDomain(url);
  if (!host) return null;
  const kind = classifyDomain(host, {
    brandDomains: brandDomains.map(normalizeDomain).filter(Boolean),
    competitorDomains: competitorDomains.map(normalizeDomain).filter(Boolean),
  });
  // The brand's own word on a site wins, but for its own pages.
  if (kind !== 'you' && isTrustedHost(host, trustedDomains)) return 'primary';
  if (onList(host, SECONDARY_DOMAINS)) return 'secondary';
  if (onList(host, WEAK_DOMAINS)) return 'weak';
  switch (kind) {
    case 'you':
      return 'own';
    case 'competitor':
      return pageType && COMPARING.has(pageType) ? 'primary' : 'competitor';
    case 'institutional':
      return 'primary';
    case 'editorial':
    case 'review':
      return 'secondary';
    case 'forum':
    case 'social':
      return 'weak';
    default:
      return onList(host, RESEARCH_DOMAINS) ? 'primary' : null;
  }
}
