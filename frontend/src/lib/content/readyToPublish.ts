import { slugify } from '@/lib/slug';
import type { ContentAuthor } from './authors';
import { ELEMENT_NODE, TEXT_NODE, contentDom } from './dom';
import { cleanHref, jsonLdText } from './htmlAllowlist';
import { firstImage, jsonLdScript, webPageJsonLd } from './pageSchema';
import { AGENT_PLACEHOLDER, PLACEHOLDER, placeholderIn } from './placeholders';
import type { LinkCheck } from './qualityChecks';
import { languageCode } from './readability';

/**
 * Ready to publish (Content Editor Quality spec §7b, CE-057): what an export
 * gives, and what it checks first. The content is the page's clean HTML
 * (publishableHtml); what goes next to it are the page fields, read from
 * the page itself, never written for it. No export carries a placeholder:
 * the person fills them, or the sentences with one are left out (one in a
 * heading or the title is filled first: a heading has no sentence to drop).
 */

/**
 * HTML as a fragment, in a document of its own: nothing in it loads or runs
 * (an image, an HTML block's code), and a script at its start stays where
 * it is (DOMParser's body would move it).
 */
export function fragment(html: string): HTMLElement {
  const doc = contentDom().document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');
  root.innerHTML = html;
  return root;
}

/**
 * Whether a person's name appears in the page's visible text.
 * Structured data, code, attributes and explicitly hidden content do not count.
 */
export function pageNamesPerson(html: string, name: string): boolean {
  const expected = normalizePageText(name);
  if (!expected) return false;

  const root = fragment(html);
  root
    .querySelectorAll('script, style, template, noscript, [hidden], [aria-hidden="true"]')
    .forEach((element) => element.remove());
  // Blocks end a word: "Reviewed by Dr. Grace Hopper</p><p>Coffee" reads as two lines.
  root
    .querySelectorAll(TEXT_BLOCKS)
    .forEach((element) => element.append(root.ownerDocument.createTextNode(' ')));
  const actual = normalizePageText(root.textContent ?? '');
  const actualChars = Array.from(actual);
  const expectedChars = Array.from(expected);

  for (let index = 0; index <= actualChars.length - expectedChars.length; index++) {
    const matches = expectedChars.every(
      (character, offset) => actualChars[index + offset] === character,
    );
    if (!matches) continue;

    const before = actualChars[index - 1];
    const after = actualChars[index + expectedChars.length];
    const isWordCharacter = (character: string | undefined) =>
      character !== undefined && /[\p{L}\p{N}]/u.test(character);

    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
  }
  return false;
}

const TEXT_BLOCKS =
  'p, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, caption, figcaption, blockquote, div, section, article, aside, header, footer, br';

function normalizePageText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

/**
 * The WebPage.reviewedBy JSON-LD a page goes out with (CE-049), or null: only
 * once the page's own text names the reviewer, so the structured data says
 * what the page shows. One rule for Copy, Export, Send to CMS (one page or
 * many) and the code Before you publish shows; `html` is the page's.
 */
export function reviewerJsonLd(
  title: string,
  html: string,
  reviewer: ContentAuthor | null | undefined,
): string | null {
  return reviewer && pageNamesPerson(html, reviewer.name)
    ? jsonLdScript(webPageJsonLd({ title, reviewer }))
    : null;
}

/** The page with its reviewer's JSON-LD after it, when reviewerJsonLd gives one. */
export function withReviewerJsonLd(
  title: string,
  html: string,
  reviewer: ContentAuthor | null | undefined,
): string {
  const script = reviewerJsonLd(title, html, reviewer);
  return script ? `${html}\n${script}` : html;
}
/** Headings: a placeholder there is filled first, never left out. */
const HEADINGS = 'h1, h2, h3, h4, h5, h6';

/** The text nodes of a page, in order, outside its code (JSON-LD is read apart). */
function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) out.push(child as Text);
      else if (child.nodeType === ELEMENT_NODE) {
        const tag = (child as Element).tagName.toLowerCase();
        if (tag !== 'script' && tag !== 'style' && tag !== 'template') walk(child);
      }
    }
  };
  walk(root);
  return out;
}

