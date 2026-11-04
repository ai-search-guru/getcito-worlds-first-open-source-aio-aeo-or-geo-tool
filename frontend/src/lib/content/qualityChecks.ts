import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';
import type { ContentAuthor } from './authors';
import { parseHtml } from './dom';
import { cleanHref } from './htmlAllowlist';
import { languageCode, ownText, sentencesOf } from './readability';
import type { FactMismatch } from './brandFacts';
import type { FeedMismatch } from './feedMatch';
import type { ClaimBlock } from './claims';
import { askableSite, sourceClass, type AiSourceClass, type SourceClass } from './sourceClass';

/** A text's words without their spaces, as compared where an inline tag may add one. */
export const squeeze = (text: string) => text.replace(/\s+/g, '');

/**
 * E-E-A-T and Trust (Content Editor Quality spec §2.1, §2.2): checks read
 * from the page's facts, each worth its points. Only the checks live in the
 * current phase count; the score is the share of their points, out of 100,
 * and a score with no live check isn't given at all (no fake points).
 */

export interface ScoreCheck<Id extends string = string> {
  id: Id;
  points: number;
  max: number;
}

export interface Score<Id extends string = string> {
  /** 0–100, or null when no check of it is live for this page yet. */
  score: number | null;
  checks: ScoreCheck<Id>[];
}

/**
 * E-E-A-T's checks and points (blog defaults); Phase 1 reads the author's.
 * The brand's own information (its site's trust, CE-043) counts only on
 * the page types that weigh it (a category page, qualityProfiles.ts).
 */
export const EEAT_WEIGHTS = {
  experience: 20,
  originalData: 15,
  byline: 15,
  authorBio: 10,
  visualProof: 10,
  whoHowWhy: 10,
  dates: 10,
  authorSchema: 10,
  brandInfo: 0,
  // Phase 3 (CE-052): a comparison's visible check date; weighed there.
  checkDate: 0,
  // Phase 3 (CE-052): a feature page's customer cases, confirmed publishable.
  customerCase: 0,
} as const;
/** The brand info check's points before a page type weighs it (weighed keeps its share). */
const BRAND_INFO_POINTS = 10;
/** The check date's points before a page type weighs it. */
const CHECK_DATE_POINTS = 10;
/** The customer cases' points before a page type weighs them. */
const CUSTOMER_CASE_POINTS = 10;
export type EeatCheckId = keyof typeof EEAT_WEIGHTS;

/**
 * Trust's checks and points; Phase 1 reads the page's links and figures
 * (sourced figures, fresh sources, working links) and the site's trust
 * (Site Audit, CE-043); the rest are Phase 2, starting with what kind of
 * source each link is (CE-046).
 */
export const TRUST_WEIGHTS = {
  claimsSourced: 30,
  primarySources: 15,
  noWeakSources: 10,
  brandFacts: 10,
  expertQuote: 8,
  freshSources: 7,
  balanced: 7,
  disclosure: 5,
  noBrokenLinks: 3,
  siteTrust: 5,
  // Phase 3 (CE-052): a product page's shipping and returns; weighed there.
  shippingReturns: 0,
  // Phase 3 (CE-053): a product page's price and stock against its product
  // feed; weighed there, and only where the feed has the page's product.
  feedMatch: 0,
  // Phase 3 (CE-054): a category page's intro facts the person confirmed;
  // weighed there, and only where its intro states a count or a price.
  introFacts: 0,
} as const;
export type TrustCheckId = keyof typeof TRUST_WEIGHTS;

/** The shipping and returns check's points before a page type weighs it. */
const SHIPPING_POINTS = 10;
/** The product feed check's points before a page type weighs it. */
const FEED_POINTS = 10;
/** The intro facts check's points before a page type weighs it. */
const INTRO_POINTS = 10;
/**
 * Words that say how a product ships, in a policy's terms: "free shipping",
 * "shipping takes 2 days", "Free UK delivery on orders over £50", "Standard
 * delivery 3–5 working days", "Expédition sous 24h", "Entrega en 24/48
 * horas", "ücretsiz kargo", "2 iş gününde teslim". Not a bare "shipping"
 * ("Shipping weight: 1.2 kg"), "ships with a cable", or a product named
 * for it ("kargo pantolon").
 */
