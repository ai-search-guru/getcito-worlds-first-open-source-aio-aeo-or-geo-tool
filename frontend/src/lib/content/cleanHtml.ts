import DOMPurify from 'dompurify';
import { contentDom, parseHtml } from './dom';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  DEMOTED_HEADINGS,
  HTML_BLOCK_ELEMENT,
  KEPT_SLOT,
  MAX_HTML_BLOCK_LENGTH,
  UNSAFE_TAGS,
  cleanHref,
  decodeHtmlBlock,
  extractKeptBlocks,
  htmlBlockElement,
  restoreKeptBlocks,
} from './htmlAllowlist';

/**
 * Cleans HTML in the browser before the editor takes it (Content Editor
 * CE-005, CE-020): a paste from Word, Google Docs, Notion or a web page, and
 * the HTML view when it switches back. Keeps what htmlAllowlist.ts allows;
 * the server checks every save again (sanitizeDraftHtml.ts).
 */

export interface CleanedHtml {
  html: string;
  /** Scripts, iframes, objects… taken out (JSON-LD isn't one). */
  unsafeRemoved: number;
  /** Images left out (a paste), or ones that weren't http(s). */
  imagesRemoved: number;
}

// data-i marks a JSON-LD slot; data-pm-slice is how a copy from the editor
// itself says which lists or quotes it was cut out of.
const ALLOWED_ATTR = [
  ...new Set(Object.values(ALLOWED_ATTRIBUTES).flat()),
  'data-i',
  'data-pm-slice',
];

/**
 * Bold and italic set by style, as Google Docs writes them, become <strong>
 * and <em>, so they outlive the styles. Google Docs also wraps a whole copy
 * in <b style="font-weight:normal">, which isn't bold at all.
 */
function keepStyledEmphasis(root: HTMLElement) {
  for (const b of root.querySelectorAll<HTMLElement>('b[id^="docs-internal-guid"]')) {
    b.replaceWith(...b.childNodes);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
    if (el.tagName === 'B' && /font-weight\s*:\s*(normal|[1-5]00)\b/i.test(el.style.cssText)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const weight = el.style.fontWeight;
    // A heading is bold already; its spans only say so again.
    const bold =
      (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) &&
      !el.closest('h1, h2, h3, h4, h5, h6');
    const italic = el.style.fontStyle === 'italic';
    if (!bold && !italic) continue;
    const inner = root.ownerDocument.createElement('span');
    inner.append(...el.childNodes);
    let wrapped: HTMLElement = inner;
    if (italic) {
      const em = root.ownerDocument.createElement('em');
      em.append(wrapped);
      wrapped = em;
    }
    if (bold) {
      const strong = root.ownerDocument.createElement('strong');
      strong.append(wrapped);
      wrapped = strong;
    }
    el.append(wrapped);
  }
}

function demoteHeadings(root: HTMLElement) {
  for (const tag of DEMOTED_HEADINGS) {
    for (const heading of root.querySelectorAll(tag)) {
      const h3 = root.ownerDocument.createElement('h3');
      h3.append(...heading.childNodes);
      heading.replaceWith(h3);
    }
  }
}

/**
 * `keepImages`: a paste from elsewhere leaves images out. `keepHtmlBlocks`:
 * only the editor's own HTML (its copy, the HTML view) brings HTML blocks; a
 * paste from a web page can't plant code in a draft.
 */
export function cleanHtml(
  input: string,
  { keepImages, keepHtmlBlocks = false }: { keepImages: boolean; keepHtmlBlocks?: boolean },
): CleanedHtml {
  const { html, kept } = extractKeptBlocks(input, { htmlBlocks: keepHtmlBlocks });
  const doc = parseHtml(html);
  // Counted in the whole document: a script before any text parses into <head>.
  const unsafeRemoved = doc.querySelectorAll(UNSAFE_TAGS.join(',')).length;
  keepStyledEmphasis(doc.body);
  demoteHeadings(doc.body);

  // A purifier of its own, so these hooks don't touch other uses of DOMPurify.
  const purify = DOMPurify(contentDom());
  let imagesRemoved = 0;
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = cleanHref(node.getAttribute('href') ?? '');
      if (href) node.setAttribute('href', href);
      else node.removeAttribute('href');
    } else if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!keepImages || !/^https?:\/\//i.test(src)) {
        imagesRemoved += 1;
        node.remove();
      }
    } else if (node.hasAttribute('data-i') && node.tagName.toLowerCase() !== KEPT_SLOT) {
      node.removeAttribute('data-i');
    }
  });
  const clean = purify.sanitize(doc.body.innerHTML, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, KEPT_SLOT],
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // Links and image addresses are checked by the hook above, more strictly
    // than DOMPurify's own rule (which still stops javascript:).
  });

  return {
    html: restoreKeptBlocks(clean, kept).replace(/<p>(\s|&nbsp;|<br>)*<\/p>/g, ''),
    unsafeRemoved,
    imagesRemoved,
  };
}

const BLOCKS = 'h[1-6]|p|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|script';
const BEFORE_OPENING_BLOCK = new RegExp(`><(?=(?:${BLOCKS})\\b)`, 'g');
const AFTER_CLOSING_BLOCK = new RegExp(`(</(?:${BLOCKS})>)(?=<)`, 'g');

const HTML_BLOCK_OPEN = '<!-- html-block -->';
const HTML_BLOCK_CLOSE = '<!-- /html-block -->';
const HTML_BLOCK_MARKED = /<!-- html-block -->\n?([\s\S]*?)\n?<!-- \/html-block -->/g;

function lineByBlock(html: string): string {
  return html.replace(AFTER_CLOSING_BLOCK, '$1\n').replace(BEFORE_OPENING_BLOCK, '>\n<');
}

/** Each HTML block's code in place of its element, as `expand` writes it. */
function expandHtmlBlocks(html: string, expand: (code: string) => string): string {
  return html.replace(HTML_BLOCK_ELEMENT, (element, encoded: string) => {
    const code = decodeHtmlBlock(encoded);
    return code === null ? element : expand(code);
  });
}

/**
 * The HTML view's text: the page's HTML as a draft stores it (without the
 * editor's own table widths and link targets), one block per line, so it
 * reads like source. Inline tags stay on their line. An HTML block shows as
 * its code between <!-- html-block --> markers, as written.
 */
export function formatHtmlSource(html: string): string {
  const clean = cleanHtml(html, { keepImages: true, keepHtmlBlocks: true }).html;
  return expandHtmlBlocks(
    lineByBlock(clean),
    (code) => `${HTML_BLOCK_OPEN}\n${code}\n${HTML_BLOCK_CLOSE}`,
  );
}

/**
 * The HTML view's text back to the editor's HTML: the code between markers
 * becomes HTML blocks again (one over MAX_HTML_BLOCK_LENGTH, or empty,
 * goes), and the rest is left for cleanHtml.
 */
export function htmlFromSource(source: string): string {
  return source.replace(HTML_BLOCK_MARKED, (_, code: string) =>
    code.trim() && code.length <= MAX_HTML_BLOCK_LENGTH ? htmlBlockElement(code) : '',
  );
}

/**
 * The page as HTML to publish, what Copy HTML puts on the clipboard: cleaned
 * as a draft stores it, one block per line, each HTML block as its own code
 * and the schema JSON-LD as its script.
 */
export function publishableHtml(html: string): string {
  const clean = cleanHtml(html, { keepImages: true, keepHtmlBlocks: true }).html;
  return expandHtmlBlocks(lineByBlock(clean), (code) => code);
}
