/**
 * ChatGPT's entity markup in answer text.
 *
 * ChatGPT tags the products, companies and places it names, and the markdown
 * Cloro returns for it can keep the tag where the name should be:
 * `<Entity category="software" value="Tesseract" disambig="Adlift AI search
 * optimization platform"/>` for "Tesseract". The tag showed as literal text on
 * the answer, and its attributes counted as mentions: a competitor named only
 * in `disambig` (or one called "Software") was counted as mentioned, and the
 * extra names shifted every mention position.
 *
 * New answers are cleaned before they're saved. The response parser and the
 * web app clean again, so answers stored before that read and count properly
 * too. Mirrored by frontend/src/lib/entityMarkup.ts — keep the two in sync.
 */

/** A self-closing `<Entity …/>` tag; group 1 is its attribute list. */
const ENTITY_TAG = /<Entity((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/>/g;

const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const NAMED_ESCAPES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Attribute values are XML-escaped ("AT&amp;T"); undo the common escapes. */
function unescapeXml(value) {
  return value.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([\da-f]+));/gi,
    (match, name, dec, hex) => {
      if (name) return NAMED_ESCAPES[name.toLowerCase()];
      const code = dec ? Number(dec) : parseInt(hex, 16);
      // NUL and lone surrogates would not survive a Postgres text column.
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : match;
    },
  );
}

/**
 * Replaces each `<Entity … value="X" …/>` tag with X, the name the answer
 * reads. A tag without a `value` is left as it is.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripEntityMarkup(text) {
  if (!text || !text.includes('<Entity')) return text;
  return text.replace(ENTITY_TAG, (tag, attributes) => {
    for (const [, name, doubleQuoted, singleQuoted] of attributes.matchAll(ATTRIBUTE)) {
      if (name === 'value') return unescapeXml(doubleQuoted ?? singleQuoted);
    }
    return tag;
  });
}
