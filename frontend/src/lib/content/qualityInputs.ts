import { factMismatches, type BrandFact } from './brandFacts';
import { checkDateOnPage } from './checkDate';
import { inputsUsed, type DraftInputs } from './draftInputs';
import { feedCheck, type CatalogMatch } from './feedMatch';
import { confirmedFacts, introFacts } from './introFacts';
import { aiChecksOnPage, pageImages, proofsOnPage, type PageRead } from './pageRead';
import { firstImage, openingParagraph, pageOffer } from './pageSchema';
import { disclosureText } from './readyToPublish';
import { eeat, shippingOnPage, squeeze, trust, type TrustBlock } from './qualityChecks';
import {
  PROFILE_WEIGHTS,
  profileFor,
  waitsForSiteTrust,
  weighed,
  weighedTrust,
} from './qualityProfiles';
import { caseConfirmed } from './qualityTodos';
import { readability, sentencesOf, withTypeRules } from './readability';
import type { SiteTrust } from './siteTrust';

/**
 * A page's Content Quality scores (E-E-A-T, Trust and Readability) from
 * everything they read, in one place: the Content Editor computes them from
 * its reads as they land, and the server's gate for an agent going live on
 * its own computes them from the same reads (AUTONOMOUS-GO-LIVE §6.2), so
 * the two can't drift. Pure: every read is given, null where it isn't read
 * yet (the score waits, as the editor's does) or doesn't apply.
 */

type TrustArgs = Parameters<typeof trust>[0];
type EeatArgs = Parameters<typeof eeat>[0];

/** What the scores read, each as the editor holds it. */
export interface QualityReads {
  /** The page as the editor has it (its HTML), and its blocks (trustBlocks of it, [] with Quality off). */
  html: string;
  blocks: TrustBlock[];
  /** The page's language (its Language rule, else the brand's). */
  language: string | null | undefined;
  brandName: string;
  pageType: string | null;
  /** qualityPhase(). */
  phase: number;
  /** The Authors read landed (or failed), and the page's author among them. */
  authorsRead: boolean;
  author: EeatArgs['author'];
  /** The person's word for the author their site names (00271). */
  authorConfirmed: EeatArgs['confirmed'];
  /** Brief › Your input (phase 2): read, or still reading. */
  inputs: DraftInputs | null;
  inputsPending: boolean;
  /** Each link's read so far. */
  linkChecks: TrustArgs['links'];
  /** The brand's own domains as the sources read them; null until read. */
  brandDomains: string[] | null;
  competitorDomains: string[] | null;
  /** The sites the brand trusts (Settings › Content, 00449): primary sources. */
  trustedDomains?: string[] | null;
  /** The site's trust (Site Audit), and whether its read landed (or failed). */
  siteTrust: SiteTrust | null;
  siteTrustRead: boolean;
  /** The brand's facts (phase 2), null until read. */
  brandFacts: BrandFact[] | null;
  /** The links the person kept as sources. */
  keptSources: readonly string[];
  /** What the model says each unplaced site is (phase 2). */
  aiKinds: NonNullable<TrustArgs['sources']>['ai'];
  /** The claims the model read in the page's words (phase 2). */
  claimBlocks: TrustArgs['claims'];
  /** The page read (phase 2): its result, held while paused or limited, settled once in. */
  pageRead: {
    read: PageRead | null;
    paused: boolean;
    limited: boolean;
    settled: boolean;
    /** A read or a save on its way: what it found is held, not shown changing. */
    changing: boolean;
  };
  /** The page type's own rules, as the Rules tab reads them from the page. */
  typeRules: Parameters<typeof withTypeRules>[1];
  /** The customer cases and intro facts the person confirmed (phase 3), and whether they're read. */
  caseConfirms: ReadonlySet<string> | null;
  introConfirms: ReadonlySet<string> | null;
  casesRead: boolean;
  /** The page's images the person confirmed are their own; null until read. */
  ownImages: ReadonlySet<string> | null;
  /** The visual proof spots still open in the page. */
  openSpots: number;
  /** A product page's product in the brand's catalog (phase 3), when read. */
  catalog: CatalogMatch | null | undefined;
  now: number;
}

