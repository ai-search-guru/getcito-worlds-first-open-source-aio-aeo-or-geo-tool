/** Letters Unicode doesn't take apart into a base letter and its mark. */
export const LETTERS = { ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', þ: 'th' };

/**
 * Text lowercased with its letters as plain Latin ones: marks taken off
 * ("ç" → "c", "İ" → "i") and the letters Unicode keeps whole spelled out
 * ("ı" → "i", "ß" → "ss"), so "Kadın Ayakkabı" reads as a slug's
 * "kadin-ayakkabi" does. Other characters stay as they are.
 */
export function foldLetters(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ıßæœøđłþ]/g, (c) => LETTERS[c])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}
