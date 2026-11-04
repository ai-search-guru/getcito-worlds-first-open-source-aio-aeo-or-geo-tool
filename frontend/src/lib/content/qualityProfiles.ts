import { qualityPhase } from './quality';
import {
  EEAT_WEIGHTS,
  TRUST_WEIGHTS,
  type EeatCheckId,
  type Score,
  type TrustCheckId,
  type TrustRead,
} from './qualityChecks';
import { READABILITY_WEIGHTS, type ReadabilityCheckId } from './readability';

/**
 * Page types (Content Editor Quality spec §11, Phase 3, CE-052): the three
 * scores keep their names, but what each counts, and how much, follows the
 * page's type. A product page has no author (the brand's byline) and wants
 * real photos and proof; a category page short copy and real images; a
 * feature page screenshots and sourced metrics; a comparison balance and a
 * disclosure. Every other type reads as an article (a blog post or a guide).
 *
 * A weight of 0 leaves the check out, and the score is rescaled over the
 * rest, as for a check not live yet. GetCito estimates, until calibrated
 * with citation data (CE-055).
 */

export const QUALITY_PROFILES = [
  'article',
  'product',
  'category',
  'feature',
  'comparison',
] as const;
export type QualityProfile = (typeof QUALITY_PROFILES)[number];

const BY_TYPE: Readonly<Record<string, QualityProfile>> = {
  product_page: 'product',
  category_page: 'category',
  collection_page: 'category',
  feature_page: 'feature',
  solution_page: 'feature',
  integration: 'feature',
  pricing: 'feature',
  comparison: 'comparison',
  alternatives: 'comparison',
  best_of: 'comparison',
};

/** The page type's profile: an article for any other type, none, or before Phase 3. */
export function profileFor(
  pageType: string | null | undefined,
  phase: number = qualityPhase(),
): QualityProfile {
  return phase >= 3 && pageType ? (BY_TYPE[pageType] ?? 'article') : 'article';
}

export interface ProfileWeights {
  eeat: Record<EeatCheckId, number>;
  trust: Record<TrustCheckId, number>;
  readability: Record<ReadabilityCheckId, number>;
}

/**
 * Each profile's checks and points. The article's are the spec's blog
 * defaults (§2); the others follow §11's table. A check a page can't be
 * read for yet (a product feed that doesn't have the page's product, and
 * reviews, not connected yet) is left out, the rest rescaled.
 */
export const PROFILE_WEIGHTS: Readonly<Record<QualityProfile, ProfileWeights>> = {
  article: {
    eeat: { ...EEAT_WEIGHTS },
    trust: { ...TRUST_WEIGHTS },
    readability: { ...READABILITY_WEIGHTS },
  },
  // No author (the brand's byline); real product photos; proof for its
  // claims, the price and stock its feed has (most), how it ships and goes
  // back; short, plain copy with its specs table.
  product: {
    eeat: {
      experience: 20,
      originalData: 20,
      byline: 0,
      authorBio: 0,
      visualProof: 60,
      whoHowWhy: 0,
      dates: 0,
      authorSchema: 0,
      brandInfo: 0,
      checkDate: 0,
      customerCase: 0,
    },
    trust: {
      claimsSourced: 20,
      primarySources: 5,
      noWeakSources: 5,
      brandFacts: 20,
      expertQuote: 0,
      freshSources: 0,
      balanced: 0,
      disclosure: 0,
      noBrokenLinks: 5,
      siteTrust: 10,
      shippingReturns: 10,
      feedMatch: 25,
      introFacts: 0,
    },
    readability: {
      avgSentence: 15,
      longSentences: 20,
      readingLevel: 20,
      answerFirst: 0,
      shortParagraphs: 15,
      headingSpacing: 0,
      passiveJargon: 10,
      typeRules: 20,
    },
  },
  // Low E-E-A-T weight: real product images and the brand's own
  // information (its site's trust); prices and claims that match the
  // brand's; a short intro and a buying FAQ.
  category: {
    eeat: {
      experience: 0,
      originalData: 0,
      byline: 0,
      authorBio: 0,
      visualProof: 60,
      whoHowWhy: 0,
      dates: 0,
      authorSchema: 0,
      brandInfo: 40,
      checkDate: 0,
      customerCase: 0,
    },
    trust: {
      // The checks before intro facts at 0.8 of their points: a page whose
      // intro states none scores as it did.
      claimsSourced: 20,
      primarySources: 0,
      noWeakSources: 4,
      brandFacts: 24,
      expertQuote: 0,
      freshSources: 0,
      balanced: 0,
      disclosure: 0,
      noBrokenLinks: 12,
      siteTrust: 20,
      shippingReturns: 0,
      feedMatch: 0,
      introFacts: 20,
    },
    readability: {
      avgSentence: 15,
      longSentences: 20,
      readingLevel: 20,
      answerFirst: 0,
      shortParagraphs: 15,
      headingSpacing: 0,
      passiveJargon: 0,
      typeRules: 30,
    },
  },
  // Product screenshots weigh most, then real customer cases (confirmed
  // publishable) and the person's data and use;
  // sourced metrics and a price that matches; scannable sections.
  feature: {
    eeat: {
      experience: 20,
      originalData: 20,
      byline: 0,
      authorBio: 0,
      visualProof: 35,
      whoHowWhy: 0,
      dates: 0,
      authorSchema: 0,
      brandInfo: 0,
      checkDate: 0,
      customerCase: 25,
    },
    trust: {
      claimsSourced: 35,
      primarySources: 10,
      noWeakSources: 5,
      brandFacts: 20,
      expertQuote: 10,
      freshSources: 5,
      balanced: 0,
      disclosure: 0,
      noBrokenLinks: 5,
      siteTrust: 10,
      shippingReturns: 0,
      feedMatch: 0,
      introFacts: 0,
    },
    readability: {
      avgSentence: 15,
      longSentences: 15,
      readingLevel: 15,
      answerFirst: 10,
      shortParagraphs: 15,
      headingSpacing: 15,
      passiveJargon: 5,
      typeRules: 10,
    },
  },
  // An author, saying how the picks were made and when they were last
  // checked; balance and a disclosure,
  // each rival's facts from its own pages; the summary first and a table
  // side by side.
  comparison: {
    eeat: {
      experience: 15,
      originalData: 10,
      byline: 15,
      authorBio: 10,
      visualProof: 10,
      whoHowWhy: 15,
      dates: 5,
      authorSchema: 0,
      brandInfo: 0,
      checkDate: 20,
      customerCase: 0,
    },
    trust: {
      claimsSourced: 25,
      primarySources: 15,
      noWeakSources: 5,
      brandFacts: 5,
      expertQuote: 0,
      freshSources: 5,
      balanced: 20,
      disclosure: 15,
      noBrokenLinks: 5,
      siteTrust: 5,
      shippingReturns: 0,
      feedMatch: 0,
      introFacts: 0,
    },
    readability: {
      avgSentence: 15,
      longSentences: 10,
      readingLevel: 15,
      answerFirst: 25,
      shortParagraphs: 10,
      headingSpacing: 5,
      passiveJargon: 5,
      typeRules: 15,
    },
  },
};