/** A text that can be read and changed in place. */
interface Field {
  get: () => string;
  set: (value: string) => void;
}

/** A JSON value's strings, each as a field: its arrays and objects are no placeholders. */
function jsonStrings(value: unknown): Field[] {
  if (typeof value !== 'object' || value === null) return [];
  const box = value as Record<string, unknown>;
  return Object.keys(box).flatMap((key) =>
    typeof box[key] === 'string'
      ? [{ get: () => box[key] as string, set: (next: string) => void (box[key] = next) }]
      : jsonStrings(box[key]),
  );
}

/**
 * Where a placeholder can hide besides the words: alt and title text, and
 * JSON-LD's strings. A JSON-LD changed is written again as JSON; one that
 * doesn't parse is left as written, read for none.
 */
function otherText(root: HTMLElement): Field[] {
  const attributes = Array.from(root.querySelectorAll('[alt], [title]')).flatMap((el) =>
    ['alt', 'title']
      .filter((name) => el.hasAttribute(name))
      .map((name) => ({
        get: () => el.getAttribute(name) ?? '',
        set: (value: string) => el.setAttribute(name, value),
      })),
  );
  const jsonLd = Array.from(root.querySelectorAll('script[type="application/ld+json"]')).flatMap(
    (script) => {
      let value: unknown;
      try {
        value = JSON.parse(script.textContent ?? '');
      } catch {
        return [];
      }
      return jsonStrings(value).map((field) => ({
        get: field.get,
        set: (next: string) => {
          field.set(next);
          script.textContent = jsonLdText(value);
        },
      }));
    },
  );
  return [...attributes, ...jsonLd];
}

/** A text's placeholders; a heading's (and a title's) are the agent's own forms only. */
const count = (text: string, heading = false) => text.match(placeholderIn(heading))?.length ?? 0;
const inHeading = (node: Node) => !!node.parentElement?.closest(HEADINGS);

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The title's placeholders, when the page doesn't hold them already. The
 * title is read from the page (draftTitleFromDoc: its first H1, else its
 * first heading, else its first line, cut with "…"), so a heading or a
 * paragraph that starts as it reads holds them, and they are counted with
 * the page.
 */
export function titlePlaceholders(title: string, html: string): number {
  const start = normalized(title).replace(/…$/, '').trimEnd();
  const held = Array.from(fragment(html).querySelectorAll(`${HEADINGS}, p`)).some((line) =>
    normalized(line.textContent ?? '').startsWith(start),
  );
  return held ? 0 : count(title, true);
}

/**
 * The placeholders in the HTML an export gives: in its words (an HTML
 * block's too), its images' alt and title text, and its JSON-LD's strings.
 */
export function exportPlaceholders(html: string): number {
  const root = fragment(html);
  return (
    textNodes(root).reduce((sum, node) => sum + count(node.data, inHeading(node)), 0) +
    otherText(root).reduce((sum, field) => sum + count(field.get()), 0)
  );
}

/** One of the agent's own forms, whole. */
const AGENT_ONE = new RegExp(`^(?:${AGENT_PLACEHOLDER.source})$`, 'iu');
/** Elements whose content is code, not words: blanked, the next end tag theirs. */
const CODE = new Set(['script', 'style', 'template']);

/**
 * A tag read from its "<": where it ends (past its ">"), and where each of
 * its attributes' values is. Read by a scan, as jsonLdScripts reads one: the
 * time grows with the length only.
 */
