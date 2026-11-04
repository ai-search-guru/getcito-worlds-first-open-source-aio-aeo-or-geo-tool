/**
 * The sites a brand trusts as sources (customer priorities item 6, 00449),
 * set in Settings › Content: Site Audit counts a link to one as an authority
 * link (server audit/authoritySources.js), and the Content Editor's Trust
 * reads it as a primary source (sourceClass.ts). A site counts with its
 * pages: docs.example.org for example.org.
 */

/** The most sites a brand trusts (brands.trusted_sources' check). */
export const MAX_TRUSTED_SOURCES = 50;

/** A host's labels: letters, digits and hyphens, none at an end; a dot between. */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/**
 * A site as it's saved: its host in lower case, without a scheme, path,
 * port or www. ("https://www.Example.org/docs" → "example.org"). Null for
 * what isn't a site.
 */
export function trustedHost(text: string): string | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  const bare = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return HOST.test(bare) ? bare : null;
}

/**
 * What a person typed, one site per line (or separated by commas), as it's
 * saved: each site once, in order, at most MAX_TRUSTED_SOURCES; and the
 * lines that aren't sites, to say so.
 */
export function parseTrustedSources(text: string): { sources: string[]; invalid: string[] } {
  const sources: string[] = [];
  const invalid: string[] = [];
  for (const line of text.split(/[\n,]/)) {
    if (!line.trim()) continue;
    const host = trustedHost(line);
    if (!host) invalid.push(line.trim());
    else if (!sources.includes(host)) sources.push(host);
  }
  return { sources, invalid };
}

/** Whether a host is a site the brand trusts, or one of its pages. */
export function isTrustedHost(host: string, trusted: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return trusted.some((site) => h === site || h.endsWith(`.${site}`));
}
