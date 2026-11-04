import crypto from 'node:crypto';

/**
 * Compare a stored webhook secret with the secret provided by a caller.
 *
 * The length check is necessary because timingSafeEqual throws for unequal
 * buffers. Secret lengths are not confidential; equal-length values are
 * compared in constant time.
 */
export function webhookSecretsMatch(expected, provided) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
