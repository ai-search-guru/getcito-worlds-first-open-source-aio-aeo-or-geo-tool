/**
 * ChatGPT's entity markup in stored answer text.
 *
 * ChatGPT answers could be saved with a tag where a name should be:
 * `<Entity category="software" value="Tesseract" disambig="…"/>` for
 * "Tesseract". The answer view showed the tag as literal text. New answers are
 * cleaned before they're saved; this cleans the ones stored before that when
 * they're read. Mirrors backend/src/lib/entityMarkup.js — keep the two in sync.
 */

/** A self-closing `<Entity …/>` tag; group 1 is its attribute list. */
const ENTITY_TAG = /<Entity((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/>/g;

const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const NAMED_ESCAPES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Attribute values are XML-escaped ("AT&amp;T"); undo the common escapes. */
function unescapeXml(value: string): string {
  return value.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([\da-f]+));/gi,
    (match, name?: string, dec?: string, hex?: string) => {
      if (name) return NAMED_ESCAPES[name.toLowerCase()];
      const code = dec ? Number(dec) : parseInt(hex ?? '', 16);
      // NUL and lone surrogates would not survive a Postgres text column.
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : match;
    },
  );
}

/**
 * Replaces each `<Entity … value="X" …/>` tag with X, the name the answer
 * reads. A tag without a `value` is left as it is.
 */
export function stripEntityMarkup(text: string): string {
  if (!text || !text.includes('<Entity')) return text;
  return text.replace(ENTITY_TAG, (tag, attributes: string) => {
    for (const [, name, doubleQuoted, singleQuoted] of attributes.matchAll(ATTRIBUTE)) {
      if (name === 'value') return unescapeXml(doubleQuoted ?? singleQuoted);
    }
    return tag;
  });
}
