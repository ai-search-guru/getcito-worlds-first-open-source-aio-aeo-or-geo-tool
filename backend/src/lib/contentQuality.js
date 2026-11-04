/**
 * The Content Editor's Quality (Drive quality spec) on the server: which of
 * its three phases is live (CONTENT_QUALITY_PHASE, as the web's
 * NEXT_PUBLIC_CONTENT_QUALITY_PHASE), 0 for none.
 */
export function qualityPhase() {
  const phase = Number(process.env.CONTENT_QUALITY_PHASE ?? 0);
  return Number.isInteger(phase) && phase > 0 ? Math.min(phase, 3) : 0;
}