function readTag(lower: string, open: number) {
  const values: { name: string; from: number; to: number }[] = [];
  const at = (i: number, chars: RegExp) => i < lower.length && chars.test(lower[i]);
  let i = open + 1;
  while (at(i, /[^\s/>]/)) i++;
  for (;;) {
    while (at(i, /[\s/]/)) i++;
    if (i >= lower.length) return { end: lower.length, values };
    if (lower[i] === '>') return { end: i + 1, values };
    const nameFrom = i;
    while (at(i, /[^\s/>=]/)) i++;
    const name = lower.slice(nameFrom, i);
    while (at(i, /\s/)) i++;
    if (lower[i] !== '=') continue;
    i++;
    while (at(i, /\s/)) i++;
    const quote = lower[i];
    if (quote === '"' || quote === "'") {
      const close = lower.indexOf(quote, i + 1);
      const to = close === -1 ? lower.length : close;
      values.push({ name, from: i + 1, to });
      i = to + 1;
    } else {
      const from = i;
      while (at(i, /[^\s>]/)) i++;
      values.push({ name, from, to: i });
    }
  }
}

/**
 * The HTML with its code blanked out, each character a space, so a position
 * in it is the same in the HTML: comments, and what a <script>, <style> or
 * <template> holds. With `words`, only what exportPlaceholders reads is left:
 * the words (a heading's brackets only in the agent's forms), alt and title
 * values, and a JSON-LD's strings; the tags, styles and other scripts go
 * too. For a search that must find what the page holds, not its code. With
 * `words` and not `fields`, the alt and title values and the JSON-LD go as
 * well: only the words the page's text shows are left.
 */
export function blankCode(html: string, { words = false, fields = true } = {}): string {
  // ASCII letters only: lower-casing all of it could change the length.
  const lower = html.replace(/[A-Z]+/g, (s) => s.toLowerCase());
  const out: string[] = [];
  const blank = (from: number, to: number) => out.push(' '.repeat(Math.max(0, to - from)));
  const keep = (from: number, to: number) => out.push(html.slice(from, to));
  let headings = 0;
  const text = (from: number, to: number) => {
    if (!words || !headings) return keep(from, to);
    out.push(
      html
        .slice(from, to)
        .replace(PLACEHOLDER, (m) => (AGENT_ONE.test(m) ? m : ' '.repeat(m.length))),
    );
  };
  // A tag in words: blanked, but for its alt and title values.
  const tag = (from: number, tagEnd: number, values: ReturnType<typeof readTag>['values']) => {
    if (!words) return keep(from, tagEnd);
    let at = from;
    for (const value of values) {
      if (!fields || (value.name !== 'alt' && value.name !== 'title')) continue;
      blank(at, value.from);
      keep(value.from, value.to);
      at = value.to;
    }
    blank(at, tagEnd);
  };
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf('<', at);
    if (open === -1) break;
    text(at, open);
    if (lower.startsWith('<!--', open)) {
      const close = lower.indexOf('-->', open + 4);
      at = close === -1 ? html.length : close + 3;
      blank(open, at);
      continue;
    }
    const name = /<(\/?)([a-z][a-z0-9-]*)/y;
    name.lastIndex = open;
    const m = name.exec(lower);
    if (!m && !/[!?]/.test(lower.charAt(open + 1))) {
      // A "<" that starts no tag is a word.
      text(open, open + 1);
      at = open + 1;
      continue;
    }
    const { end, values } = readTag(lower, open);
    at = end;
    if (!m) {
      // A doctype or a processing instruction.
      blank(open, end);
      continue;
    }
    const [, closing, tagName] = m;
    if (/^h[1-6]$/.test(tagName)) headings = Math.max(0, headings + (closing ? -1 : 1));
    if (closing || !CODE.has(tagName)) {
      tag(open, end, values);
      continue;
    }
    // Code: its text is no markup, the next end tag of its kind ends it.
    const close = lower.indexOf(`</${tagName}`, end);
    const codeEnd = close === -1 ? html.length : close;
    const jsonLd =
      tagName === 'script' &&
      values.some(
        (v) => v.name === 'type' && lower.slice(v.from, v.to).trim() === 'application/ld+json',
      );
    if (words && (!jsonLd || !fields)) {
      blank(open, codeEnd);
    } else {
      tag(open, end, values);
      const code = html.slice(end, codeEnd);
      out.push(words ? jsonLdStrings(code) : ' '.repeat(code.length));
    }
    at = codeEnd;
  }
  text(at, html.length);
  return out.join('');
}

