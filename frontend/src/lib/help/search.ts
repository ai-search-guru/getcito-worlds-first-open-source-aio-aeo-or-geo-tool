import approved from './approved-articles.json';
import type { HelpArticle, HelpPlan, HelpSection } from './articles';

/**
 * Help retrieval for Chat (CHAT-19 §5 step 3; Chat Wave 1 W1-30): the
 * sections of the approved Help articles that a how-to question's words
 * match, by keyword only (decided 2026-10-29: no embeddings in Wave 1).
 *
 * Chat reads only approved articles (`approved: true`), from
 * approved-articles.json: the repo's /help folder isn't part of the web
 * app's build, so the approved ones are kept here, and a test keeps the file
 * in step with /help (search.test.ts; refresh it with `yarn test -u
 * src/lib/help`). Pure: no database, no model.
 */

/** An approved article as Chat reads it. */
export interface HelpIndexArticle {
  /** {area}/{slug} */
  id: string;
  title: string;
  /** The page it is about, which the answer's source line opens. */
  route: string;
  keywords: string[];
  synonyms: string[];
  plan: HelpPlan;
  /** YYYY-MM-DD */
  updated: string;
  sections: HelpSection[];
}

export interface HelpIndex {
  articles: HelpIndexArticle[];
}

/** The approved articles, in id order: what approved-articles.json holds. */
export function buildHelpIndex(articles: readonly HelpArticle[]): HelpIndex {
  return {
    articles: articles
      .filter((article) => article.meta.approved === true)
      .map((article) => ({
        id: `${article.area}/${article.slug}`,
        title: String(article.meta.title ?? ''),
        route: String(article.meta.route ?? ''),
        keywords: [...(article.meta.keywords ?? [])],
        synonyms: [...(article.meta.synonyms ?? [])],
        plan: article.meta.plan ?? 'all',
        updated: String(article.meta.updated ?? ''),
        sections: article.sections.map((s) => ({ heading: s.heading, text: s.text })),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export const HELP_INDEX: HelpIndex = approved as HelpIndex;

/** An article answers only at this score or above: a keyword or synonym, or three title words. */
export const HELP_MIN_SCORE = 3;
/** Sections an answer is written from (§5: the top 2–3 only). */
export const HELP_MAX_SECTIONS = 3;
/** Articles an answer draws on at most. */
export const HELP_MAX_ARTICLES = 2;

/** Words that say nothing about what is asked. */
const STOPWORDS = new Set(
  (
    'a an the to do does did done i we you he she they it its my our your their me us them ' +
    'how where what which when who why can could should would will is are was were be been ' +
    'in on at of for with from by and or not no this that these those there here please ' +
    'into onto about find see get go going want need way some any all one getcito app page tab'
  ).split(' '),
);

/** A word as matching sees it: lower case, a plural's s off. */
const stem = (word: string) =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

/** The words of a text that carry meaning, stemmed. */
export function helpWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !STOPWORDS.has(word))
    .map(stem);
}

export interface HelpMatch {
  article: HelpIndexArticle;
  section: HelpSection;
  score: number;
}

export interface HelpSearch {
  /** The sections to answer from, best first; empty when nothing matched well enough. */
  matches: HelpMatch[];
  /** The closest article and its score, for the gap log; null when nothing matched at all. */
  best: { id: string; score: number } | null;
}

/**
 * How well an article's own words match the question: each keyword or
 * synonym whose every word is asked (2, plus 1 a word: longer phrases say
 * more), and each title word asked (1).
 */
function articleScore(article: HelpIndexArticle, asked: ReadonlySet<string>): number {
  let score = 0;
  for (const phrase of [...article.keywords, ...article.synonyms]) {
    const words = helpWords(phrase);
    if (words.length > 0 && words.every((word) => asked.has(word))) score += 2 + words.length;
  }
  for (const word of new Set(helpWords(article.title))) {
    if (asked.has(word)) score += 1;
  }
  return score;
}

/**
 * A section's own match: each asked word it holds, weighted by how few of
 * the index's sections hold it (a word every section has says little), half
 * again in its heading.
 */
function sectionScore(
  section: HelpSection,
  asked: ReadonlySet<string>,
  weight: (word: string) => number,
): number {
  const heading = new Set(helpWords(section.heading ?? ''));
  const text = new Set(helpWords(section.text));
  let score = 0;
  for (const word of asked) {
    if (heading.has(word)) score += 1.5 * weight(word);
    else if (text.has(word)) score += weight(word);
  }
  return score;
}

/** Each word's weight in this index: ln(1 + sections / sections holding it). */
function wordWeights(index: HelpIndex, asked: ReadonlySet<string>) {
  const sections = index.articles.flatMap((article) => article.sections);
  const holding = new Map<string, number>();
  for (const section of sections) {
    const words = new Set(helpWords(`${section.heading ?? ''} ${section.text}`));
    for (const word of asked) if (words.has(word)) holding.set(word, (holding.get(word) ?? 0) + 1);
  }
  return (word: string) => Math.log(1 + sections.length / Math.max(1, holding.get(word) ?? 0));
}

/**
 * The Help sections a question matches (§5 step 3): from the articles that
 * score HELP_MIN_SCORE or more, the best HELP_MAX_SECTIONS sections, from
 * HELP_MAX_ARTICLES articles at most. No match below that: Chat doesn't
 * guess (§5), it logs the gap.
 */
export function searchHelp(question: string, index: HelpIndex = HELP_INDEX): HelpSearch {
  const asked = new Set(helpWords(question));
  if (asked.size === 0) return { matches: [], best: null };
  const scored = index.articles
    .map((article, order) => ({ article, order, score: articleScore(article, asked) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const best = scored[0] ? { id: scored[0].article.id, score: scored[0].score } : null;
  const articles = scored
    .filter((entry) => entry.score >= HELP_MIN_SCORE)
    .slice(0, HELP_MAX_ARTICLES);
  const weight = wordWeights(index, asked);
  const matches = articles
    .flatMap(({ article, order, score }) =>
      article.sections.map((section, at) => ({
        article,
        section,
        score: score + sectionScore(section, asked, weight),
        order: order * 1000 + at,
      })),
    )
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, HELP_MAX_SECTIONS)
    .map(({ article, section, score }) => ({ article, section, score }));
  return { matches, best };
}
