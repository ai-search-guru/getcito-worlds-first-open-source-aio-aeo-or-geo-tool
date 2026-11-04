import { pagePrices, priceRanges } from './brandFacts';
import { languageCode, ownText, sentencesOf } from './readability';
import { parseHtml } from './dom';

/**
 * A category page's intro facts (Content Editor Quality spec §11, Phase 3,
 * CE-054): Trust counts "correct counts and price range", and the typical
 * to-do is "Confirm intro facts". How many products the category has and
 * what they cost are the brand's own: no source says them, so only the
 * person can confirm them (00280's confirmations, kind intro_fact), as a
 * customer case is confirmed (CE-052).
 *
 * A confirm is kept by the facts themselves ("120+", "USD49-199"), not the
 * sentence's words: rewording the intro keeps it, and a changed number asks
 * again for that fact alone.
 */

/** A sentence of the intro that states counts or prices, each as its fact. */
export interface IntroFact {
  sentence: string;
  /** Its facts: a count ("120+", "50") or a price ("USD49", "USD49-199"). */
  facts: string[];
}

/** Before a number, a word that says it counts what the category has: "over 50", "choose from 24". */
const COUNT_WORDS = String.raw`over|more\s+than|nearly|almost|choose\s+from|shop|browse|explore|discover|über|mehr\s+als|plus\s+de|más\s+de|oltre|mais\s+de|meer\s+dan`;
/**
 * A count: its leading word, the number, a "+" or "'den fazla", and the
 * word or two it counts ("120+ daypacks", "over 50 styles", "50'den fazla
 * model", "24 colours").
 */
const COUNT = new RegExp(
  String.raw`(?<lead>(?<!\p{L})(?:${COUNT_WORDS})\s+)?(?<![\d.,])(?<n>\d[\d.,]*)(?<more>\+|['’]?(?:den|dan|ten|tan)\s+fazla)?\s+(?<w1>\p{L}+)(?:\s+(?<w2>\p{L}+))?`,
  'giu',
);
/** Products a number names outright, in the languages read: a count with no other word. */
const PRODUCT_WORDS =
  /^(?:products|items|styles|models|designs|colou?rs|options|brands|pieces|ürün|ürünü|model|çeşit|renk|produkte|modelle|artikel|produits|modèles|productos|modelos|prodotti|modelli)$/iu;
/**
 * What a number counts that isn't the category's products: time, distance,
 * weight, volume, an age, steps or ways ("Over 10 years of experience",
 * "4+ hours of battery", "Explore 5 trails").
 */
const NOT_PRODUCTS =
  /^(?:years?|yrs?|hours?|hrs?|minutes?|mins?|days?|weeks?|months?|km|kms|kilomet(?:er|re)s?|mi|miles?|met(?:er|re)s?|m|cm|mm|kg|g|lbs?|oz|l|lit(?:er|re)s?|ml|ways?|steps?|tips?|reasons?|trails?|routes?|stars?|reviews?|customers?|people|countries|cities|stores?|jahre?n?|stunden?|tage?n?|minuten|ans|heures?|jours?|años?|horas?|días?|anni|ore|giorni|yıl|yıldır|saat|gün|adım|kişi|müşteri)$/iu;
/** Just before a number, what makes it no count: "SPF 50+", "ages 3+", "size 10", "No. 5". */
const NOT_A_COUNT_BEFORE = /(?<!\p{L})(?:spf|ages?|size|sizes|no\.|nr\.|#|model|version|v)\s*$/iu;
/** A sentence of another bill: a price in it isn't the category's ("Free shipping over $50"). */
const SHIPPING =
  /(?<!\p{L})(?:shipping|delivery|postage|versand\p{L}*|livraison|env[ií]os?|kargo\p{L}*|frete|üzeri)(?!\p{L})/iu;

/** The counts a sentence states, each as its fact ("120+", "50"). */
function countsIn(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(COUNT)) {
    const g = m.groups!;
    const n = g.n.replace(/[.,]/g, '');
    const word = g.w1.toLowerCase();
    const before = sentence.slice(0, m.index + (g.lead?.length ?? 0));
    if (NOT_PRODUCTS.test(word) || NOT_A_COUNT_BEFORE.test(before)) continue;
    // A year isn't a count: "Shop 2026 styles", "Since 2009".
    if (!g.more && /^(?:19|20)\d{2}$/.test(n)) continue;
    const named = PRODUCT_WORDS.test(word) || (!!g.w2 && PRODUCT_WORDS.test(g.w2));
    if (!g.lead && !g.more && !named) continue;
    out.push(`${n}${g.lead || g.more ? '+' : ''}`);
  }
  return out;
}

/** The prices a sentence states with their currency, each as its fact ("USD49", "USD49-199"). */
function pricesIn(sentence: string): string[] {
  if (SHIPPING.test(sentence)) return [];
  const ranges = priceRanges(sentence);
  const inRange = (at: number) => ranges.some((r) => at >= r.at && at < r.at + r.text.length);
  return [
    ...ranges.map((r) => `${r.currency}${r.low}-${r.high}`),
    ...pagePrices(sentence, { rangeEnds: true })
      .filter((p) => !inRange(p.at))
      .map((p) => `${p.currency}${p.amount}`),
  ];
}

/**
 * The facts a category page's intro states: its sentences between the H1
 * and the first H2 (the Rules tab's intro), in the page's language, with a
 * count or a price (with its currency: "from 20 to 40 litres" isn't one),
 * each sentence once.
 */
export function introFacts(html: string, language: string | null = 'en'): IntroFact[] {
  // The content DOM's parser (dom.ts): the browser's, or jsdom's on the server (go-live gate).
  const doc = parseHtml(html);
  const blocks = [...doc.body.querySelectorAll('h1, h2, p, li')];
  const h1 = blocks.findIndex((el) => el.tagName === 'H1');
  const intro: string[] = [];
  for (const el of blocks.slice(h1 + 1)) {
    if (el.tagName === 'H2') break;
    // A paragraph in a list item is read with it.
    if (el.tagName === 'H1' || (el.tagName === 'P' && el.closest('li'))) continue;
    const text = ownText(el).replace(/\s+/g, ' ').trim();
    if (text) intro.push(text);
  }
  const seen = new Set<string>();
  return intro
    .flatMap((text) => sentencesOf(text, languageCode(language)))
    .flatMap((sentence) => {
      const facts = [...new Set([...countsIn(sentence), ...pricesIn(sentence)])];
      if (!facts.length || seen.has(sentence)) return [];
      seen.add(sentence);
      return [{ sentence, facts }];
    });
}

/** The longest key a confirmation keeps (00280). */
const KEY_CHARS = 400;

/**
 * The confirmations for facts confirmed together: their facts, sorted, as
 * few keys as fit ("intro:120+,USD49-199"): one row a confirm, however many
 * sentences state them.
 */
export function introConfirmKeys(facts: readonly string[]): string[] {
  const keys: string[] = [];
  let key = '';
  for (const fact of [...new Set(facts)].sort()) {
    const next = key ? `${key},${fact}` : `intro:${fact}`;
    if (next.length > KEY_CHARS && key) {
      keys.push(key);
      key = `intro:${fact}`;
    } else {
      key = next;
    }
  }
  return key ? [...keys, key] : keys;
}

/** The facts the person confirmed, from their intro_fact confirmations' keys. */
export function confirmedFacts(keys: Iterable<string>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith('intro:')) continue;
    for (const fact of key.slice('intro:'.length).split(',')) out.add(fact);
  }
  return out;
}
