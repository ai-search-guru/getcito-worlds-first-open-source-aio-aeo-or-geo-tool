/**
 * A small RFC 4180 reader: quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF or LF, and a leading byte-order mark. Tab-
 * separated text (Google's text feeds) is read the same way when the header
 * line has tabs and no commas.
 *
 * Rows are yielded one at a time, so a large file isn't copied into an array
 * of rows before it's read.
 */

/** The header line's delimiter: a tab when it has tabs and no commas outside quotes. */
export function delimiterOf(text) {
  let quoted = false;
  let tabs = 0;
  let commas = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === '\t') tabs++;
    else if (!quoted && ch === ',') commas++;
  }
  return tabs > 0 && commas === 0 ? '\t' : ',';
}

/**
 * Each row of a CSV text, as an array of field strings, with the line it
 * starts on (1-based). A blank line yields nothing.
 *
 * @param {string} input
 * @returns {Generator<{ line: number, fields: string[] }>}
 */
export function* csvRows(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = delimiterOf(text);
  let fields = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let sawAny = false;

  const endRow = function* () {
    fields.push(field);
    // A blank line: one empty field and nothing else.
    if (fields.length > 1 || fields[0] !== '') yield { line: rowLine, fields };
    fields = [];
    field = '';
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      sawAny = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = '';
      sawAny = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      yield* endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
      sawAny = true;
    }
  }
  if (sawAny || field !== '' || fields.length) yield* endRow();
}
