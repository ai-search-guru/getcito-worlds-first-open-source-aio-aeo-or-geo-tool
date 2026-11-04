import { ELEMENT_NODE, TEXT_NODE, parseHtml } from './dom';

/**
 * Placeholders in a page (Content Editor Quality spec §4, §9, CE-044): words
 * in square brackets where a real name, quote or number goes — what the
 * Content Agent leaves when it had none ("[figure, source]", "[name of a
 * real person]") — for the person to fill. Only they can: a to-do in
 * Quality. An export never ships one (CE-057).
 */

/**
 * Words in square brackets with a letter and more than one character in
 * them; not a footnote ("[1]"), a checkbox ("[x]"), "[sic]", or a Markdown
 * link's text ("[docs](https://…)").
 */
export const PLACEHOLDER = /\[(?!sic\])(?=[^[\]\n]*\p{L})[^[\]\n]{2,}\](?!\()/giu;

/**
 * The forms the server's guards write in a page (the number guard's
 * "[figure, source]", contentPeople.js's name and quote): in a title or a
 * heading, only these are placeholders. Brackets a person writes there
 * ("Best CRM tools [2026 Update]", "[PDF]") are part of the title. The
 * writer's prompts let the model write others too ("[price]"); in a heading
 * they read as written.
 */
export const AGENT_PLACEHOLDER =
  /\[(?:figure, source[^[\]\n]*|name of a real person|quote from a real person[^[\]\n]*)\](?!\()/giu;

/** The placeholders a line is read for: a heading's (and a title's) are the agent's forms only. */
export const placeholderIn = (heading: boolean) => (heading ? AGENT_PLACEHOLDER : PLACEHOLDER);

export interface PagePlaceholders {
  count: number;
}

/** Elements inside a line of text: what a list item's own words are made of. */
const INLINE = /^(A|STRONG|EM|B|I|U|S|SPAN|CODE|MARK|SUB|SUP|SMALL|BR)$/;

/** A list item's own words: its text and inline elements, not the blocks inside it. */
function itemOwnText(li: Element): string {
  let text = '';
  for (const node of li.childNodes) {
    if (node.nodeType === TEXT_NODE) text += node.textContent ?? '';
    else if (node.nodeType === ELEMENT_NODE && INLINE.test((node as Element).tagName))
      text += node.textContent ?? '';
  }
  return text;
}

/**
 * The page's placeholders. The editor keeps every line of text in a
 * paragraph or a heading (in lists, quotes and tables too), so each is read
 * once there; a list item written without one (an agent's rewrite) is read
 * by its own words.
 */
export function pagePlaceholders(html: string): PagePlaceholders {
  const doc = parseHtml(html);
  let count = 0;
  for (const el of doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')) {
    const text = el.tagName === 'LI' ? itemOwnText(el) : (el.textContent ?? '');
    count += text.match(placeholderIn(/^H\d$/.test(el.tagName)))?.length ?? 0;
  }
  return { count };
}
