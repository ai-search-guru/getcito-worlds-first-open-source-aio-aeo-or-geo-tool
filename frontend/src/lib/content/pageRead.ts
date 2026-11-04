import { parseHtml } from './dom';
import { cleanHref } from './htmlAllowlist';
import { sentencesOf } from './readability';
import { squeeze, type TrustBlock } from './qualityChecks';

/**
 * A page's read for proof (Content Editor Quality spec §4b, CE-049), as the
 * API's page read gives it (contentQualityPage.js): visual proof spots —
 * one specific image the business can take itself, for a passage — and
 * proof asks — the page's own claims whose proof only the business has,
 * each with the kind of proof it needs. Each names its block by its words
 * as Trust's blocks have them.
 */

export const PROOF_KINDS = [
  'award',
  'certification',
  'research',
  'rating',
  'ranking',
  'number',
  'test',
  'customer_case',
  'unknown',
] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

export interface ProofSpot {
  /** The words the image supports, as the page has them. */
  passage: string;
  /** Its block's words (trustBlocks). */
  block: string;
  /** What the image shows. */
  image: string;
  /** Its alt text, drafted from the passage. */
  alt: string;
}

export interface ProofAsk {
  /** The claim's words, as the page has them. */
  claim: string;
  block: string;
  kind: ProofKind;
}

export interface PageRead {
  spots: ProofSpot[];
  proofs: ProofAsk[];
  regulated: 'health' | 'finance' | 'legal' | null;
  /** The page's AI checks (CE-050); null when the page wasn't read for them. */
  checks: PageChecks | null;
}

/** A check's find (CE-050): its words and its block's, as the page has them. */
export interface PageQuote {
  quote: string;
  block: string;
}

/**
 * What the page read says of the page (CE-050), each found one in its
 * block's own words: whether the paragraph after the H1 answers it; where
 * the page puts the brand forward among options; a line saying the brand
 * makes what it recommends; a real limit of the brand's own product, or
 * where another option wins; how the page's content was made.
 */
export interface PageChecks {
  answerFirst: { answers: boolean; block: string } | null;
  recommends: PageQuote | null;
  disclosure: PageQuote | null;
  balance: PageQuote | null;
  how: PageQuote | null;
  /** The model read less than the whole page: one not found may be in the rest. */
  cut: boolean;
  /** The page type they were read for: for another one, they're unknown until it's read. */
  pageType: string | null;
}

/** Pages a reader trusts more for saying how they were made: tested, picked, researched. */
export const HOW_TYPES: ReadonlySet<string> = new Set([
  'best_of',
  'comparison',
  'alternatives',
  'buying_guide',
  'guide',
  'blog_post',
]);
/** Pages that weigh options: the brand's own limits belong on them. */
export const WEIGHING_TYPES: ReadonlySet<string> = new Set([
  'comparison',
  'alternatives',
  'best_of',
  'buying_guide',
]);

/** One AI check on the page as it is: found, and the passage Show goes to. */
export interface AiCheck {
  found: boolean;
  show: string | null;
  /** The disclosure line Add line put in (CE-050): counted before the page is read again. */
  added?: boolean;
}

/**
 * The page's AI checks as they count (CE-050), on the page as it is now (a
 * find whose block is gone counts as not found, until the next read):
 *
 *   * how (E-E-A-T's who / how / why): on pages a reader trusts more for
 *     saying how they were made (HOW_TYPES);
 *   * balanced (Trust): on pages that weigh options (WEIGHING_TYPES), or
 *     where the page puts the brand forward; Show goes to that passage;
 *   * disclosure (Trust): only where the page puts the brand forward;
 *   * answerFirst (Readability): the model's verdict on the paragraph
 *     after the H1, while it is still there.
 *
 * Each is null where it doesn't apply, and one not found is left out on a
 * page the model read only part of (`cut`): it may be in the rest. Until
 * the page as it is now is read (`reading`: changes not saved yet, a save
 * not asked about, an ask out), a find whose block changed counts as still
 * found, the passage that puts the brand forward still applies and Answer
 * first's verdict holds (`held`): a small edit doesn't move the scores.
 */
