import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { cleanHref } from '@/lib/content/htmlAllowlist';

/**
 * Weak sources and competitors' pages in the draft (Quality CE-046): an
 * amber wavy underline on the link, with why on hover. A decoration, never
 * the page's, so no save, export, copy or CMS push has it. Quality's
 * suggestion has Show and Keep for each.
 */

export interface WeakSources {
  /** The links to mark, by their address as Trust reads it (cleanHref). */
  urls: ReadonlySet<string>;
  /** Why, on hover. */
  title: string;
}

interface WeakState extends WeakSources {
  marks: DecorationSet;
}

export const weakSourcesKey = new PluginKey<WeakState>('weakSources');

/** The editor's container takes the link's own underline away under it (_draft-editor). */
const WEAK_SOURCE = 'quality-weak-source';
const WEAK = `${WEAK_SOURCE} underline decoration-wavy decoration-amber-500 underline-offset-4 dark:decoration-amber-400`;

function decorate(doc: PmNode, { urls, title }: WeakSources): DecorationSet {
  if (!urls.size) return DecorationSet.empty;
  const marks: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const link = node.marks.find((mark) => mark.type.name === 'link');
    const href = link ? cleanHref(String(link.attrs.href ?? '')) : null;
    if (href && urls.has(href)) {
      marks.push(Decoration.inline(pos, pos + node.nodeSize, { class: WEAK, title }));
    }
  });
  return DecorationSet.create(doc, marks);
}

export const WeakSourcesMarks = Extension.create({
  name: 'weakSources',

  addProseMirrorPlugins() {
    return [
      new Plugin<WeakState>({
        key: weakSourcesKey,
        state: {
          init: () => ({ urls: new Set(), title: '', marks: DecorationSet.empty }),
          // Marked again when the list changes (the page read after typing
          // pauses) and on every change of the page while one is listed: a
          // restore, an accepted suggestion or a new link to the same source
          // changes which text holds it.
          apply: (tr, prev) => {
            const next = tr.getMeta(weakSourcesKey) as WeakSources | undefined;
            if (next) return { ...next, marks: decorate(tr.doc, next) };
            return tr.docChanged && prev.urls.size
              ? { ...prev, marks: decorate(tr.doc, prev) }
              : prev;
          },
        },
        props: {
          decorations: (state) => weakSourcesKey.getState(state)?.marks ?? null,
        },
      }),
    ];
  },
});
