import type { PageType } from './drafts';
import { SITE_PAGE_TYPES, detectPageType, type SiteType } from './pageTypes';

/** Content brought to optimize, as New content shows it before the editor. */
export interface ContentSummary {
  /** Its first heading, or what stands in for one. */
  title: string;
  headings: number;
  characters: number;
}

/** Elements that end a line of text: their words don't run into the next. */
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, div, br';

/**
 * What pasted or uploaded content holds (CE-003): its title (the first
 * heading, else the file's name, else its first paragraph), how many
 * headings and how much text. Read in the browser, from HTML already cleaned.
 */
export function summarizeContent(html: string, fallbackTitle = ''): ContentSummary {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const heading = textOf(doc.querySelector('h1, h2, h3'));
  const firstBlock = textOf(doc.querySelector('p, li, td, blockquote'));
  for (const block of doc.body.querySelectorAll(BLOCKS)) block.append(' ');
  const text = textOf(doc.body);
  return {
    title: heading || fallbackTitle || openingWords(firstBlock || text),
    headings: doc.querySelectorAll('h1, h2, h3').length,
    characters: text.length,
  };
}

/** The first words of a text, cut at a word near 80 characters. */
function openingWords(text: string, max = 80): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}

/** "Q3 brief.docx" → "Q3 brief". */
export function fileTitle(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').trim();
}

/**
 * The page type Start picks first (CE-015): the one the page's address,
 * content or title shows, else a blog post, which every kind of site writes.
 */
export function startPageType(
  page: { title: string; html?: string; url?: string },
  siteType: SiteType,
): { pageType: PageType; detected: boolean } {
  const detected = detectPageType(page, siteType);
  if (detected) return { pageType: detected, detected: true };
  const fallback: PageType = SITE_PAGE_TYPES[siteType].includes('blog_post')
    ? 'blog_post'
    : SITE_PAGE_TYPES[siteType][0];
  return { pageType: fallback, detected: false };
}