export function aiChecksOnPage(
  blocks: TrustBlock[],
  checks: PageChecks,
  pageType: string | null,
  reading = false,
): {
  how: AiCheck | null;
  balanced: AiCheck | null;
  disclosure: AiCheck | null;
  answerFirst: { answers: boolean; block: string; held?: boolean } | null;
} {
  const words = new Set(blocks.map((b) => squeeze(b.text)));
  const here = (find: PageQuote | null) =>
    find && words.has(squeeze(find.block)) && squeeze(find.block).includes(squeeze(find.quote))
      ? find
      : null;
  const recommendsHere = here(checks.recommends);
  const recommends = recommendsHere ?? (reading ? checks.recommends : null);
  const check = (find: PageQuote | null, show: string | null): AiCheck | null => {
    const found = here(find);
    if (!found && find && reading) return { found: true, show: null };
    if (!found && checks.cut) return null;
    return { found: !!found, show: found ? found.quote : show };
  };
  return {
    how: pageType && HOW_TYPES.has(pageType) ? check(checks.how, null) : null,
    balanced:
      recommends || (pageType && WEIGHING_TYPES.has(pageType))
        ? check(checks.balance, recommendsHere?.quote ?? null)
        : null,
    disclosure: recommends ? check(checks.disclosure, recommendsHere?.quote ?? null) : null,
    answerFirst: !checks.answerFirst
      ? null
      : words.has(squeeze(checks.answerFirst.block))
        ? checks.answerFirst
        : reading
          ? { ...checks.answerFirst, held: true }
          : null,
  };
}

/** The proof to-dos open at once at most: the page's first claims. */
export const MAX_PROOF_TODOS = 5;

/** A proof ask on the page as it is: its sentence, and whether its block links out. */
export interface PageProof extends ProofAsk {
  sentence: string;
  linked: boolean;
}

/**
 * The page's proof asks as the page is now, in its order (a block's by
 * where its claim is): each whose block is still there, with the sentence
 * that holds its claim and whether the block links out (an http(s) link,
 * as Trust reads it: its proof, on the brand's site or another). Blocks
 * and claims are matched by their words without spaces: a link put on a
 * claim adds one at its edge ("ISO 27001 -certified"). Its to-do's key
 * reads the block without spaces (proofKey), so it stays as the block's
 * spacing changes.
 */
export function proofsOnPage(blocks: TrustBlock[], proofs: readonly ProofAsk[]): PageProof[] {
  const seen = new Set<string>();
  return blocks.flatMap((block) => {
    const words = squeeze(block.text);
    return (
      proofs
        .filter((proof) => squeeze(proof.block) === words && words.includes(squeeze(proof.claim)))
        // A block the page has twice: its claims once.
        .filter((proof) => {
          const key = `${proof.claim}\n${proof.block}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => words.indexOf(squeeze(a.claim)) - words.indexOf(squeeze(b.claim)))
        .map((proof) => ({
          ...proof,
          sentence:
            sentencesOf(block.text).find((s) => squeeze(s).includes(squeeze(proof.claim))) ??
            proof.claim,
          linked: block.links.some((href) => /^https?:\/\//i.test(cleanHref(href) ?? '')),
        }))
    );
  });
}

/**
 * The page's images, in its order, each once by its address (an http(s)
 * one, as the page keeps it): what the person may confirm is their own.
 */
export function pageImages(html: string): { src: string; alt: string }[] {
  // The content DOM's parser (dom.ts): the browser's, or jsdom's on the server (go-live gate).
  const doc = parseHtml(html);
  const seen = new Set<string>();
  return [...doc.querySelectorAll('img[src]')].flatMap((img) => {
    const src = img.getAttribute('src')!.trim();
    // As the database takes an own image's address (00270): http(s), 8–2048 characters.
    if (!/^https?:\/\//.test(src) || src.length < 8 || src.length > 2048 || seen.has(src)) {
      return [];
    }
    seen.add(src);
    return [{ src, alt: img.getAttribute('alt')?.trim() ?? '' }];
  });
}