/** The checks a profile leaves out (weight 0): no to-do or suggestion asks for them. */
export function checksOff(profile: QualityProfile): ReadonlySet<string> {
  const w = PROFILE_WEIGHTS[profile];
  return new Set(
    [...Object.entries(w.eeat), ...Object.entries(w.trust), ...Object.entries(w.readability)]
      .filter(([, points]) => points === 0)
      .map(([id]) => id),
  );
}

/**
 * Whether a profile's E-E-A-T waits for the site's trust: it weighs the
 * brand's own information (a category page's 40), and a score from the
 * images alone would jump once the site is read.
 */
export const waitsForSiteTrust = (profile: QualityProfile) =>
  PROFILE_WEIGHTS[profile].eeat.brandInfo > 0;

/**
 * A score's checks weighed for a profile: each keeps its share of its
 * points (half of them stays half), out of the profile's weight; one
 * weighing 0 is left out, and the score rescaled over the rest. A score
 * that wasn't given (none of its checks live) stays not given.
 */
export function weighed<Id extends string, S extends Score<Id>>(
  result: S,
  weights: Readonly<Record<Id, number>>,
): S {
  const checks = result.checks.flatMap((c) => {
    const max = weights[c.id] ?? c.max;
    return max > 0 ? [{ ...c, points: c.max > 0 ? (c.points / c.max) * max : 0, max }] : [];
  });
  const total = checks.reduce((sum, c) => sum + c.max, 0);
  const score =
    result.score === null || total === 0
      ? null
      : Math.round((checks.reduce((sum, c) => sum + c.points, 0) / total) * 100);
  return { ...result, checks, score };
}

/**
 * Trust weighed for a profile, scored as trust() scores it: once a figure,
 * fresh-sources, product feed or intro facts check is left among the weighed ones, or
 * two sources are placed; on a type that weighs brand facts as much as
 * sourced claims, once a price is compared with them too. A type isn't
 * scored by its links and site alone. Its unscored gains count out of the
 * type's Phase 1 points.
 */
export function weighedTrust(
  read: TrustRead,
  weights: ProfileWeights['trust'],
): TrustRead & { phase1Points: number } {
  // Scored here, by the weighed checks: trust() leaves it unscored by its own.
  const result = weighed({ ...read, score: read.score ?? 0 }, weights);
  const scored =
    result.checks.some(
      (c) =>
        c.id === 'claimsSourced' ||
        c.id === 'freshSources' ||
        c.id === 'feedMatch' ||
        c.id === 'introFacts',
    ) ||
    read.classified >= 2 ||
    // Where prices that match weigh as much as sourced claims (a product or a
    // category page), a compared one is Trust's own: every price wrong isn't "Not scored".
    (weights.brandFacts >= weights.claimsSourced &&
      result.checks.some((c) => c.id === 'brandFacts'));
  return {
    ...result,
    score: scored ? result.score : null,
    phase1Points: weights.claimsSourced + weights.freshSources + weights.noBrokenLinks,
  };
}