const SHIPPING_WORDS = new RegExp(
  String.raw`(?<!\p{L})(?:${[
    String.raw`(?:free|fast|standard|express|next[- ]day|same[- ]day|flat[- ]rate|worldwide|international)\s+(?:\p{L}+\s+)?(?:shipping|delivery)`,
    String.raw`shipping\s+(?:is|costs?|fees?|times?|takes|in|within|on|to|from|policy|rates?|&|and|information|details|options)`,
    String.raw`ships?\s+(?:in|within|free|worldwide|from|next|same|today|by)`,
    String.raw`delivery\s*:?\s*(?:\p{L}+\s+){0,3}(?:\d+(?:\s*[–—-]\s*\d+)?|one|two|three)\s*(?:working\s+|business\s+)?(?:days?|hours?|h|weeks?)(?!\p{L})`,
    String.raw`delivery\s+(?:times?|in|within|costs?|fees?|is\s+free|charges?)`,
    String.raw`delivered\s+(?:in|within|free|by)`,
    String.raw`dispatch(?:ed|es)?\s+(?:in|within|the\s+same)`,
    String.raw`(?:kostenlose[rn]?\s+)?versand(?:kostenfrei|kosten|\s+(?:in|innerhalb|ab|ist|kostet))`,
    String.raw`lieferzeit|lieferung\s+(?:in|innerhalb)`,
    String.raw`livraison\s+(?:gratuite|offerte|en|sous|express|standard|sous)|exp[ée]di(?:tion|é(?:e|s)?)\s+(?:sous|en|le|gratuite)`,
    String.raw`env[ií]os?\s+(?:gratis|gratuito|en|a|de\s+\d)|entrega\s+(?:en|gratuita|gratis|de\s+\d)`,
    String.raw`(?:ücretsiz|bedava|hızlı|aynı\s+gün)\s+kargo|kargo\s+(?:ücretsiz|bedava|ücreti|süresi|ile|firması|bedeli)|kargoya\s+verilir|teslimat\s+(?:süresi|ücreti|bilgileri)|teslim\s+edilir`,
  ].join('|')})`,
  'iu',
);
/**
 * Words that say how a product goes back: "30-day returns", "Returns are
 * accepted within 30 days", "free returns", "satisfait ou remboursé",
 * "kostenlose Retoure", "iade koşulları". Not "in return" or "return on
 * investment".
 */
const RETURN_WORDS = new RegExp(
  String.raw`(?<!\p{L})(?:${[
    String.raw`returns?\s+(?:policy|within|window|are\s+(?:free|accepted|easy)|is\s+free|accepted|and\s+exchanges?|&\s+exchanges?)`,
    String.raw`(?:free|easy|hassle[- ]free)\s+returns?|\d+[- ]days?\s+(?:returns?|money[- ]back|refund)`,
    String.raw`refunds?\s+(?:policy|within|in)|full\s+refund|money[- ]back`,
    String.raw`iade|değişim\s+(?:hakkı|süresi|koşulları)|ücretsiz\s+değişim`,
    String.raw`rückgabe|rücksendung|widerruf|(?:kostenlose\s+)?retoure|umtausch`,
    String.raw`retours?\s+(?:gratuits?|sous|accept[ée]s?|offerts?)|remboursement|satisfait\s+ou\s+rembours[ée]`,
    String.raw`devoluci[oó]n|reembolso`,
  ].join('|')})`,
  'iu',
);
/** A heading that names the policy ("Shipping & Returns", "Versand", "İade"): it counts with text under it. */
const SHIPPING_HEADING =
  /^(?:shipping|delivery|shipping\s+(?:&|and)\s+(?:returns|delivery)|delivery\s+(?:&|and)\s+returns|versand(?:\s*(?:&|und)\s*(?:rückgabe|lieferung))?|lieferung|livraison(?:\s+et\s+retours)?|env[ií]os?(?:\s+y\s+devoluciones)?|kargo(?:\s+(?:ve|&)\s+iade)?|teslimat(?:\s+(?:ve|&)\s+iade)?)(?:\s+(?:policy|information|info|bilgileri|politikası))?[\s:]*$/iu;
const RETURN_HEADING =
  /^(?:(?:shipping|delivery)\s+(?:&|and)\s+)?(?:returns?(?:\s+(?:&|and)\s+(?:exchanges?|refunds?))?|refunds?|exchanges?|(?:versand\s*(?:&|und)\s*)?rückgabe|retours|(?:livraison\s+et\s+)?retours|(?:env[ií]os?\s+y\s+)?devoluciones|(?:kargo\s+(?:ve|&)\s+)?iade(?:\s+(?:ve|&)\s+değişim)?|değişim)(?:\s+(?:policy|information|info|koşulları|politikası))?[\s:]*$/iu;
/**
 * A link to the shop's shipping or returns page, by its own path
 * ("/shipping", "/pages/shipping-and-returns", "/policies/refund-policy",
 * "#returns"); not a product's ("/collections/delivery-bags").
 */
