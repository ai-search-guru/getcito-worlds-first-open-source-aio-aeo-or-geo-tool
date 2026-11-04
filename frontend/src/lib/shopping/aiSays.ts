import { answerProse, mentionExcerpt, namesAny } from '@/lib/mentionMatch';
import { sentencesOf } from '@/lib/content/readability';

/**
 * "What AI says" about a product (ECOM-012, V1): the answers that showed it,
 * quoted where they name it, and the sources they cited. Their own words
 * only, read as Mentions reads them: no AI of ours sums them up, so no
 * cost. Pros and cons drawn from them come later.
 */

/** An answer that showed the product, as "What AI says" reads it. */
export interface AiSaysAnswer {
  promptResultId: string;
  platform: string;
  at: string;
  promptText: string | null;
  response: string;
  /** How the answer's cards titled the product. */
  titles: string[];
}

export interface AiSaysQuote {
  text: string;
  platform: string;
  at: string;
  promptText: string | null;
}

export interface AiSaysSource {
  url: string;
  domain: string;
  title: string | null;
  /** The answers that showed the product and cited it. */
  answers: number;
}

export interface ProductAiSays {
  /** The answers that showed the product in the period. */
  answers: number;
  quotes: AiSaysQuote[];
  sources: AiSaysSource[];
}

export const MAX_QUOTES = 5;
export const MAX_SOURCES = 5;

/** Where a title's parts meet: its name, its variant, its brand ("Ridge 30L Backpack - Black"). */
const TITLE_TAIL = /\s+[-–—|:,(/]\s*|\s*[|,(]\s*/;

const spaced = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The names an answer may call the product by: each title, and the
 * product's own name in it, without its variant or its brand. A title's
 * parts split at " - ", " | ", ",", ":" or "(": a part that is the brand
 * ("The North Face | Borealis Backpack") is left out, and a brand opening a
 * part is cut off ("The North Face Borealis Backpack" → "Borealis
 * Backpack"); the first part left is the name when it keeps two words or
 * more. The brand alone is never a name: every sentence about the brand
 * would quote as the product's.
 *
 * @param brands the product's brand as the catalog and the cards name it
 */
export function productNames(
  titles: readonly string[],
  brands: readonly (string | null | undefined)[] = [],
): string[] {
  const brandKeys = [
    ...new Set(brands.map((brand) => spaced(brand ?? '').toLowerCase()).filter(Boolean)),
  ];
  const isBrand = (text: string) => brandKeys.includes(text.toLowerCase());
  const withoutBrand = (part: string) => {
    const lower = part.toLowerCase();
    const brand = brandKeys.find((key) => lower.startsWith(`${key} `));
    return brand ? part.slice(brand.length).trim() : part;
  };
  const names = new Set<string>();
  for (const title of titles) {
    const full = spaced(title);
    if (!full || isBrand(full)) continue;
    names.add(full);
    const own = full
      .split(TITLE_TAIL)
      .map((part) => part.trim())
      .filter((part) => part && !isBrand(part))
      .map(withoutBrand)[0];
    if (own && own.split(' ').length >= 2 && !isBrand(own)) names.add(own);
  }
  return [...names];
}

/** The answer's first sentence that names the product, cut around the name; null when none does. */
export function productQuote(response: string, names: string[]): string | null {
  if (!names.length) return null;
  const sentence = sentencesOf(answerProse(response)).find((s) => namesAny(s, names));
  return sentence ? mentionExcerpt(sentence, names) : null;
}

/**
 * What the answers said: a quote from each, the latest first, one per text,
 * and the sources most of them cited. `titles`: the catalog's own, beside
 * how each answer's cards titled it; `total`: the answers that showed the
 * product, when more than those read; `brands`: the product's brand, kept
 * out of the names it's looked for by (productNames).
 */
export function productAiSays(
  answers: readonly AiSaysAnswer[],
  citations: readonly {
    promptResultId: string;
    url: string;
    domain: string;
    title: string | null;
  }[],
  titles: readonly string[],
  total: number = answers.length,
  brands: readonly (string | null | undefined)[] = [],
): ProductAiSays {
  const latest = [...answers].sort((a, b) => (a.at < b.at ? 1 : -1));
  const quotes: AiSaysQuote[] = [];
  const said = new Set<string>();
  for (const answer of latest) {
    if (quotes.length >= MAX_QUOTES) break;
    const text = productQuote(answer.response, productNames([...answer.titles, ...titles], brands));
    if (!text || said.has(text)) continue;
    said.add(text);
    quotes.push({
      text,
      platform: answer.platform,
      at: answer.at,
      promptText: answer.promptText,
    });
  }
  const cited = new Map<string, AiSaysSource & { by: Set<string> }>();
  for (const citation of citations) {
    const source = cited.get(citation.url) ?? {
      url: citation.url,
      domain: citation.domain,
      title: citation.title,
      answers: 0,
      by: new Set<string>(),
    };
    source.by.add(citation.promptResultId);
    cited.set(citation.url, source);
  }
  const sources = [...cited.values()]
    .map(({ by, ...source }) => ({ ...source, answers: by.size }))
    .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain))
    .slice(0, MAX_SOURCES);
  return { answers: total, quotes, sources };
}
