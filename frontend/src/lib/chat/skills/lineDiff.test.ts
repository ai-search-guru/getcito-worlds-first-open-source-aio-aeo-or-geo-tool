import { describe, expect, it } from 'vitest';
import { MAX_DIFF_CELLS, diffLines } from './lineDiff';

describe('a line-by-line difference (W4-31)', () => {
  it('keeps the lines both have, and marks those only one has, in order', () => {
    expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('shows a changed line as removed then added, and nothing when equal', () => {
    expect(diffLines('Read the page.', 'Read the page twice.')).toEqual([
      { kind: 'removed', text: 'Read the page.' },
      { kind: 'added', text: 'Read the page twice.' },
    ]);
    expect(diffLines('x\ny', 'x\ny').every((line) => line.kind === 'same')).toBe(true);
  });

  it('past its limit, shows the old text removed and the new one added', () => {
    const lines = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const before = Array.from({ length: lines }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: lines }, (_, i) => `new ${i}`).join('\n');
    const out = diffLines(before, after);
    expect(out).toHaveLength(lines * 2);
    expect(out[0]).toEqual({ kind: 'removed', text: 'old 0' });
    expect(out[lines]).toEqual({ kind: 'added', text: 'new 0' });
  });
});
