/**
 * Edits to a text ({ start, end, …}) kept apart and in order of start, as
 * the guards put their placeholders: whether a new one is free is read from
 * its two neighbours, found by a binary search, so a line with thousands of
 * names, sources or numbers to replace takes time near its length, not its
 * edits times them (#1544 review).
 */
export function editSpans() {
  const spans = [];
  // The first span that starts at `start` or after it.
  const at = (start) => {
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (spans[mid].start < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    /** The spans, in order of start. */
    spans,
    /** Whether [start, end) overlaps none of the spans kept. */
    free(start, end) {
      const i = at(start);
      if (spans[i - 1] && spans[i - 1].end > start) return false;
      // The spans that start inside it: one at most, past an empty one at
      // its start (an empty span may share a start with another).
      for (let j = i; j < spans.length && spans[j].start < end; j++) {
        if (start < spans[j].end) return false;
      }
      return true;
    },
    /**
     * Keep an edit, in its place: after the spans that start before it, or
     * at its start and end no later (an empty span first), so the span
     * before a place is always the one that may run past it.
     */
    add(edit) {
      let lo = 0;
      let hi = spans.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const span = spans[mid];
        if (span.start < edit.start || (span.start === edit.start && span.end <= edit.end)) {
          lo = mid + 1;
        } else hi = mid;
      }
      spans.splice(lo, 0, edit);
    },
  };
}
