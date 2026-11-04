/**
 * The key guard an Admin sets (AGENT-OWN-KEY §4.2, 00442): the most all
 * agents may spend on the workspace's own AI key in a month, $10 to $10,000,
 * $250 unless set. Pure, for the settings card and the server code alike.
 */
export const OWN_KEY_GUARD_MIN_USD = 10;
export const OWN_KEY_GUARD_MAX_USD = 10_000;
export const OWN_KEY_GUARD_DEFAULT_USD = 250;

/** The guard as Settings › AI Providers shows it to Admins (§4.3): dollars at list prices. */
export interface OwnKeyGuard {
  capUsd: number;
  /** This period's estimate of what all agents spent on the key. */
  usedUsd: number;
  renewsAt: string | null;
}
