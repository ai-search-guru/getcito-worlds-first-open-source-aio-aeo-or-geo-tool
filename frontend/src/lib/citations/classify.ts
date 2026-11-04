/**
 * Source category classification for citation domains.
 *
 * Pure, synchronous heuristic. No network I/O. Order matters: the first
 * matching rule wins — `you` and `competitor` always take precedence over
 * content-type categories like `editorial` or `review`.
 */

export type SourceCategory =
  | 'you'
  | 'competitor'
  | 'forum'
  | 'social'
  | 'review'
  | 'institutional'
  | 'editorial'
  | 'other';

export const SOURCE_CATEGORIES: SourceCategory[] = [
  'you',
  'competitor',
  'editorial',
  'forum',
  'social',
  'review',
  'institutional',
  'other',
];

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  you: 'You',
  competitor: 'Competitor',
  editorial: 'Editorial',
  forum: 'Forum',
  social: 'Social',
  review: 'Review',
  institutional: 'Institutional',
  other: 'Other',
};

// Suffix-based matching (matches the domain or any subdomain of it).
const FORUM_DOMAINS = [
  'reddit.com',
  'quora.com',
  'stackexchange.com',
  'stackoverflow.com',
  'ycombinator.com',
  'discourse.org',
  'mumsnet.com',
  'mbworld.org',
  'bimmerpost.com',
  'rennlist.com',
  'teslamotorsclub.com',
  'serverfault.com',
  'superuser.com',
  'askubuntu.com',
];

const SOCIAL_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'facebook.com',
  'linkedin.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'threads.net',
  'medium.com',
  'substack.com',
  'discord.com',
];

const REVIEW_DOMAINS = [
  'trustpilot.com',
  'tripadvisor.com',
  'g2.com',
  'capterra.com',
  'consumerreports.org',
  'yelp.com',
  'sitejabber.com',
  'bbb.org',
  'glassdoor.com',
  'softwareadvice.com',
  'resellerratings.com',
];

const INSTITUTIONAL_DOMAINS = [
  'wikipedia.org',
  'who.int',
  'europa.eu',
  'un.org',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'nih.gov',
  'cdc.gov',
  'iihs.org',
  'nhtsa.gov',
  'epa.gov',
];

// Curated list of well-known editorial / news / magazine sites.
// Intentionally small — anything unknown falls into `other`.
const EDITORIAL_DOMAINS = [
  'nytimes.com',
  'wsj.com',
  'ft.com',
  'bloomberg.com',
  'reuters.com',
  'bbc.com',
  'bbc.co.uk',
  'cnn.com',
  'theguardian.com',
  'washingtonpost.com',
  'forbes.com',
  'businessinsider.com',
  'fortune.com',
  'economist.com',
  'time.com',
  'newyorker.com',
  'theatlantic.com',
  'theverge.com',
  'wired.com',
  'techcrunch.com',
  'engadget.com',
  'arstechnica.com',
  'cnet.com',
  'zdnet.com',
  'gizmodo.com',
  'mashable.com',
  'vox.com',
  'axios.com',
  'politico.com',
  'npr.org',
  'cbsnews.com',
  'nbcnews.com',
  'abcnews.go.com',
  'foxnews.com',
  'aljazeera.com',
  'dw.com',
  'reviewgeek.com',
  'motortrend.com',
  'caranddriver.com',
  'roadandtrack.com',
  'autoblog.com',
  'autocar.co.uk',
  'top10.com',
  'thedrive.com',
  'hemmings.com',
  'digitaltrends.com',
  'tomsguide.com',
  'pcmag.com',
  'lifewire.com',
  'topgear.com',
  'jalopnik.com',
  'insideevs.com',
  'electrek.co',
];

const INSTITUTIONAL_TLD_PATTERN = /\.(edu|gov|mil)(\.[a-z]{2,3})?$/i;
const INSTITUTIONAL_GENERIC_PATTERN = /\.(ac|edu|gov)\.[a-z]{2}$/i;

function matchesSuffix(domain: string, list: string[]): boolean {
  const d = domain.toLowerCase();
  return list.some((entry) => d === entry || d.endsWith(`.${entry}`));
}

export interface ClassifyContext {
  brandDomains: string[];
  competitorDomains: string[];
}

/**
 * Extract a normalized hostname ("www.FOO.com/bar" → "foo.com") from a raw
 * URL string. Returns null for inputs that can't be parsed.
 */
export function extractHostname(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl.trim());
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    // Some citations come in as bare hostnames or stripped strings. Try to
    // recover a hostname-like token.
    const match = rawUrl.match(/^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/**
 * Normalize a user-entered domain ("https://www.Foo.com/x" or "foo.COM/") to
 * its bare hostname ("foo.com"). Useful when loading brand / competitor
 * domains from the database.
 */
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return '';
  const host = extractHostname(raw) ?? raw.trim().toLowerCase();
  return host.replace(/\/+$/, '');
}

export function classifyDomain(domain: string, ctx: ClassifyContext): SourceCategory {
  const d = domain.toLowerCase();

  if (ctx.brandDomains.length > 0 && matchesSuffix(d, ctx.brandDomains)) {
    return 'you';
  }
  if (ctx.competitorDomains.length > 0 && matchesSuffix(d, ctx.competitorDomains)) {
    return 'competitor';
  }
  if (matchesSuffix(d, FORUM_DOMAINS)) return 'forum';
  if (matchesSuffix(d, SOCIAL_DOMAINS)) return 'social';
  if (matchesSuffix(d, REVIEW_DOMAINS)) return 'review';
  if (matchesSuffix(d, INSTITUTIONAL_DOMAINS)) return 'institutional';
  if (INSTITUTIONAL_TLD_PATTERN.test(d)) return 'institutional';
  if (INSTITUTIONAL_GENERIC_PATTERN.test(d)) return 'institutional';
  if (matchesSuffix(d, EDITORIAL_DOMAINS)) return 'editorial';

  return 'other';
}