/** A JSON-LD's text with only its strings' insides left; all of it blanked when it doesn't parse. */
function jsonLdStrings(code: string): string {
  try {
    JSON.parse(code);
  } catch {
    return ' '.repeat(code.length);
  }
  return code.replace(/"((?:[^"\\]|\\.)*)"|[^"]+/g, (m, inner?: string) =>
    inner === undefined ? ' '.repeat(m.length) : ` ${inner} `,
  );
}

/** Lines whose text is read as sentences. */
const LINES = `p, li, td, th, dd, dt, figcaption, blockquote, caption, summary, ${HEADINGS}`;

/** A text's sentences, as a reader would split them ("1.5", "e.g." and "acme.com" don't end one). */
function sentences(text: string): { start: number; end: number; text: string }[] {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
    return [{ start: 0, end: text.length, text }];
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  return Array.from(segmenter.segment(text), (s) => ({
    start: s.index,
    end: s.index + s.segment.length,
    text: s.segment,
  }));
}

/** A text with its placeholders as letters, so a period inside one ends no sentence. */
const masked = (text: string) => text.replace(PLACEHOLDER, (m) => 'x'.repeat(m.length));

/** Cuts ranges of a line's text out of its text nodes, from the end. */
function cut(nodes: Text[], ranges: { start: number; end: number }[]) {
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    let at = 0;
    for (const node of nodes) {
      const from = at;
      at += node.data.length;
      if (at <= range.start || from >= range.end) continue;
      node.data =
        node.data.slice(0, Math.max(0, range.start - from)) +
        node.data.slice(Math.min(node.data.length, range.end - from));
    }
  }
}

/**
 * The HTML with each placeholder left out (Export without them): the
 * sentence it is in goes; one anywhere else (an HTML block's own tags, an
 * alt text, a JSON-LD string) goes alone. A heading's stays, to be filled first. A
 * line, an item, a quote or a row left with no words goes too; formatting
 * in what stays is kept.
 */
export function withoutPlaceholders(html: string): string {
  const root = fragment(html);
  const one = new RegExp(PLACEHOLDER.source, 'iu');
  for (const line of Array.from(root.querySelectorAll(LINES)).reverse()) {
    if (line.matches(HEADINGS)) continue;
    // The line's own text: a nested line is read on its own.
    const nodes = textNodes(line).filter((n) => n.parentElement?.closest(LINES) === line);
    const text = nodes.map((n) => n.data).join('');
    if (!one.test(text)) continue;
    cut(
      nodes,
      sentences(masked(text)).filter((s) => one.test(text.slice(s.start, s.end))),
    );
    for (const node of nodes) node.data = node.data.replace(/\s{2,}/g, ' ');
  }
  // What no line holds: the placeholder alone.
  for (const node of textNodes(root)) {
    if (inHeading(node)) continue;
    if (one.test(node.data)) node.data = node.data.replace(PLACEHOLDER, '').replace(/\s{2,}/g, ' ');
  }
  for (const field of otherText(root)) {
    const value = field.get();
    if (one.test(value))
      field.set(
        value
          .replace(PLACEHOLDER, '')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      );
  }
  // A link or a bold its words all went with goes, then a line, an item, a
  // quote or a list left empty (a table keeps its cells; a row of empty ones goes).
  for (const el of Array.from(root.querySelectorAll('a, strong, em, b, i, u, s, span, mark'))) {
    if (!el.textContent?.trim() && !el.querySelector('img, br')) el.remove();
  }
  for (const box of Array.from(
    root.querySelectorAll('p, li, ul, ol, blockquote, figure, dl, dd, dt, tr'),
  ).reverse()) {
    if (!box.textContent?.trim() && !box.querySelector('img')) box.remove();
  }
  return root.innerHTML;
}

/** The fields an export gives next to the content, for the CMS's own fields. */
export interface PageFields {
  metaTitle: string;
  metaDescription: string;
  /** The page's address part; empty when the title gives none (in another script). */
  slug: string;
  /** The page's author, the team byline, or empty while the authors aren't read. */
  author: string;
  /** The qualified reviewer; separate from the page author. */
  reviewer: string;
  featuredImage: string | null;
}

