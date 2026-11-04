import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * The page's byline in a grey "Page info" strip right under the H1 (Quality
 * spec §9 and its full mockup, CE-038): the author is page metadata, which the CMS shows, never the
 * page's text. A decoration, never the page's: no save, export, Copy, Copy
 * HTML or HTML view has it.
 */

export interface PageInfo {
  /** "Page info · shown by your CMS, not part of the content". */
  label: string;
  /** "By Ada Lovelace · Head of Content, Acme · Updated Oct 23, 2026". */
  byline: string;
  /** The author's initials, or the brand's for its team. */
  initials: string;
  /** The author's photo (https), when they have one. */
  photoUrl: string | null;
}

export const pageInfoKey = new PluginKey<PageInfo | null>('pageInfo');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** One line, as the mockup draws it: the author's face, the byline, the label on the right. */
function strip({ label, byline, initials, photoUrl }: PageInfo): HTMLElement {
  const box = document.createElement('div');
  box.className =
    'not-prose mt-1.5 mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-dashed bg-muted/40 px-2.5 py-1.5 leading-snug select-none';
  box.contentEditable = 'false';
  // The header's author menu says the same; a screen reader reading the page
  // shouldn't take it for the page's text.
  box.setAttribute('aria-hidden', 'true');
  box.dataset.pageInfo = '';
  const face = 'h-[22px] w-[22px] shrink-0 rounded-full';
  if (photoUrl) {
    const img = document.createElement('img');
    img.className = `${face} object-cover`;
    img.src = photoUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    box.append(img);
  } else {
    box.append(
      el(
        'span',
        `${face} inline-flex items-center justify-center bg-muted text-[9px] font-semibold text-foreground`,
        initials,
      ),
    );
  }
  // Spans and divs, not paragraphs: nothing that looks for the page's paragraphs finds it.
  box.append(
    el('span', 'text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]', byline),
    el('span', 'ml-auto text-[11px] text-muted-foreground/80', label),
  );
  return box;
}

/** Where the strip goes: under the H1 that opens the page, else at the top. */
export function pageInfoAt(doc: PmNode): number {
  const first = doc.firstChild;
  return first?.type.name === 'heading' && first.attrs.level === 1 ? first.nodeSize : 0;
}

export const PageInfoStrip = Extension.create({
  name: 'pageInfo',

  addProseMirrorPlugins() {
    return [
      new Plugin<PageInfo | null>({
        key: pageInfoKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(pageInfoKey) as PageInfo | null | undefined;
            return meta === undefined ? value : meta;
          },
        },
        props: {
          decorations: (state) => {
            const info = pageInfoKey.getState(state);
            if (!info) return null;
            return DecorationSet.create(state.doc, [
              // Right under the H1: before a suggestion's card for the next
              // block (side -1) and the agent's drafting card (side 1).
              Decoration.widget(pageInfoAt(state.doc), () => strip(info), {
                key: `page-info:${info.label}:${info.byline}:${info.photoUrl ?? info.initials}`,
                side: -2,
                ignoreSelection: true,
                stopEvent: () => true,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
