/**
 * A brand's site trust (Content Editor Quality spec §8, CE-043), as the API
 * reads it (siteTrust.js, site_trust 00259): five site-level checks, shown
 * in Site Audit as "Site trust {n}/5" and worth 5 Trust points on every page.
 */

export const SITE_TRUST_CHECKS = [
  'about',
  'contact',
  'editorial',
  'organizationSchema',
  'authorPages',
] as const;
export type SiteTrustCheck = (typeof SITE_TRUST_CHECKS)[number];

export interface SiteTrust {
  checks: Record<Exclude<SiteTrustCheck, 'authorPages'>, { ok: boolean; url: string | null }> & {
    authorPages: { ok: boolean; authors: { name: string; url: string | null }[] };
  };
  /** How many of the five pass. */
  score: number;
  checkedAt: string;
  /**
   * False when the site didn't answer all of it (a timeout, a bot wall): a
   * check that fails may only not have been read. An older API leaves it out.
   */
  complete?: boolean;
}

/**
 * How long the API keeps a read when asked to check again, and before it
 * reads a partial one again (siteTrust.js RECHECK_MS).
 */
export const SITE_TRUST_RECHECK_MS = 10 * 60 * 1000;

/** Where Quality's "Fix in Site Audit" goes: the card in Site Audit. */
export const SITE_TRUST_PATH = '/dashboard/audit#site-trust';

/** The checks that don't pass, in order. */
export function siteTrustMissing(trust: SiteTrust): SiteTrustCheck[] {
  return SITE_TRUST_CHECKS.filter((check) => !trust.checks[check]?.ok);
}
