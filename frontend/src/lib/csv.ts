const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

function escape(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s = String(value);
  if (typeof value === 'string' && FORMULA_PREFIX_REGEX.test(s)) {
    s = `'${s}`;
  }

  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One line of values, each escaped as toCsv escapes a cell. */
export function csvLine(values: unknown[]): string {
  return values.map(escape).join(',');
}

export function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) => csvLine(headers.map((header) => row[header])));

  return [headerLine, ...dataLines].join('\n');
}
