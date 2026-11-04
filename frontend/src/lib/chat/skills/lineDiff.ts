/**
 * A line-by-line difference of two texts (W4-31's update screen): the
 * lines both keep, and those only the old or only the new one has, in
 * order. The longest common run of lines, as `diff` finds it. Past
 * MAX_DIFF_CELLS of work the whole old text shows removed and the new one
 * added: still right, only coarser. Pure.
 */

export interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** The most line pairs compared (old lines × new lines). */
export const MAX_DIFF_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ];
  }
  // lengths[i][j]: the longest common run of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'added', text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: 'removed', text: a[i] });
  for (; j < b.length; j += 1) out.push({ kind: 'added', text: b[j] });
  return out;
}
