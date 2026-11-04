/**
 * Whether a product description's opening is one an AI shopping assistant
 * can match to a question (#1279). ChatGPT appears to read only about the
 * first 50 tokens of a description, about 40 words or 250 characters
 * (public research presented at brightonSEO 2026, from a few test prompts;
 * to be confirmed by our own tests). An opening that tells the brand's story
 * and names the product type later may never be matched.
 *
 * Pure: the Site Audit signal runs it on product pages today, and the
 * catalog and the Content Editor can run it on descriptions later. Every
 * rule is here, so they agree.
 */

/** Where the reader stops: whichever of these ends first. */
export const OPENING = Object.freeze({ words: 40, chars: 250 });

/** Key attributes the opening needs beside the product type. */
export const MIN_ATTRIBUTES = 2;

/**
 * A number with its unit: 268 g, 6 mm, 30 L, 15.6", 5000 mAh, 100%. A bare
 * "in" isn't one ("3 in stock"); inches are written out or as ".
 */
const MEASURE =
  /(?<![\p{L}\p{N}.,])\d+(?:[.,]\d+)?\s?(?:mm|cm|km|m|mg|kg|g|lbs?|oz|ml|cl|l|inch(?:es)?|ft|"|w|kw|v|mah|wh|gb|tb|hz|ghz|mp|%)(?![\p{L}\p{N}])/giu;

/** What a product is made of. */
const MATERIALS = [
  'organic cotton',
  'cotton',
  'merino wool',
  'wool',
  'cashmere',
  'linen',
  'silk',
  'full-grain leather',
  'leather',
  'suede',
  'denim',
  'canvas',
  'nylon',
  'polyester',
  'fleece',
  'mesh',
  'gore-tex',
  'elastane',
  'spandex',
  'rubber',
  'memory foam',
  'foam',
  'silicone',
  'glass',
  'ceramic',
  'porcelain',
  'stainless steel',
  'steel',
  'aluminium',
  'aluminum',
  'titanium',
  'carbon fiber',
  'carbon fibre',
  'oak',
  'walnut',
  'bamboo',
  'recycled',
];

/** How it fits; ambiguous words only in their fit phrase ("wide fit", not "a wide range"). */
const FITS = [
  'slim fit',
  'slim-fit',
  'slim',
  'regular fit',
  'relaxed fit',
  'loose fit',
  'oversized',
  'tapered',
  'straight leg',
  'straight-leg',
  'skinny',
  'wide fit',
  'wide-leg',
  'narrow fit',
  'fitted',
  'true to size',
  'four-way stretch',
  'stretch',
  'high-rise',
  'mid-rise',
  'low-rise',
];

/** What it's for, or what it does in use. */
const USES = [
  'running',
  'trail',
  'hiking',
  'walking',
  'training',
  'gym',
  'yoga',
  'cycling',
  'swimming',
  'travel',
  'outdoor',
  'everyday',
  'office',
  'gaming',
  'camping',
  'winter',
  'summer',
  'waterproof',
  'water-resistant',
  'windproof',
  'breathable',
  'lightweight',
  'cushioned',
  'insulated',
  'wireless',
  'rechargeable',
  'portable',
  'dishwasher-safe',
  'machine-washable',
];

/**
 * Every term, longest first, so "organic cotton" is one attribute, not two.
 * Terms are letters, spaces and hyphens only, so they go into a pattern as
 * they are.
 */
const TERMS = [...MATERIALS, ...FITS, ...USES]
  .sort((a, b) => b.length - a.length)
  .map((term) => ({
    term,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}-])${term}(?![\\p{L}\\p{N}-])`, 'u'),
  }));

/** Words of a product's name that say nothing about what it is. */
const NAME_NOISE = new Set(['the', 'a', 'an', 'and', 'for', 'with', 'of', 'by', 'in', 'new']);

const lower = (text) => String(text ?? '').toLowerCase();

/** A word's form for matching: lowercase, without a possessive or plural "s". */
function stem(word) {
  return lower(word)
    .replace(/[’']s$/, '')
    .replace(/(?<=\p{L}{2}[^s])s$/u, '');
}

/** The words of a text, each with where it ends. */
function wordsOf(text) {
  return [...String(text).matchAll(/\S+/g)].map((m) => ({
    word: m[0],
    end: m.index + m[0].length,
  }));
}

/** The words of a text as stems, punctuation trimmed. */
function stemsOf(text) {
  return wordsOf(text)
    .map(({ word }) => stem(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')))
    .filter(Boolean);
}

/**
 * The product type from its name: the name's words without the brand's,
 * without model codes and numbers (Speedgoat 5, X-200) and filler.
 * "Acme Men's Trail Running Shoes" by Acme → men, trail, running, shoe.
 */
export function productTypeWords(productName, brand) {
  const brandStems = new Set(stemsOf(brand));
  return [
    ...new Set(
      stemsOf(productName).filter(
        (word) =>
          !brandStems.has(word) && !NAME_NOISE.has(word) && !/\d/.test(word) && word.length > 1,
      ),
    ),
  ];
}

/** Where the opening of `text` ends: at 40 words or 250 characters, whichever comes first. */
export function openingCut(text) {
  const all = String(text);
  const words = wordsOf(all);
  const byWords = words.length > OPENING.words ? words[OPENING.words - 1].end : all.length;
  return Math.min(byWords, OPENING.chars);
}

/**
 * The key attributes an opening names: measures, materials, fits and uses,
 * each once. A word of the product type isn't an attribute too: "running" in
 * a running shoe's opening says what it is, not something more.
 */
export function attributesIn(opening, typeWords = []) {
  const text = lower(opening);
  const typeStems = new Set(typeWords);
  const found = [...text.matchAll(MEASURE)].map((match) => match[0].replace(/\s+/g, ' ').trim());
  for (const { term, pattern } of TERMS) {
    if (term.split(/\s+/).every((word) => typeStems.has(stem(word)))) continue;
    if (found.some((f) => f.includes(term))) continue;
    if (pattern.test(text)) found.push(term);
  }
  return found;
}

/**
 * @param {{ description: string, productName?: string|null, brand?: string|null }} input
 * @returns {{
 *   opening: string,
 *   cut: number,
 *   typeWords: string[],
 *   namesType: boolean|null,
 *   attributes: string[],
 *   passes: boolean,
 * }} `cut` is where the opening ends in the description with its spaces
 *   collapsed. `namesType` is null when the name says nothing of the type
 *   (only a brand and a model), so only the attributes can be judged.
 */
export function checkDescriptionOpening({ description, productName = '', brand = '' }) {
  const text = String(description ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = openingCut(text);
  const opening = text.slice(0, cut);
  const typeWords = productTypeWords(productName, brand);
  const openingStems = new Set(stemsOf(opening));
  const named = typeWords.filter((word) => openingStems.has(word)).length;
  const namesType = typeWords.length === 0 ? null : named >= Math.ceil(typeWords.length / 2);
  const attributes = attributesIn(opening, typeWords);
  return {
    opening,
    cut,
    typeWords,
    namesType,
    attributes,
    passes: namesType !== false && attributes.length >= MIN_ATTRIBUTES,
  };
}