/** About the longest a search result shows of a description. */
export const META_DESCRIPTION_CHARS = 160;

/** The page's first paragraph's sentences, as many as fit, or its words cut at one. */
function description(root: HTMLElement): string {
  const first = Array.from(root.querySelectorAll('p')).find(
    (p) => !p.closest('blockquote, li, td, th') && (p.textContent ?? '').trim(),
  );
  const text = (first?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= META_DESCRIPTION_CHARS) return text;
  let out = '';
  for (const s of sentences(text)) {
    if ((out + s.text).trim().length > META_DESCRIPTION_CHARS) break;
    out += s.text;
  }
  if (out.trim()) return out.trim();
  const short = text.slice(0, META_DESCRIPTION_CHARS - 1);
  const space = short.lastIndexOf(' ');
  return `${space > 0 ? short.slice(0, space) : short}…`;
}

/**
 * Words an address or a meta title cut short shouldn't end on: they lead
 * into what was cut ("…Unified Tracking Across"). English and Turkish, the
 * languages the editor writes most.
 */
const DANGLING = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'for',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'across',
  'into',
  'vs',
  'your',
  'our',
  've',
  'ile',
  'için',
  'bir',
]);

/** The same words as a slug reads them: "için" is "icin" there. */
const DANGLING_SLUGS = new Set([...DANGLING].map(slugify));

/**
 * Whether a word leads into what was cut: a title's word lowercased without
 * the dot a capital "İ" leaves ("İçin" → "için", where toLowerCase gives
 * "i\u0307çin"), or a slug's word ("icin").
 */
function dangles(word: string): boolean {
  const key = word.toLowerCase().replace(/\u0307/gu, '');
  return DANGLING.has(key) || DANGLING_SLUGS.has(key);
}

/** Words without the ones a cut leaves dangling at their end, keeping one at least. */
export function withoutDangling(words: string[]): string[] {
  const kept = [...words];
  while (kept.length > 1 && dangles(kept.at(-1)!)) kept.pop();
  return kept;
}

/** A slug from the title stops about here, at a word (#1331): an address, not a sentence. */
const TITLE_SLUG_MAX = 60;

/**
 * A live page's own address part ("/blog/pour-over"), else the title as one:
 * without a leading "the" or "a", cut at a word near 60 characters, never on
 * a word that leads into what was cut.
 */
export function slugOf(title: string, sourceUrl: string | null): string {
  if (sourceUrl) {
    try {
      const parts = new URL(sourceUrl).pathname
        .split('/')
        .filter((part) => part && !/^index\.\w+$/i.test(part));
      const last = parts.at(-1);
      if (last) return decodeURIComponent(last);
    } catch {
      // Not an address, or not one to read: the title's slug.
    }
  }
  const words = slugify(title).split('-').filter(Boolean);
  // The title's own first word, not the slug's: "A-Frame houses" keeps its "a".
  if (words.length > 1 && /^(the|a|an)\s/i.test(title.trim())) words.shift();
  const slug = words.join('-');
  if (slug.length <= TITLE_SLUG_MAX) return slug;
  // Cut at a word, not inside one: it becomes the page's address (Send to CMS).
  const cut = slug.slice(0, TITLE_SLUG_MAX + 1).lastIndexOf('-');
  if (cut <= 0) return slug.slice(0, TITLE_SLUG_MAX);
  return withoutDangling(slug.slice(0, cut).split('-')).join('-');
}

/**
 * The page fields, from the page as it goes out: its title, its first
 * paragraph, its live address or its title as a slug, its author and its
 * first image.
 */
export function pageFields({
  title,
  html,
  sourceUrl,
  author,
  reviewer = null,
  teamByline,
}: {
  title: string;
  html: string;
  sourceUrl: string | null;
  author: ContentAuthor | null;
  reviewer?: ContentAuthor | null;
  teamByline: string;
}): PageFields {
  return {
    metaTitle: title.trim(),
    metaDescription: description(fragment(html)),
    slug: slugOf(title, sourceUrl),
    author: author?.name ?? teamByline,
    reviewer: reviewer ? [reviewer.name, reviewer.title].filter(Boolean).join(', ') : '',
    featuredImage: firstImage(html),
  };
}

