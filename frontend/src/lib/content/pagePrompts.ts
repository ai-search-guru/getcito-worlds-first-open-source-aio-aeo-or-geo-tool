import { wordsOf } from './sources';

/**
 * The tracked prompts a page brought in to optimize answers (Content Agent
 * rule gaps, E). A page pasted, read from its URL or from a file starts with
 * no prompts, so the Sources tab and the fan-out rules had no fan-outs for it
 * ("No fan-outs") unless AI answers cited that very page. It now starts with
 * the brand's prompts its title and headings speak to; the person can leave
 * any of them out in Sources.
 */

/** The most prompts such a draft starts with. */
export const MAX_PAGE_PROMPTS = 10;
/** The share of a prompt's words the page's title and headings must use… */
const PROMPT_OVERLAP = 0.6;
/** …and at least this many of them: one shared word is chance. */
const MIN_SHARED_WORDS = 2;

/** A page's title and headings (H1–H3), as words. Read from its HTML on the server. */
export function pageHeadingWords(title: string, html: string): Set<string> {
  const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) =>
    m[2].replace(/<[^>]*>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' '),
  );
  return new Set(wordsOf([title, ...headings].join(' ')));
}

/**
 * The prompts whose words the page's title and headings use the most, the
 * most words in common first: at least PROMPT_OVERLAP of each prompt's words
 * and MIN_SHARED_WORDS of them, up to `max`.
 */
export function matchPagePrompts(
  title: string,
  html: string,
  prompts: { id: string; text: string }[],
  max = MAX_PAGE_PROMPTS,
): string[] {
  const page = pageHeadingWords(title, html);
  return (
    prompts
      .map((prompt) => {
        const words = [...new Set(wordsOf(prompt.text))];
        const shared = words.filter((word) => page.has(word)).length;
        return { id: prompt.id, shared, share: words.length ? shared / words.length : 0 };
      })
      .filter((m) => m.shared >= MIN_SHARED_WORDS && m.share >= PROMPT_OVERLAP)
      // More words in common first: a short, broad prompt matches too easily.
      .sort((a, b) => b.shared - a.shared || b.share - a.share)
      .slice(0, max)
      .map((m) => m.id)
  );
}
