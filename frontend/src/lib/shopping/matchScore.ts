/**
 * How well a product matches a shopping prompt (#1282, part 1: keywords).
 *
 * In the US, ChatGPT Shopping seems to rank products by keyword match (BM25)
 * and by meaning (embeddings) between the question and the product's title
 * and opening text. This is the keyword half, our own estimate and never
 * ChatGPT's score: BM25 between the prompt's words, with the searches AI ran
 * for it, and each product competing for it. The meaning half needs an
 * embeddings model, so it comes once that is decided.
 *
 * The score runs 0–100: 100 is a product with every one of the query's words,
 * at a typical title length. Words that say what the shopper wants ("best",
 * "buy", "tavsiye") and the usual small words are left out, so they never
 * count, and never show as missing.
 */

const K1 = 1.2;
const B = 0.75;

/** Most terms a query keeps: the prompt's first, then its searches'. */
const MAX_TERMS = 30;

const STOPWORDS = new Set(
  [
    // English: small words, and the shopper's intent rather than the product.
    'a an and are as at be but by can do does for from get has have how i if in into is it its me',
    'my of on or our so than that the their them then there these they this those to under up us',
    'vs versus was we were what when where which who why will with would you your',
    'best top good great cheap cheapest buy buying review reviews recommend recommended',
    'recommendation recommendations need want looking options option alternative alternatives',
    'should could which worth 2024 2025 2026 2027',
    // Turkish.
    'acaba ama bana ben bir bu da daha de en gibi hangi hangisi için ile ise kadar ki mi mı mu mü',
    'ne nedir nasıl olan veya ve ya çok şu tavsiye tavsiyesi öneri önerisi önerir iyi uygun',
    'alırken almak satın alınır',
    // German, French, Spanish, Italian, Dutch: the commonest small words.
    'der die das und oder für mit ein eine einen ist sind welche welcher beste besten',
    'le la les et ou pour avec un une des est sont quel quelle meilleur meilleurs',
    'el la los las y o para con un una es son cuál mejor mejores',
    'il lo gli e o per con uno una è sono quale migliore migliori',
    'de het en of voor met een is zijn welke beste',
  ]
    .join(' ')
    .split(' '),
);

/** A text's words, in order: lowercased (Turkish İ included), letters and digits, two or more. */
function words(text: string): string[] {
  const lower = text
    .normalize('NFKC')
    .toLowerCase()
    // "İ".toLowerCase() leaves a combining dot after the i.
    .replace(/̇/g, '');
  return (lower.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2 || /^\d$/.test(w));
}

/** A word as it's matched: a plain English plural as its singular ("boots" and "boot"). */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** A text's content words, as matched: no small or intent words. */
export function contentWords(text: string): string[] {
  return words(text)
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
}

/**
 * A prompt's query: its content words, then those of the searches AI ran
 * for it, each once, at most MAX_TERMS.
 */
export function queryTerms(prompt: string, searches: readonly string[] = []): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const text of [prompt, ...searches]) {
    for (const term of contentWords(text)) {
      if (seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
      if (terms.length === MAX_TERMS) return terms;
    }
  }
  return terms;
}

/**
 * Each product's score for a query, 0–100: BM25 over the products competing
 * for it (k1 1.2, b 0.75), against a product that has each of the query's
 * words once at the average length. With no query words, every score is 0.
 */
export function matchScores(terms: readonly string[], products: readonly string[]): number[] {
  const docs = products.map(contentWords);
  const unique = [...new Set(terms)];
  if (!unique.length || !docs.length) return docs.map(() => 0);
  const avgLength = Math.max(1, docs.reduce((sum, d) => sum + d.length, 0) / docs.length);
  const idf = new Map(
    unique.map((term) => {
      const df = docs.filter((d) => d.includes(term)).length;
      return [term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
    }),
  );
  // With each word once at the average length, a word's part is its idf.
  const ideal = unique.reduce((sum, term) => sum + idf.get(term)!, 0);
  return docs.map((doc) => {
    const norm = K1 * (1 - B + (B * doc.length) / avgLength);
    let score = 0;
    for (const term of unique) {
      const tf = doc.filter((w) => w === term).length;
      if (tf) score += (idf.get(term)! * tf * (K1 + 1)) / (tf + norm);
    }
    return Math.min(100, Math.round((100 * score) / ideal));
  });
}

/** The query's words a product's text doesn't have, in the query's order. */
export function missingWords(terms: readonly string[], product: string): string[] {
  const has = new Set(contentWords(product));
  return [...new Set(terms)].filter((term) => !has.has(term));
}

/** Two product titles name the same product: case, spaces and punctuation aside. */
export function sameProduct(a: string, b: string): boolean {
  return words(a).join(' ') === words(b).join(' ');
}