/** The scores, and what the editor shows besides them, each as the editor had it. */
export function qualityState(reads: QualityReads) {
  const {
    html,
    blocks,
    language,
    brandName,
    pageType,
    phase,
    competitorDomains,
    brandFacts,
    pageRead,
  } = reads;
  const qualityOn = phase >= 1;
  const sourcesOn = phase >= 2;
  const texts = blocks.map((b) => b.text);

  const used = reads.inputs ? inputsUsed(texts.join('\n'), reads.inputs) : null;
  const factCheck = brandFacts
    ? factMismatches({
        sentences: blocks.flatMap((b) => sentencesOf(b.text)),
        facts: brandFacts,
        brandName,
        competitorDomains: competitorDomains ?? [],
      })
    : null;
  const proofAsks = pageRead.read ? proofsOnPage(blocks, pageRead.read.proofs) : [];

  // The page read's AI checks (CE-050), on the page as it is; the disclosure
  // line Add line puts in is the disclosure while the page has it.
  const checks =
    sourcesOn &&
    pageRead.read?.checks &&
    pageRead.read.checks.pageType === (pageType ?? null) &&
    !pageRead.paused &&
    !pageRead.limited
      ? aiChecksOnPage(blocks, pageRead.read.checks, pageType, pageRead.changing)
      : null;
  const line = checks?.disclosure?.found === false ? disclosureText(language, brandName) : null;
  const aiChecks =
    line && squeeze(texts.join('')).includes(squeeze(line))
      ? { ...checks!, disclosure: { found: true, show: line, added: true } }
      : checks;

  const profile = profileFor(pageType, phase);
  const weights = PROFILE_WEIGHTS[profile];
  const checkDateRead = qualityOn && profile === 'comparison' ? checkDateOnPage(texts) : null;
  const shippingRead = qualityOn && profile === 'product' ? shippingOnPage(html, language) : null;
  const readable = qualityOn
    ? weighed(
        withTypeRules(readability(html, language, aiChecks?.answerFirst ?? null), reads.typeRules),
        weights.readability,
      )
    : null;

  // Phase 3 (CE-052, CE-054): customer cases and a category intro's facts.
  const casesOn = sourcesOn && phase >= 3;
  const introOn = casesOn && profile === 'category';
  const intro = introOn ? introFacts(html, language) : [];
  const introConfirmed = confirmedFacts(reads.introConfirms ?? []);
  const introAll = [...new Set(intro.flatMap((fact) => fact.facts))];
  const introRead = introOn && reads.casesRead ? { facts: intro, confirmed: introConfirmed } : null;
  const caseCount = casesOn
    ? (() => {
        const asks = proofAsks.filter((ask) => ask.kind === 'customer_case');
        const confirms = reads.caseConfirms ?? new Set<string>();
        return {
          total: asks.length,
          confirmed: asks.filter((ask) => caseConfirmed(confirms, ask)).length,
        };
      })()
    : null;

  // Visual proof (CE-049): own images, once the page read and the confirmations are in.
  const images = sourcesOn ? pageImages(html) : [];
  const ownImages = reads.ownImages;
  const visualOwn = ownImages ? images.filter((image) => ownImages.has(image.src)).length : 0;
  const visualRead = sourcesOn && pageRead.settled && ownImages !== null;
  const visual = visualRead
    ? { images: images.length, own: visualOwn, openSpots: reads.openSpots }
    : null;

  const brandInfoRead = !waitsForSiteTrust(profile) || reads.siteTrustRead;
  const eeatScore =
    qualityOn &&
    reads.authorsRead &&
    !reads.inputsPending &&
    (!sourcesOn || visualRead) &&
    brandInfoRead &&
    (!casesOn || reads.casesRead)
      ? weighed(
          eeat({
            author: reads.author,
            used,
            visual,
            how: aiChecks?.how ?? null,
            confirmed: reads.authorConfirmed,
            siteTrust: reads.siteTrust,
            checkDate: checkDateRead === null ? null : checkDateRead.found,
            cases: caseCount,
          }),
          weights.eeat,
        )
      : null;

  // Phase 3 (CE-053): a product page's Product schema, and its price and stock against the feed.
  const productSchema =
    profile === 'product'
      ? (() => {
          const own = images
            .filter((image) => ownImages?.has(image.src) && /^https:\/\//i.test(image.src))
            .map((image) => image.src);
          const first = firstImage(html);
          return {
            description: openingParagraph(html),
            images: own.length ? own : first ? [first] : [],
            offer: pageOffer(texts),
          };
        })()
      : null;
  const feedOn = profileFor(pageType, phase) === 'product';
  const feedRead =
    feedOn && reads.catalog?.product && productSchema
      ? feedCheck({
          texts,
          offer: productSchema.offer,
          variants: reads.catalog.product.variants,
        })
      : null;

  const sourceRead = sourcesOn
    ? {
        competitorDomains: competitorDomains ?? [],
        pageType,
        kept: new Set(reads.keptSources),
        ai: reads.aiKinds,
        trustedDomains: reads.trustedDomains ?? [],
      }
    : null;
  const trustScore =
    qualityOn && reads.brandDomains && !reads.inputsPending
      ? weighedTrust(
          trust({
            blocks,
            links: reads.linkChecks,
            brandDomains: reads.brandDomains,
            siteTrust: reads.siteTrust,
            quote: used ? used.quote : null,
            sources: sourceRead,
            claims: reads.claimBlocks,
            brandFacts: factCheck,
            proofs: proofAsks,
            page: aiChecks,
            shipping: shippingRead,
            feed: feedRead,
            intro: introOn
              ? {
                  total: introAll.length,
                  confirmed: introAll.filter((fact) => introConfirmed.has(fact)).length,
                }
              : null,
            now: reads.now,
          }),
          weights.trust,
        )
      : null;

  return {
    profile,
    weights,
    used,
    factCheck,
    proofAsks,
    aiChecks,
    checkDateRead,
    shippingRead,
    readable,
    casesOn,
    introOn,
    intro,
    introConfirmed,
    introAll,
    introRead,
    caseCount,
    images,
    visualRead,
    visual,
    brandInfoRead,
    eeatScore,
    productSchema,
    feedRead,
    sourceRead,
    trustScore,
  };
}

export type QualityState = ReturnType<typeof qualityState>;