/**
 * The byline line in the page's language (Add byline to content): the
 * prefix with the author's name, or the team's line; and the team's name
 * alone, for a CMS's author field. They go out with the page, so they are
 * written in the page's language, not the app's. A language not here gets
 * the name alone, or the brand's.
 */
const BYLINES: Record<string, { by: string; team: string; teamName: string }> = {
  en: { by: 'By {name}', team: 'By {brand} Team', teamName: '{brand} Team' },
  tr: { by: 'Yazar: {name}', team: 'Yazar: {brand} Ekibi', teamName: '{brand} Ekibi' },
  de: { by: 'Von {name}', team: 'Vom {brand}-Team', teamName: '{brand}-Team' },
  fr: { by: 'Par {name}', team: "Par l'équipe {brand}", teamName: 'Équipe {brand}' },
  es: { by: 'Por {name}', team: 'Por el equipo de {brand}', teamName: 'Equipo de {brand}' },
  pt: { by: 'Por {name}', team: 'Pela equipe {brand}', teamName: 'Equipe {brand}' },
  it: { by: 'Di {name}', team: 'A cura del team {brand}', teamName: 'Team {brand}' },
  nl: { by: 'Door {name}', team: 'Door het {brand}-team', teamName: '{brand}-team' },
  sv: { by: 'Av {name}', team: 'Av {brand}-teamet', teamName: '{brand}-teamet' },
};

/**
 * The byline line for a page in `language` (brands.language: "tr", "pt-BR",
 * English when unset): by its author, else by the brand's team.
 */
export function bylineText(
  language: string | null | undefined,
  author: string | null,
  brand: string,
): string {
  const forms = BYLINES[languageCode(language) ?? ''];
  // A function, so a "$" in a name is written as it is.
  if (author) return forms ? forms.by.replace('{name}', () => author) : author;
  return forms ? forms.team.replace('{brand}', () => brand) : brand;
}

/**
 * The brand's team as a page in `language` names it, for a CMS's author
 * field when the page has no author ("Acme Team", "Acme Ekibi"); the brand
 * alone in a language not here.
 */
export function teamName(language: string | null | undefined, brand: string): string {
  // No brand read yet: no team to name.
  if (!brand.trim()) return '';
  const forms = BYLINES[languageCode(language) ?? ''];
  return forms ? forms.teamName.replace('{brand}', () => brand) : brand;
}

/**
 * The disclosure line (CE-050) in the page's language, for a page that puts
 * the brand forward among options: what it recommends is the brand's own
 * (offered by it, which fits a product, a service or software alike). It
 * goes out with the page, so in the page's language; a language not here
 * gets none (the person writes it).
 */
const DISCLOSURES: Record<string, string> = {
  en: 'Disclosure: the product this page recommends is offered by {brand}.',
  tr: 'Açıklama: Bu sayfada önerilen ürün {brand} tarafından sunuluyor.',
  de: 'Hinweis: Das auf dieser Seite empfohlene Produkt wird von {brand} angeboten.',
  fr: 'Transparence : le produit recommandé sur cette page est proposé par {brand}.',
  es: 'Aviso: el producto que recomienda esta página lo ofrece {brand}.',
  pt: 'Aviso: o produto recomendado nesta página é oferecido por {brand}.',
  it: 'Trasparenza: il prodotto consigliato in questa pagina è offerto da {brand}.',
  nl: 'Transparantie: het product dat deze pagina aanbeveelt, wordt aangeboden door {brand}.',
  sv: 'Upplysning: produkten som den här sidan rekommenderar erbjuds av {brand}.',
};

/** The disclosure line for a page in `language`, or null (no brand read, or a language not here). */
export function disclosureText(language: string | null | undefined, brand: string): string | null {
  const line = DISCLOSURES[languageCode(language) ?? ''];
  // A function, so a "$" in a name is written as it is.
  return line && brand.trim() ? line.replace('{brand}', () => brand.trim()) : null;
}

