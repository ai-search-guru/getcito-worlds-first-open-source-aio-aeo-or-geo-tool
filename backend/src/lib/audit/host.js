/**
 * Host normalization for matching site audits to a brand's domain.
 *
 * Both sides of the comparison must go through the same normalization, or a
 * stored domain such as `example.com/` never equals the host of an audit of
 * `https://example.com`.
 */

/** Lowercased hostname of a URL with a leading www. stripped; the port is ignored (null on failure). */
export function normHost(u) {
  try {
    return new URL(u).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Normalized host of a stored brand domain. Stored domains are free text: a
 * bare host, or one with a scheme (any case), path, trailing slash or port.
 */
export function normStoredDomain(domain) {
  if (!domain) return null;
  const value = String(domain).trim();
  return normHost(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

/** True when `url` is on one of the stored brand domains or a subdomain of one. */
export function onBrandDomain(url, domains) {
  const host = normHost(url);
  if (!host) return false;
  return (domains ?? [])
    .map(normStoredDomain)
    .some((d) => d && (host === d || host.endsWith(`.${d}`)));
}
