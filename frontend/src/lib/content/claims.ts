/**
 * The claims in a draft's own words (Quality spec §3, CE-045), as the API
 * reads them (contentQualityClaims.js): what a reader would want a source
 * for, each in its block's words. Trust counts them with the figures it
 * reads by rule; the editor underlines one with no source in its block.
 */

export const CLAIM_KINDS = ['number', 'stat', 'superlative', 'fact'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export interface DraftClaim {
  /** The claim's words, as its block has them. */
  text: string;
  kind: ClaimKind;
}

/** A block of the page with its claims: its words as Trust's blocks have them (trustBlocks). */
export interface ClaimBlock {
  text: string;
  claims: DraftClaim[];
}
