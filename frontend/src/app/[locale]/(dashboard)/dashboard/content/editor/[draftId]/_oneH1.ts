import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * One H1 per page: the H1 is the page's title. A change that gives a page a
 * second H1, typed, pasted, written in the HTML view or accepted from the
 * agent, makes the new one an H2, and the H1 the page had stays. A page that
 * already had several (an older draft, or a version restored from History)
 * keeps them until the person changes them; the Rules tab's "One H1 per
 * page" says so.
 */

/** Meta on a transaction that writes a page as it was (History's restore): left as it is. */
export const ONE_H1_AS_IS = 'oneH1AsIs';

/**
 * Where a page's H1s with words start, in order: an empty H1 line is no
 * title, so it never counts or stays over one with words.
 */
export function h1Positions(doc: PmNode): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level === 1 && node.textContent.trim()) {
      found.push(pos);
    }
    // Headings may sit in lists or cells; a paragraph's text holds none.
    return !node.isTextblock;
  });
  return found;
}

export const OneH1 = Extension.create({
  name: 'oneH1',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('oneH1'),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta(ONE_H1_AS_IS))) return null;
          const after = h1Positions(newState.doc);
          if (after.length <= 1) return null;
          const before = h1Positions(oldState.doc);
          if (after.length <= before.length) return null;
          // The H1s the page had: by their words, else where they are now;
          // with none, its first.
          const kept = new Set<number>();
          for (const pos of before) {
            const text = oldState.doc.nodeAt(pos)!.textContent;
            const mapped = transactions.reduce((at, tr) => tr.mapping.map(at), pos);
            const same = after.find(
              (at) => !kept.has(at) && newState.doc.nodeAt(at)!.textContent === text,
            );
            const found = same ?? (after.includes(mapped) ? mapped : undefined);
            if (found !== undefined) kept.add(found);
          }
          if (kept.size === 0) kept.add(after[0]);
          const tr = newState.tr;
          for (const pos of after) {
            if (kept.has(pos)) continue;
            tr.setNodeMarkup(pos, undefined, { ...newState.doc.nodeAt(pos)!.attrs, level: 2 });
          }
          return tr;
        },
      }),
    ];
  },
});
