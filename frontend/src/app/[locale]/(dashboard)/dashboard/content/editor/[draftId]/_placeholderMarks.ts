import { Extension, type Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { placeholderIn } from '@/lib/content/placeholders';

/**
 * The page's placeholders (CE-044), marked where they are: what the Content
 * Agent leaves in square brackets for the person to fill, and what holds a
 * send to a CMS or an export until they do. Each one is tinted amber, so the
 * person sees them as they read; the toolbar counts them and steps from one
 * to the next (PlaceholderNav). A heading's are the agent's own forms only
 * (AGENT_PLACEHOLDER), as everywhere else.
 */

/** A placeholder in the page, and the block (a paragraph or a heading) holding it. */
export interface PlaceholderRange {
  from: number;
  to: number;
  block: { from: number; to: number };
}

/** The page's placeholders, in order: each line read once, across the marks in it. */
export function placeholderRanges(doc: PmNode): PlaceholderRange[] {
  const found: PlaceholderRange[] = [];
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true;
    // The line's text, with where each piece of it starts in the page.
    let text = '';
    const pieces: { at: number; pos: number }[] = [];
    block.forEach((child, offset) => {
      if (!child.isText) return;
      pieces.push({ at: text.length, pos: pos + 1 + offset });
      text += child.text;
    });
    const posOf = (i: number) => {
      const piece = pieces.findLast((p) => p.at <= i)!;
      return piece.pos + (i - piece.at);
    };
    for (const m of text.matchAll(placeholderIn(block.type.name === 'heading'))) {
      found.push({
        from: posOf(m.index),
        to: posOf(m.index + m[0].length - 1) + 1,
        block: { from: pos, to: pos + block.nodeSize },
      });
    }
    return false;
  });
  return found;
}

/**
 * Which placeholder the cursor at `at` is on (-1 for none): the last one
 * holding it, so where two touch ("[ab][cd]") the end of the first, which
 * is where the second starts, is the second's.
 */
export function placeholderIndexAt(ranges: readonly PlaceholderRange[], at: number): number {
  return ranges.findLastIndex((r) => at >= r.from && at <= r.to);
}

/**
 * The placeholder after (or before) the cursor at `at`, round to the first
 * (or the last) past the end: from inside one, its neighbour.
 */
export function stepPlaceholder(
  ranges: readonly PlaceholderRange[],
  at: number,
  direction: 1 | -1,
): PlaceholderRange | null {
  if (!ranges.length) return null;
  const here = placeholderIndexAt(ranges, at);
  if (direction === 1) {
    const next = here >= 0 ? here + 1 : ranges.findIndex((r) => r.from > at);
    return ranges[next >= 0 && next < ranges.length ? next : 0];
  }
  const previous = here >= 0 ? here - 1 : ranges.findLastIndex((r) => r.to < at);
  return ranges[previous >= 0 ? previous : ranges.length - 1];
}

/** Selects a placeholder to type over, scrolled to. */
export function selectPlaceholder(editor: Editor, range: PlaceholderRange) {
  editor
    .chain()
    .setTextSelection({ from: range.from, to: range.to })
    .scrollIntoView()
    .focus(undefined, { scrollIntoView: false })
    .run();
}

/** The tint, in the light and the dark theme. */
export const PLACEHOLDER_MARK_CLASS =
  'rounded-sm bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100';

interface MarksState {
  ranges: PlaceholderRange[];
  decorations: DecorationSet;
}

function read(doc: PmNode): MarksState {
  const ranges = placeholderRanges(doc);
  return {
    ranges,
    decorations: DecorationSet.create(
      doc,
      ranges.map((r) =>
        Decoration.inline(r.from, r.to, {
          class: PLACEHOLDER_MARK_CLASS,
          'data-placeholder-mark': '',
        }),
      ),
    ),
  };
}

export const placeholderMarksKey = new PluginKey<MarksState>('placeholderMarks');

export const PlaceholderMarks = Extension.create({
  name: 'placeholderMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<MarksState>({
        key: placeholderMarksKey,
        state: {
          init: (_, state) => read(state.doc),
          apply: (tr, previous) => (tr.docChanged ? read(tr.doc) : previous),
        },
        props: {
          decorations: (state) => placeholderMarksKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
