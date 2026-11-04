import { describe, expect, it } from 'vitest';
import { hiddenCount, markHidden } from './hiddenMarks';

/** The review marks what a reader can't see (CHAT-13 item 17). */
describe('markHidden', () => {
  it('leaves plain text as one piece', () => {
    expect(markHidden('Open with the answer.')).toEqual([{ text: 'Open with the answer.' }]);
    expect(markHidden('')).toEqual([]);
  });

  it('marks zero-width, bidi and tag characters by their code point', () => {
    const pieces = markHidden('a​b‮c\u{E0041}');
    expect(pieces).toEqual([
      { text: 'a' },
      { hidden: '​', code: 'U+200B' },
      { text: 'b' },
      { hidden: '‮', code: 'U+202E' },
      { text: 'c' },
      { hidden: '\u{E0041}', code: 'U+E0041' },
    ]);
    expect(hiddenCount(pieces)).toBe(3);
  });
});
