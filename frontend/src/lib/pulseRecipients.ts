/**
 * Daily Pulse recipient validation (#921), shared by the settings form and
 * PUT /api/settings/pulse so both reject the same addresses.
 *
 * Invalid entries are returned rather than dropped: an empty stored list
 * means "every organization member", so silently discarding a mistyped
 * address would widen the audience instead of failing the save.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipients(input: unknown[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') continue;
    const email = entry.trim();
    if (!email) continue;
    (EMAIL.test(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}
