/**
 * Numbers in the UI's locale (Visibility spec v2, VIS-005: "Every number uses
 * the UI's locale format"). next-intl leaves a plain `{n}` message argument as
 * String(n), so numbers are formatted here before they go into a message.
 * A sign is written with the true minus (−) the Insights cards use, whatever
 * the locale's own hyphen.
 */

export interface NumberFormat {
  /** 1,234 or 17.4; with `digits`, always that many decimals ("48.0"). */
  number(n: number, digits?: number): string;
  /** A 0–100 value as a percent: "64.3%" in English, "%64,3" in Turkish. */
  percent(n: number, digits?: number): string;
  /** A large count, shortened: "39.9K", "1.2M". */
  compact(n: number): string;
  /** A change with its sign: "+1.5", "−3.2", "±0". */
  signed(n: number, digits?: number): string;
}

const MINUS = '−';
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

/** Decimals: exactly `digits` when given, else as many as the value has (up to 3). */
const decimals = (digits?: number): Intl.NumberFormatOptions =>
  digits === undefined
    ? { maximumFractionDigits: 3 }
    : { minimumFractionDigits: digits, maximumFractionDigits: digits };

export function numberFormat(locale: string): NumberFormat {
  const number = (n: number, digits?: number) => formatter(locale, decimals(digits)).format(n);
  return {
    number,
    percent: (n, digits) =>
      formatter(locale, { style: 'percent', ...decimals(digits) }).format(n / 100),
    compact: (n) => formatter(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n),
    signed: (n, digits) => {
      if (n === 0) return '±0';
      return `${n > 0 ? '+' : MINUS}${number(Math.abs(n), digits)}`;
    },
  };
}
