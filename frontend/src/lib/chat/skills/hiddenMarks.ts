import { HIDDEN } from './format';

/** A piece of a skill's text as its review shows it: plain text, or a hidden character marked. */
export type MarkedPiece = { text: string } | { hidden: string; code: string };

const EVERY_HIDDEN = new RegExp(HIDDEN.source, 'g');

/** A character's code point as the review names it: "U+200B", "U+E0041". */
const codeOf = (char: string) =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * A skill's cleaned text cut where the scan's hidden characters are
 * (format.ts HIDDEN: zero-width, bidi controls and tag characters), so the
 * review shows each one as a visible mark (CHAT-13 item 17): nothing a
 * reader can't see is approved unseen. Pure.
 */
export function markHidden(text: string): MarkedPiece[] {
  const pieces: MarkedPiece[] = [];
  let at = 0;
  for (const match of text.matchAll(EVERY_HIDDEN)) {
    const index = match.index ?? 0;
    if (index > at) pieces.push({ text: text.slice(at, index) });
    pieces.push({ hidden: match[0], code: codeOf(match[0]) });
    at = index + match[0].length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

/** How many hidden characters the text has. */
export const hiddenCount = (pieces: readonly MarkedPiece[]) =>
  pieces.filter((piece) => 'hidden' in piece).length;