/**
 * Where the end tag of the HTML's k-th H1 ends, counted from 0, or null.
 * Comments and code are blanked first (blankCode): an H1 there is no element.
 */
function h1End(html: string, k: number): number | null {
  const lower = blankCode(html).replace(/[A-Z]+/g, (s) => s.toLowerCase());
  let opened = -1;
  for (const m of lower.matchAll(/<(\/?)h1(?=[\s/>])/g)) {
    if (!m[1]) opened++;
    else if (opened === k) {
      const end = lower.indexOf('>', m.index);
      return end === -1 ? null : end + 1;
    }
  }
  return null;
}

/**
 * The byline in the content (Add byline to content, a brand's opt-in for a
 * CMS with no author field): one line under the page's H1, or at its top
 * when it opens with no H1. The rest of the HTML goes out as written; a
 * page that already has the line there, or has no words, gets none.
 */
export function withByline(html: string, byline: string): string {
  const root = fragment(html);
  // The page's first words: an image or code before them leaves them first.
  const lead = Array.from(root.children).find(
    (el) => !el.matches('script, style, template') && el.textContent?.trim(),
  );
  if (!lead) return html;
  const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const line = root.ownerDocument.createElement('p');
  line.textContent = byline;
  // A page written one block a line (publishableHtml) keeps that.
  const gap = html.includes('\n') ? '\n' : '';
  if (lead.matches('h1')) {
    const next = lead.nextElementSibling;
    if (next?.matches('p') && words(next) === words(line)) return html;
    // The lead's own end tag: an empty H1 above it, or one in a comment or
    // a script, isn't it.
    const at = h1End(html, Array.from(root.querySelectorAll<Element>('h1')).indexOf(lead));
    if (at !== null) return html.slice(0, at) + gap + line.outerHTML + html.slice(at);
  }
  if (lead.matches('p') && words(lead) === words(line)) return html;
  return line.outerHTML + gap + html;
}

/** The page's leading H1, for a destination whose title field holds it. */
export function withoutLeadingH1(html: string): string {
  const root = fragment(html);
  const first = Array.from(root.children).find((el) => el.textContent?.trim() || el.matches('img'));
  if (first?.matches('h1')) first.remove();
  return root.innerHTML.replace(/^\s+/, '');
}

/**
 * What Ready to paste checks besides placeholders: the links answer (as
 * Trust's link reads found them), the images have alt text, and what an
 * HTML block keeps of its own (classes, styles, scripts) goes out as written.
 */
export interface PasteChecks {
  /**
   * The page's links, how many were read (Trust's link reads: one that
   * answered, or didn't; a read the site refused or timed out is none), and
   * how many of those don't answer.
   */
  links: { count: number; read: number; broken: number };
  images: { count: number; withoutAlt: number };
  /** Elements that carry a class, a style or a script (JSON-LD aside). */
  ownCode: number;
}

export function pasteChecks(html: string, linkChecks: ReadonlyMap<string, LinkCheck>): PasteChecks {
  const root = fragment(html);
  const hrefs = [
    ...new Set(
      Array.from(root.querySelectorAll('a[href]'))
        .map((a) => cleanHref(a.getAttribute('href') ?? ''))
        .filter((href): href is string => !!href && /^https?:\/\//i.test(href)),
    ),
  ];
  const images = Array.from(root.querySelectorAll('img'));
  return {
    links: {
      count: hrefs.length,
      read: hrefs.filter((h) => {
        const status = linkChecks.get(h)?.status;
        return status === 'ok' || status === 'broken';
      }).length,
      broken: hrefs.filter((h) => linkChecks.get(h)?.status === 'broken').length,
    },
    images: {
      count: images.length,
      withoutAlt: images.filter((img) => !(img.getAttribute('alt') ?? '').trim()).length,
    },
    ownCode: root.querySelectorAll(
      '[class], [style], script:not([type="application/ld+json"]), style, iframe',
    ).length,
  };
}
