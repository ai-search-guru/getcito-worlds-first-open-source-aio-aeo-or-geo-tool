/**
 * Hostname of an absolute URL, or '' when `value` is not one. `new URL()` throws
 * on anything that is not an absolute URL (`foo`, `example.com`), and parses a
 * scheme-less `localhost:3000` as scheme "localhost:" with no host at all.
 */
function hostnameOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

/**
 * True when the host of `headerValue` (a Referer or Origin header) matches the
 * host of one of `allowedOrigins`. Both sides are untrusted input, so neither
 * may throw: a header that can't be parsed is not allowed, and an allow-list
 * entry that can't be parsed is skipped so it can't break the valid ones.
 */
export function isAllowedOrigin(headerValue, allowedOrigins) {
  const hostname = hostnameOf(headerValue);
  if (!hostname) return false;

  return allowedOrigins.some((origin) => hostnameOf(origin) === hostname);
}
