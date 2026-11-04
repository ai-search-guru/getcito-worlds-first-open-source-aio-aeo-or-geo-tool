/**
 * Locked passages (Content Editor spec v2 §8, CE-018): the passages of a page
 * AI answers quote today, from the answers that cite it
 * (content_draft_cited_answers, 00216). A person is warned before changing
 * one; agents never change them.
 *
 * A passage is quoted when an answer has a run of QUOTE_WORDS of its words in
 * a row, as written: answers reword most of what they read, so a run that
 * long is the wording kept. A shorter passage counts when the answer has all
 * of it. Words compare without case, punctuation or Markdown.
 */

/** The window the answers are read over. */
export const CITED_DAYS = 30;

/** A run of this many words in a row, as the page has them, is a quote. */
export const QUOTE_WORDS = 8;

/** Passages shorter than this are too common to call a quote (headings, labels). */
export const MIN_PASSAGE_WORDS = 6;

/** The most passages a page sends to be checked. */
export const MAX_PASSAGES = 1000;

/** An answer that cites the page. */
export interface CitedAnswer {
  platform: string;
  response: string;
}

/** A passage AI answers quote, by its key, with the answers quoting it per platform. */
export interface CitedPassage {
  key: string;
  /** Platforms by answers quoting the passage, the most first. */
  platforms: { platform: string; answers: number }[];
}

/** A text's words, lowercase, without punctuation or Markdown. */
export function passageWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The passage as it is compared: its words, one space apart. */
export function passageKey(text: string): string {
  return passageWords(text).join(' ');
}

/** Each run of n words in a row. */
function runs(words: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * The passages the answers quote, each with how many answers on each
 * platform quote it. Passages are matched by key, so one written twice is
 * one passage.
 */
export function quotedPassages(passages: string[], answers: CitedAnswer[]): CitedPassage[] {
  // Each passage's runs, and which passages each run belongs to; only these
  // runs are looked for in the answers.
  const byRun = new Map<string, Set<string>>();
  const lengths = new Set<number>();
  for (const text of passages.slice(0, MAX_PASSAGES)) {
    const words = passageWords(text);
    if (words.length < MIN_PASSAGE_WORDS) continue;
    const key = words.join(' ');
    const n = Math.min(QUOTE_WORDS, words.length);
    lengths.add(n);
    for (const run of runs(words, n)) {
      const keys = byRun.get(run) ?? new Set<string>();
      keys.add(key);
      byRun.set(run, keys);
    }
  }
  if (byRun.size === 0) return [];

  const counts = new Map<string, Map<string, number>>();
  for (const answer of answers) {
    const words = passageWords(answer.response);
    const quoted = new Set<string>();
    for (const n of lengths) {
      for (const run of runs(words, n)) {
        for (const key of byRun.get(run) ?? []) quoted.add(key);
      }
    }
    for (const key of quoted) {
      const byPlatform = counts.get(key) ?? new Map<string, number>();
      byPlatform.set(answer.platform, (byPlatform.get(answer.platform) ?? 0) + 1);
      counts.set(key, byPlatform);
    }
  }

  return [...counts].map(([key, byPlatform]) => ({
    key,
    platforms: [...byPlatform]
      .map(([platform, n]) => ({ platform, answers: n }))
      .sort((a, b) => b.answers - a.answers || a.platform.localeCompare(b.platform)),
  }));
}
