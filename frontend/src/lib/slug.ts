// Letters that Unicode NFD does not decompose on its own (Turkish dotless/dotted
// i, German ß, Nordic ø, Polish ł, …), plus the Turkish I/ı lowercasing case.
// This map is the single source of truth for the special-case set: the pattern
// below is derived from its keys, and every other non-ASCII letter falls through
// to the NFD pass in `slugify` (é → e, ü → u, ç → c).
const TRANSLITERATIONS: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  I: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ß: 'ss',
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
};

const TRANSLITERATION_PATTERN = new RegExp(`[${Object.keys(TRANSLITERATIONS).join('')}]`, 'g');

/**
 * Turn a display name into a URL/filename-safe slug.
 *
 * Non-ASCII letters are transliterated rather than deleted, so `Ürün` becomes
 * `urun` (not `rn`) and every CSV/PDF export named after the slug keeps the
 * brand's name. Returns an empty string when nothing survives; callers supply
 * their own fallback for that case.
 */
export function slugify(text: string): string {
  return text
    .replace(TRANSLITERATION_PATTERN, (ch) => TRANSLITERATIONS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
