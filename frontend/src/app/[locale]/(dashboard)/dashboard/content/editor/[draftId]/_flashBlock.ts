import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * A block of the page marked for a moment (Quality's Show, CE-039): a
 * decoration, never the page's, so no save, export or copy has it, and the
 * editor doesn't redraw it away.
 */

export interface BlockRange {
  from: number;
  to: number;
}

export const flashKey = new PluginKey<DecorationSet>('flashBlock');

const FLASH = 'rounded-sm ring-2 ring-amber-300 dark:ring-amber-700';

/** Words without their spacing: the page's text and a check's read alike. */
const squeeze = (text: string) => text.replace(/\s+/g, '');

/**
 * The smallest block of the page that holds `text` (its first 80 characters),
 * at its first place: a passage the page has twice is shown where it comes first.
 */
export function findBlock(doc: PmNode, text: string): BlockRange | null {
  const probe = squeeze(text).slice(0, 80);
  if (!probe) return null;
  let best: BlockRange | null = null;
  doc.descendants((node, pos) => {
    // Past the first block that holds it: only one inside that may hold it better.
    if (best && pos >= best.to) return false;
    if (!node.isBlock) return false;
    if (!squeeze(node.textContent).includes(probe)) return false;
    best = { from: pos, to: pos + node.nodeSize };
    // A smaller one inside may hold it too.
    return true;
  });
  return best;
}

export const FlashBlock = Extension.create({
  name: 'flashBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta = tr.getMeta(flashKey) as BlockRange | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.node(meta.from, meta.to, { class: FLASH }),
              ]);
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => flashKey.getState(state) ?? null,
        },
      }),
    ];
  },
});