const SHIPPING_LINK =
  /(?:^|[/#])(?:shipping|delivery|kargo|teslimat|versand(?:kosten)?|lieferung|livraison|envios?)(?:[-_](?:policy|policies|info|information|and[-_](?:returns?|delivery)|returns?|bilgileri|politikasi))*\/?(?:$|[?#])/iu;
const RETURN_LINK =
  /(?:^|[/#])(?:(?:shipping|delivery)[-_]and[-_])?(?:returns?|refunds?|iade|rueckgabe|ruecksendung|widerruf|retours?|reembolsos?|devoluciones?)(?:[-_](?:policy|policies|info|information|and[-_](?:exchanges?|refunds?)|kosullari))*\/?(?:$|[?#])/iu;
/** The languages these words are written for: another page is read by its links alone. */
const SHIPPING_LANGUAGES = new Set(['en', 'tr', 'de', 'fr', 'es']);

/**
 * Whether a page says how its product ships and goes back (Phase 3,
 * CE-052): its words in a policy's terms, a heading that names the policy
 * with text under it, or a link to the shop's page for each. A product
 * page's to-do reads it before Trust does. Read as written and lowercased
 * the Turkish way too ("İade koşulları"). A page in a language these words
 * aren't written for is read by its links alone, and isn't asked (null)
 * when it has none.
 */
export function shippingOnPage(
  html: string,
  language: string | null = 'en',
): { shipping: boolean; returns: boolean } | null {
  const doc = parseHtml(html);
  const blocks = [...doc.body.querySelectorAll('p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6')]
    .map((el) => ({ heading: /^H\d$/.test(el.tagName), text: (el.textContent ?? '').trim() }))
    .filter((block) => block.text);
  const hrefs = [...doc.body.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');
  const linked = {
    shipping: hrefs.some((href) => SHIPPING_LINK.test(href)),
    returns: hrefs.some((href) => RETURN_LINK.test(href)),
  };
  if (!SHIPPING_LANGUAGES.has(languageCode(language) ?? '')) {
    return linked.shipping || linked.returns ? linked : null;
  }
  const read = (text: string, words: RegExp) =>
    words.test(text) || words.test(text.toLocaleLowerCase('tr'));
  // A heading that names the policy, with text under it before the next heading.
  const headed = (heading: RegExp) =>
    blocks.some(
      (block, i) =>
        block.heading && read(block.text, heading) && blocks[i + 1] && !blocks[i + 1].heading,
    );
  const says = (words: RegExp) => blocks.some((block) => read(block.text, words));
  return {
    shipping: linked.shipping || says(SHIPPING_WORDS) || headed(SHIPPING_HEADING),
    returns: linked.returns || says(RETURN_WORDS) || headed(RETURN_HEADING),
  };
}

/**
 * Trust's Phase 1 points (sourced figures, fresh sources, working links):
 * what a broken link's gain is out of while Trust isn't scored (trustGain).
 */
export const TRUST_PHASE1_POINTS =
  TRUST_WEIGHTS.claimsSourced + TRUST_WEIGHTS.freshSources + TRUST_WEIGHTS.noBrokenLinks;

/** The most links the API reads for one draft at a time (linkCheck.js). */
export const MAX_LINK_CHECKS = 20;
/** A source older than this many months isn't fresh. */
export const FRESH_MONTHS = 24;

/** A link's read (the API's content_link_checks): does it answer, and its page's own date. */
export interface LinkCheck {
  /** The link as the page has it. */
  href: string;
  status: 'ok' | 'broken' | 'unknown';
  httpStatus: number | null;
  date: string | null;
}

function scoreOf<Id extends string>(checks: ScoreCheck<Id>[]): Score<Id> {
  const max = checks.reduce((sum, c) => sum + c.max, 0);
  if (max === 0) return { score: null, checks };
  const points = checks.reduce((sum, c) => sum + c.points, 0);
  return { score: Math.round((points / max) * 100), checks };
}

/**
 * The score's rise if the checks named came out in full: the gain chip of a
 * suggestion. Zero when they already have their points.
 */
export function scoreGain<Id extends string>(result: Score<Id>, ids: Id[]): number {
  if (result.score === null) return 0;
  const raised = result.checks.map((c) => (ids.includes(c.id) ? { ...c, points: c.max } : c));
  return (scoreOf(raised).score ?? 0) - result.score;
}

/**
 * What sourcing one sentence would add to Trust: its share of the claims'
 * points (CE-049's proof to-dos). Zero when Trust isn't scored or the
 * sentence has its source.
 */
export function sentenceGain(
  trust: (Score<TrustCheckId> & Partial<Pick<TrustRead, 'unsourced' | 'figures'>>) | null,
  sentence: string,
): number {
  if (!trust || trust.score === null || !trust.unsourced?.includes(sentence)) return 0;
  const figures = trust.figures ?? 0;
  const raised = trust.checks.map((c) =>
    c.id === 'claimsSourced' && figures > 0
      ? { ...c, points: Math.min(c.max, c.points + c.max / figures) }
      : c,
  );
  return (scoreOf(raised).score ?? 0) - trust.score;
}

/**
 * A Trust suggestion's gain. While Trust isn't scored (no figure and no
 * dated source yet), the checks' missing points count out of the Phase 1
 * points (the page type's, CE-052, when weighed for it), so a broken link
 * still says what fixing it is worth.
 */
export function trustGain(
  result: Score<TrustCheckId> & { phase1Points?: number },
  ids: TrustCheckId[],
): number {
  if (result.score !== null) return scoreGain(result, ids);
  const named = result.checks.filter((c) => ids.includes(c.id));
  const missing = named.reduce((sum, c) => sum + c.max - c.points, 0);
  // A check outside Phase 1's (brand facts) counts out of its own points too.
  const out =
    (result.phase1Points ?? TRUST_PHASE1_POINTS) +
    named.filter((c) => !PHASE1_CHECKS.has(c.id)).reduce((sum, c) => sum + c.max, 0);
  return out > 0 ? Math.round((missing / out) * 100) : 0;
}

/** Trust's Phase 1 checks: sourced figures, fresh sources, working links. */
const PHASE1_CHECKS: ReadonlySet<TrustCheckId> = new Set([
  'claimsSourced',
  'freshSources',
  'noBrokenLinks',
]);

/** What an author's profile has: a short bio, and profile links (Person schema's sameAs). */
export function authorProfile(author: ContentAuthor | null): { bio: boolean; links: boolean } {
  return { bio: !!author?.bio?.trim(), links: (author?.sameAs.length ?? 0) > 0 };
}

/**
 * E-E-A-T from the page's author (CE-038): a real person, with a short bio
 * and profile links. The organization byline is no person. Author schema
 * and dates join when the live page is read (CE-042): the JSON-LD Before you
 * publish gives counts only once the page has it. Experience, data, proof
 * and who/how/why are Phase 2.
 */
export function eeat({
  author,
  used = null,
  visual = null,
  how = null,
  confirmed = null,
  siteTrust = null,
  checkDate = null,
  cases = null,
}: {
  author: ContentAuthor | null;
  /**
   * Phase 3 (CE-052): the page's customer cases (its proof asks of that
   * kind) and how many the person confirmed may be published; left out
   * where it has none.
   */
  cases?: { total: number; confirmed: number } | null;
  /**
   * Phase 3 (CE-052): whether a comparison shows when its products were
   * last checked (pageCheckDate); left out elsewhere.
   */
  checkDate?: boolean | null;
  /**
   * The site's trust (its five checks in Site Audit, CE-043): the brand's own
   * information, which only a page type that weighs it counts (CE-052).
   */
  siteTrust?: { score: number } | null;
  /**
   * Phase 2 (CE-050): whether the page says how it was made (tested,
   * picked, researched, by whom), as the page read finds it; null where it
   * doesn't apply or isn't read.
   */
  how?: { found: boolean } | null;
  /**
   * Phase 2 (CE-049): the page's images, how many of them the person
   * confirmed are their own (not stock), and the visual proof spots still
   * open. Own ones are visual proof; images or spots with none confirmed
   * count none; a page with neither leaves the check out. Left out before.
   */
  visual?: { images: number; own: number; openSpots: number } | null;
  /**
   * With no author picked, what the person confirmed of the one their site
   * names (00271): a real person (the byline's points), and their profile
   * there with a bio and links (the profile's, with the first).
   */
  confirmed?: { real: boolean; profile: boolean } | null;
  /**
   * Phase 2 (CE-048): whether the page uses the person's experience and
   * their data (Brief › Your input, inputsUsed); left out before.
   */
  used?: { experience: boolean; data: boolean } | null;
}): Score<EeatCheckId> {
  const { bio, links } = authorProfile(author);
  return scoreOf<EeatCheckId>([
    ...(used
      ? [
          {
            id: 'experience' as const,
            points: used.experience ? EEAT_WEIGHTS.experience : 0,
            max: EEAT_WEIGHTS.experience,
          },
          {
            id: 'originalData' as const,
            points: used.data ? EEAT_WEIGHTS.originalData : 0,
            max: EEAT_WEIGHTS.originalData,
          },
        ]
      : []),
    // Own images are among the page's: images or open spots bring the check in.
    ...(visual && (visual.images > 0 || visual.openSpots > 0)
      ? [
          {
            id: 'visualProof' as const,
            points: visual.own > 0 ? EEAT_WEIGHTS.visualProof : 0,
            max: EEAT_WEIGHTS.visualProof,
          },
        ]
      : []),
    ...(how
      ? [
          {
            id: 'whoHowWhy' as const,
            points: how.found ? EEAT_WEIGHTS.whoHowWhy : 0,
            max: EEAT_WEIGHTS.whoHowWhy,
          },
        ]
      : []),
    {
      id: 'byline',
      points: author || confirmed?.real ? EEAT_WEIGHTS.byline : 0,
      max: EEAT_WEIGHTS.byline,
    },
    {
      id: 'authorBio',
      points: author
        ? (EEAT_WEIGHTS.authorBio * ((bio ? 1 : 0) + (links ? 1 : 0))) / 2
        : confirmed?.real && confirmed.profile
          ? EEAT_WEIGHTS.authorBio
          : 0,
      max: EEAT_WEIGHTS.authorBio,
    },
    ...(cases && cases.total > 0
      ? [
          {
            id: 'customerCase' as const,
            points: (CUSTOMER_CASE_POINTS * Math.min(cases.confirmed, cases.total)) / cases.total,
            max: CUSTOMER_CASE_POINTS,
          },
        ]
      : []),
    ...(checkDate !== null
      ? [
          {
            id: 'checkDate' as const,
            points: checkDate ? CHECK_DATE_POINTS : 0,
            max: CHECK_DATE_POINTS,
          },
        ]
      : []),
    ...(siteTrust
      ? [
          {
            id: 'brandInfo' as const,
            points: (BRAND_INFO_POINTS * siteTrust.score) / 5,
            max: BRAND_INFO_POINTS,
          },
        ]
      : []),
  ]);
}

/**
 * A figure, the kind of claim that wants a source: a percentage, an amount
 * with a magnitude ("$2.5 million", "€10M"), a number with a magnitude or a
 * multiplier ("2 million", "10k", "3x", "3 times faster"). A bare number
 * ("5 steps", "2026", "24/7"), a price ("$29/month") or a size ("10 x 20 cm")
 * isn't one.
 */
const FIGURE_WORDS =
  /%\s?\d|\d[\d.,]*\s?(?:%|percent\b|per cent\b|prozent\b)|[$€£¥₺]\s?\d[\d.,]*\s?(?:[km]\b|bn\b|thousand|million|billion|trillion)|\d[\d.,]*\s?(?:thousand|million|billion|trillion|millones|milyon|milyar|milliard|millionen|milliarden)s?\b|\d+(?:[.,]\d+)?\s?times\s(?:more|less|faster|slower|higher|lower|as|bigger|smaller|better|cheaper)\b/i;
const FIGURE_SHORT = /\b\d+(?:[.,]\d+)?(?:x|k|K|M|bn|B)\b/;
/** A percentage, either way round ("20%", "20 percent", "%20"). */
const PERCENT = String.raw`(?:\d[\d.,]*\s?(?:%|percent\b|per cent\b)|%\s?\d[\d.,]*)`;
/**
 * Numbers that read as figures but claim nothing, taken out before the
 * figures are looked for. Product and category pages have them in almost
 * every block:
 *   - a discount or a rate: "Save 20%", "50% off", "a 0% APR loan";
 *   - a material or a guarantee: "100% cotton", "100% money-back" ("100% of
 *     our customers" stays a figure);
 *   - short forms that aren't amounts: "4K", "8K", "401k";
 *   - a price with a magnitude: "$1.2k/month", "$2 million per year".
 */
const NOT_FIGURES = [
  new RegExp(String.raw`\bsave\s+(?:up\s+to\s+)?${PERCENT}`, 'gi'),
  new RegExp(String.raw`${PERCENT}\s*(?:off|discount|apr|apy)\b`, 'gi'),
  /(?:\b100\s?(?:%|percent\b|per cent\b)|%\s?100\b)(?!\s*of\b)/gi,
  // Screens say "4K" in capitals; "4k" stays four thousand.
  /\b[48]K\b/g,
  /\b401\s?\(?k\b\)?/gi,
  /[$€£¥₺]\s?\d[\d.,]*\s?(?:[km]|bn|thousand|million|billion|trillion)\s*(?:\/|per\b)/gi,
];
const hasFigure = (sentence: string) => {
  const text = NOT_FIGURES.reduce((rest, re) => rest.replace(re, ' '), sentence);
  return FIGURE_WORDS.test(text) || FIGURE_SHORT.test(text);
};

/** A block of the page's text, with the links in it, as Trust reads them. */
export interface TrustBlock {
  tag: string;
  text: string;
  links: string[];
}

/**
 * The page's paragraphs, list items, quotes and table cells, each with its
 * own words and links: a list item without the list nested in it (as
 * Readability reads it), a paragraph in an item or a cell with it.
 */
export function trustBlocks(html: string): TrustBlock[] {
  // The content DOM's parser (dom.ts): the browser's, or jsdom's on the server (go-live gate).
  const doc = parseHtml(html);
  const out: TrustBlock[] = [];
  for (const el of doc.body.querySelectorAll('p, li, blockquote, td, th')) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'p' && el.closest('li, blockquote, td, th')) continue;
    if (tag !== 'td' && tag !== 'th' && el.parentElement?.closest('td, th')) continue;
    // An inline link's edges leave no space before the punctuation after it.
    const text = ownText(el)
      .replace(/\s+/g, ' ')
      .replace(/ ([.,;:!?…)])/g, '$1')
      .trim();
    if (!text) continue;
    const links = [...el.querySelectorAll('a[href]')]
      // A list item's links, not its nested list's.
      .filter((a) => tag !== 'li' || a.closest('li') === el)
      .map((a) => a.getAttribute('href') ?? '');
    out.push({ tag, text, links });
  }
  return out;
}

/**
 * The page's links, as the draft saves them (cleanHref): http(s) only, each
 * with its block's place and whether it is on the brand's own site.
 */
function pageLinks(blocks: TrustBlock[], brandDomains: string[]) {
  const own = brandDomains.map(normalizeDomain).filter(Boolean);
  const out: { url: string; block: number; text: string; external: boolean }[] = [];
  blocks.forEach((block, index) => {
    for (const raw of block.links) {
      const href = cleanHref(raw);
      if (!href || !/^https?:\/\//i.test(href)) continue;
      const host = normalizeDomain(href);
      const external =
        !!host && classifyDomain(host, { brandDomains: own, competitorDomains: [] }) !== 'you';
      out.push({ url: href, block: index, text: block.text, external });
    }
  });
  return out;
}

/** Each link once, by its address: where the page has it first (Show goes there). */
const byUrl = <T extends { url: string }>(links: T[]) => {
  const first = new Map<string, T>();
  for (const l of links) if (!first.has(l.url)) first.set(l.url, l);
  return [...first.values()];
};

/** The page's links to read, each once, MAX_LINK_CHECKS at most: Trust's link checks. */
export function linksToCheck(blocks: TrustBlock[]): string[] {
  return [...new Set(pageLinks(blocks, []).map((l) => l.url))].slice(0, MAX_LINK_CHECKS);
}

export interface TrustRead extends Score<TrustCheckId> {
  /** Links that don't answer, with the block each is in (for Show). */
  broken: { url: string; text: string }[];
  /** Sources older than FRESH_MONTHS, and how many give a date at all. */
  stale: { url: string; text: string }[];
  dated: number;
  /**
   * Sentences with a figure or a claim and no source in their block, and
   * how many have one.
   */
  unsourced: string[];
  figures: number;
  /**
   * Phase 2 (CE-045): what the draft underlines, in the page's order: the
   * model's claims with no source in their own words, the other figures in
   * their sentences; and how many unsourced sentences only the model found
   * ("AI check").
   */
  marks: ClaimMark[];
  aiClaims: number;
  /**
   * Phase 2 (CE-046): weak or competitors' sources the person hasn't kept,
   * the page's first first (`ai` when the model read its site), and how
   * many sources could be placed.
   */
  weak: { url: string; text: string; kind: 'weak' | 'competitor'; ai: boolean }[];
  classified: number;
  /** Phase 2 (CE-047): the page's facts that differ from the brand's approved ones. */
  mismatches: FactMismatch[];
  /** Phase 3 (CE-052): whether the page says how shipping and returns work; null where not read. */
  shipping?: { shipping: boolean; returns: boolean } | null;
  /** Phase 3 (CE-053): where the page's price and stock differ from its product feed's. */
  feed?: FeedMismatch[];
}

/**
 * A claim with no source, as the draft underlines it (CE-045): its words
 * (the whole sentence for a figure read by rule), the sentence Remove takes
 * out, and its block's text, the only place its words are looked for.
 */
export interface ClaimMark {
  text: string;
  sentence: string;
  block: string;
}

/** What Trust needs to tell a link's kind (Phase 2, CE-046). */
export interface SourceRead {
  competitorDomains: string[];
  pageType: string | null;
  /** The sites the brand trusts (00449): primary sources. */
  trustedDomains?: readonly string[];
  /** Weak or competitors' sources the person chose to keep, by their address. */
  kept: ReadonlySet<string>;
  /** The model's reads of sites the rules can't place (part b), by site. */
  ai?: ReadonlyMap<string, AiSourceClass>;
}

/**
 * Trust from the page as written (Phase 1): figures with a source (a link
 * to another site in the same block), sources from the last FRESH_MONTHS,
 * links that answer, and the site's trust (its five checks in Site Audit).
 * A check with nothing to read (no figure, no dated source, no link read
 * yet, no site trust read) is left out, and site trust counts only beside a
 * check of the page's own. Trust is scored only once a figure, a dated
 * source or a product feed's check is there: working links alone are 3
 * points, and one link would set the whole score (one dead link 0, one
 * working link 100), as Readability waits for MIN_WORDS.
 *
 * With `sources` (Phase 2, CE-046), each source's kind counts too: a primary
 * one among them (official, research, standards), and none weak (forums,
 * social posts) or a competitor's, unless the person kept it. A source the
 * rules can't place is left out of both; two placed sources score Trust on
 * their own.
 *
 * With `claims` (Phase 2, CE-045), the claims the model read count as the
 * figures do, each sentence once: Trust is scored from them alone too.
 *
 * With `brandFacts` (Phase 2, CE-047), the page's prices, trial and founding
 * year compared with the brand's approved facts count: the share that
 * matched. Like a working link, it doesn't score Trust on its own.
 *
 * With `proofs` (Phase 2, CE-049), the sentence holding the brand's own
 * claim (an award, a certification, its own test) is sourced by a link in
 * its block to the brand's own site too: its award or trust page is the
 * proof. The block's other sentences aren't.
 *
 * With `page` (Phase 2, CE-050), the page read's balance (the brand's own
 * limits, or where another option wins) and disclosure (where the page puts
 * the brand forward) count where they apply. Like the brand's facts, they
 * don't score Trust on their own.
 */
export function trust({
  blocks,
  links,
  brandDomains,
  siteTrust = null,
  quote = null,
  sources: kinds = null,
  claims = null,
  brandFacts = null,
  proofs = null,
  page = null,
  shipping = null,
  feed = null,
  intro = null,
  now,
}: {
  /**
   * Phase 3 (CE-054): a category page's intro facts (introFacts) and how
   * many the person confirmed; left out where its intro states none.
   */
  intro?: { total: number; confirmed: number } | null;
  /**
   * Phase 3 (CE-053): a product page's price and stock against its product
   * in the brand's feed (feedCheck); left out where the feed doesn't have it.
   */
  feed?: { compared: number; mismatches: FeedMismatch[] } | null;
  /**
   * Phase 3 (CE-052): whether a product page says how shipping and returns
   * work (shippingOnPage); left out elsewhere.
   */
  shipping?: { shipping: boolean; returns: boolean } | null;
  /** The page's blocks (trustBlocks). */
  blocks: TrustBlock[];
  /** Each link's read, by the link as the page has it; one not read yet isn't counted. */
  links: Map<string, LinkCheck>;
  brandDomains: string[];
  /** How many of the site's five trust checks pass (CE-043), when read. */
  siteTrust?: { score: number } | null;
  /**
   * Phase 2 (CE-048): whether the page quotes a real expert from Brief ›
   * Your input word for word; left out before.
   */
  quote?: boolean | null;
  /** Phase 2: what each source is (CE-046); left out before. */
  sources?: SourceRead | null;
  /** Phase 2: the claims the model read in the page's own words (CE-045); left out before. */
  claims?: readonly ClaimBlock[] | null;
  /** Phase 2: the page against the brand's approved facts (factMismatches, CE-047); left out before. */
  brandFacts?: { compared: number; mismatches: FactMismatch[] } | null;
  /**
   * Phase 2: the brand's own claims' sentences, each in its block (the page
   * read's proofs on the page, CE-049).
   */
  proofs?: readonly { block: string; sentence: string }[] | null;
  /** Phase 2: the page read's balance and disclosure, each null where it doesn't apply (CE-050). */
  page?: { balanced: { found: boolean } | null; disclosure: { found: boolean } | null } | null;
  now: number;
}): TrustRead {
  const all = pageLinks(blocks, brandDomains);
  const checks: ScoreCheck<TrustCheckId>[] = [];

  // Each sentence once, where the page has it first: a nested list item's
  // text is its parent's too.
  const figures = new Map<string, { sourced: boolean; block: number }>();
  // A proof's block and sentence by their words without spaces: a link put
  // on its claim adds one at the link's edge ("ISO 27001 -certified").
  const proofOf = (block: string, sentence: string) => `${squeeze(block)}\n${squeeze(sentence)}`;
  const ownProof = new Set((proofs ?? []).map((p) => proofOf(p.block, p.sentence)));
  const sourcedIn = (index: number, sentence: string) =>
    all.some(
      (l) =>
        l.block === index && (l.external || ownProof.has(proofOf(blocks[index].text, sentence))),
    );
  const addFigure = (sentence: string, block: number) => {
    const had = figures.get(sentence);
    figures.set(sentence, {
      sourced: (had?.sourced ?? false) || sourcedIn(block, sentence),
      block: had?.block ?? block,
    });
  };
  blocks.forEach((b, index) => {
    for (const sentence of sentencesOf(b.text)) if (hasFigure(sentence)) addFigure(sentence, index);
  });
  // The model's claims (CE-045): each in its block, found by the block's
  // words, else by its own; its sentence counts as a figure's does. A claim
  // no block has any more (written over since it was read) is left out.
  const byRule = new Set(figures.keys());
  const claimed: { text: string; sentence: string; block: number }[] = [];
  for (const block of claims ?? []) {
    const own = blocks.findIndex((b) => b.text === block.text);
    for (const claim of block.claims) {
      const index =
        own !== -1 && blocks[own].text.includes(claim.text)
          ? own
          : blocks.findIndex((b) => b.text.includes(claim.text));
      if (index === -1) continue;
      const sentence =
        sentencesOf(blocks[index].text).find((s) => s.includes(claim.text)) ?? claim.text;
      addFigure(sentence, index);
      claimed.push({ text: claim.text, sentence, block: index });
    }
  }
  // In the page's order: Show, Add source and Remove act on the first.
  const figureSentences = [...figures]
    .map(([sentence, f]) => ({ sentence, ...f }))
    .sort((a, b) => a.block - b.block);
  const unsourced = figureSentences.filter((f) => !f.sourced).map((f) => f.sentence);
  const unsourcedSet = new Set(unsourced);
  const claimedUnsourced = claimed.filter((c) => unsourcedSet.has(c.sentence));
  const claimSentences = new Set(claimedUnsourced.map((c) => c.sentence));
  const marks = [
    ...claimedUnsourced,
    ...figureSentences
      .filter((f) => !f.sourced && !claimSentences.has(f.sentence))
      .map((f) => ({ text: f.sentence, sentence: f.sentence, block: f.block })),
  ]
    .sort((a, b) => a.block - b.block)
    .filter((m, i, list) => list.findIndex((o) => o.text === m.text && o.block === m.block) === i)
    .map(({ text, sentence, block }) => ({ text, sentence, block: blocks[block].text }));
  const aiClaims = unsourced.filter((sentence) => !byRule.has(sentence)).length;
  if (figureSentences.length) {
    checks.push({
      id: 'claimsSourced',
      points:
        (TRUST_WEIGHTS.claimsSourced * (figureSentences.length - unsourced.length)) /
        figureSentences.length,
      max: TRUST_WEIGHTS.claimsSourced,
    });
  }

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - FRESH_MONTHS);
  const sources = byUrl(all.filter((l) => l.external && links.get(l.url)?.date));
  const stale = sources.filter((l) => new Date(links.get(l.url)!.date!) < cutoff);
  if (sources.length) {
    checks.push({
      id: 'freshSources',
      points: (TRUST_WEIGHTS.freshSources * (sources.length - stale.length)) / sources.length,
      max: TRUST_WEIGHTS.freshSources,
    });
  }

  const external = kinds ? byUrl(all.filter((l) => l.external)) : [];
  const classified = external.flatMap((l) => {
    // The rules first; a site they can't place, as the model read it.
    const ruled = sourceClass(l.url, {
      brandDomains,
      competitorDomains: kinds!.competitorDomains,
      pageType: kinds!.pageType,
      trustedDomains: kinds!.trustedDomains,
    });
    const site = normalizeDomain(l.url);
    // A site the model doesn't know is left out, as one the rules can't
    // place; a link the person kept counts as kept, read or not (its site
    // isn't asked about once all its links are: unplacedSites).
    const read = site ? kinds!.ai?.get(site) : undefined;
    const kind =
      ruled ?? (read && read !== 'unknown' ? read : kinds!.kept.has(l.url) ? 'weak' : null);
    return kind && kind !== 'own' ? [{ ...l, kind, ai: ruled === null }] : [];
  });
  const isWeak = (kind: SourceClass): kind is 'weak' | 'competitor' =>
    kind === 'weak' || kind === 'competitor';
  const weak = classified.flatMap(({ url, text, kind, ai }) =>
    isWeak(kind) && !kinds?.kept.has(url) ? [{ url, text, kind, ai }] : [],
  );
  if (classified.length) {
    checks.push({
      id: 'primarySources',
      points: classified.some((l) => l.kind === 'primary') ? TRUST_WEIGHTS.primarySources : 0,
      max: TRUST_WEIGHTS.primarySources,
    });
    checks.push({
      id: 'noWeakSources',
      points: (TRUST_WEIGHTS.noWeakSources * (classified.length - weak.length)) / classified.length,
      max: TRUST_WEIGHTS.noWeakSources,
    });
  }

  const read = byUrl(
    all.filter((l) => {
      const status = links.get(l.url)?.status;
      return status === 'ok' || status === 'broken';
    }),
  );
  const broken = read.filter((l) => links.get(l.url)!.status === 'broken');
  if (read.length) {
    checks.push({
      id: 'noBrokenLinks',
      points: (TRUST_WEIGHTS.noBrokenLinks * (read.length - broken.length)) / read.length,
      max: TRUST_WEIGHTS.noBrokenLinks,
    });
  }

  if (brandFacts && brandFacts.compared > 0) {
    checks.push({
      id: 'brandFacts',
      points:
        (TRUST_WEIGHTS.brandFacts * (brandFacts.compared - brandFacts.mismatches.length)) /
        brandFacts.compared,
      max: TRUST_WEIGHTS.brandFacts,
    });
  }

  for (const id of ['balanced', 'disclosure'] as const) {
    const found = page?.[id];
    if (found)
      checks.push({ id, points: found.found ? TRUST_WEIGHTS[id] : 0, max: TRUST_WEIGHTS[id] });
  }

  if (quote !== null) {
    checks.push({
      id: 'expertQuote',
      points: quote ? TRUST_WEIGHTS.expertQuote : 0,
      max: TRUST_WEIGHTS.expertQuote,
    });
  }

  const shippingSaid = shipping;
  if (shippingSaid) {
    checks.push({
      id: 'shippingReturns',
      points:
        (SHIPPING_POINTS * (Number(shippingSaid.shipping) + Number(shippingSaid.returns))) / 2,
      max: SHIPPING_POINTS,
    });
  }

  if (intro && intro.total > 0) {
    checks.push({
      id: 'introFacts',
      points: (INTRO_POINTS * Math.min(intro.confirmed, intro.total)) / intro.total,
      max: INTRO_POINTS,
    });
  }

  if (feed && feed.compared > 0) {
    checks.push({
      id: 'feedMatch',
      points: (FEED_POINTS * (feed.compared - feed.mismatches.length)) / feed.compared,
      max: FEED_POINTS,
    });
  }

  // The site's 5 points weigh with what the page itself shows: alone, they'd
  // be the page's whole Trust.
  if (siteTrust && checks.length) {
    checks.push({
      id: 'siteTrust',
      points: (TRUST_WEIGHTS.siteTrust * siteTrust.score) / 5,
      max: TRUST_WEIGHTS.siteTrust,
    });
  }

  // A product page's feed check (CE-053) and a category's intro facts (CE-054) are Trust's own too.
  const scored =
    checks.some(
      (c) =>
        c.id === 'claimsSourced' ||
        c.id === 'freshSources' ||
        c.id === 'feedMatch' ||
        c.id === 'introFacts',
    ) || classified.length >= 2;
  return {
    ...(scored ? scoreOf(checks) : { score: null, checks }),
    broken: broken.map(({ url, text }) => ({ url, text })),
    stale: stale.map(({ url, text }) => ({ url, text })),
    dated: sources.length,
    unsourced,
    figures: figureSentences.length,
    marks,
    aiClaims,
    weak,
    classified: classified.length,
    mismatches: brandFacts?.mismatches ?? [],
    shipping: shippingSaid,
    feed: feed?.mismatches ?? [],
  };
}

/**
 * The sites of the page's sources the rules can't place (CE-046, part b):
 * what the editor asks the model about, each once, as the citations name
 * them. A site whose every link the person kept isn't asked about (a kept
 * source counts as it is: trust), nor one the API wouldn't ask about
 * (askableSite).
 */
export function unplacedSites(
  blocks: TrustBlock[],
  brandDomains: string[],
  {
    competitorDomains,
    pageType,
    kept,
    trustedDomains,
  }: Pick<SourceRead, 'competitorDomains' | 'pageType' | 'kept' | 'trustedDomains'>,
): string[] {
  const links = new Map<string, string[]>();
  for (const l of byUrl(pageLinks(blocks, brandDomains).filter((link) => link.external))) {
    const site = normalizeDomain(l.url);
    if (
      site &&
      askableSite(site) &&
      !sourceClass(l.url, { brandDomains, competitorDomains, pageType, trustedDomains })
    ) {
      links.set(site, [...(links.get(site) ?? []), l.url]);
    }
  }
  return [...links].filter(([, urls]) => !urls.every((url) => kept.has(url))).map(([site]) => site);
}
