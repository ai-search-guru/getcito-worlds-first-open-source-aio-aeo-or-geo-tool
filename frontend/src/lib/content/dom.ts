/**
 * The DOM the Content Editor's HTML helpers read and clean pages with
 * (clean-html, ready-to-publish, page-schema, placeholders, readability):
 * the browser's own, or one the server gives with setContentDom. The MCP's
 * get_content_draft_package gives a jsdom window, so the page it hands an
 * assistant is the one the editor's Copy HTML and Send to CMS make. Nothing
 * here imports a DOM library: the browser's bundle never carries one.
 */

/** A window, as the browser's: its document, DOMParser, nodes and elements. */
export type ContentWindow = Window & typeof globalThis;

let given: ContentWindow | null = null;

/** The window the helpers read with on the server; null goes back to the browser's. */
export function setContentDom(win: ContentWindow | null): void {
  given = win;
}

/** The window the helpers read with: the one given, else the browser's. */
export function contentDom(): ContentWindow {
  return given ?? window;
}

/** HTML as a document of its own, as DOMParser reads it. */
export function parseHtml(html: string): Document {
  return new (contentDom().DOMParser)().parseFromString(html, 'text/html');
}

/** Node types, as the DOM numbers them: no Node global on the server. */
export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
