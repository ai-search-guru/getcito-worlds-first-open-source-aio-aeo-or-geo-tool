/**
 * How deep a fetched page's elements nest, read before the page is parsed.
 *
 * Parsing a page into a tree (cheerio) takes time that grows with how deep
 * its elements nest as well as with its length, so a page that nests far
 * deeper than any real one is turned away before it's parsed. The count is
 * one pass that stops at the limit, with the same implied closes a browser
 * makes (an unclosed <p> or <li> ends at the next one).
 */

import { Parser } from 'htmlparser2';

/** Browsers stop nesting elements at 512: no page they show goes deeper. */
export const MAX_HTML_DEPTH = 512;

const TOO_DEEP = Symbol('too deep');

/** Whether `html` nests its elements deeper than `limit`, read until it does. */
export function nestsTooDeep(html, limit = MAX_HTML_DEPTH) {
  let depth = 0;
  const parser = new Parser(
    {
      onopentag() {
        depth += 1;
        if (depth > limit) throw TOO_DEEP;
      },
      onclosetag() {
        depth -= 1;
      },
    },
    { decodeEntities: false },
  );
  try {
    parser.end(String(html ?? ''));
    return false;
  } catch (err) {
    if (err === TOO_DEEP) return true;
    throw err;
  }
}
