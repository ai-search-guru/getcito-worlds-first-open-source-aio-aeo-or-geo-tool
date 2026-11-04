import { Extension } from '@tiptap/core';
import { DOMSerializer, type Fragment } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

/**
 * This editor's own copies (CE-005): a paste may bring HTML blocks back only
 * when it is a copy made here. ProseMirror's `data-pm-slice` can't tell:
 * every ProseMirror-based site puts it on its clipboard, and any page can
 * set it in a copy handler. So each copy made here carries a mark that only
 * this tab knows, and a paste keeps blocks only when it carries it.
 */

const OWN_COPY_ATTR = 'data-ce-copy';

/** Made once per tab: another page can't guess it. */
const nonce =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const MARKS = new RegExp(` ${OWN_COPY_ATTR}="[^"]*"`, 'g');

/**
 * Pasted HTML as a copy made in this tab's editor, its marks taken off (an
 * HTML block is read only in its plain form); null for any other paste.
 */
export function ownCopyHtml(html: string): string | null {
  return html.includes(`${OWN_COPY_ATTR}="${nonce}"`) ? html.replace(MARKS, '') : null;
}

/** The schema's own serializer, marking the top-level blocks of a copy. */
class MarkedSerializer extends DOMSerializer {
  serializeFragment(
    fragment: Fragment,
    options: { document?: Document } = {},
    target?: HTMLElement | DocumentFragment,
  ): HTMLElement | DocumentFragment {
    const out = super.serializeFragment(fragment, options, target);
    // Nested content is serialized into a target; only the copy itself is marked.
    if (!target) {
      for (const child of Array.from(out.childNodes)) {
        if (child.nodeType === 1) (child as Element).setAttribute(OWN_COPY_ATTR, nonce);
      }
    }
    return out;
  }
}

export const OwnCopies = Extension.create({
  name: 'ownCopies',
  addProseMirrorPlugins() {
    const base = DOMSerializer.fromSchema(this.editor.schema);
    return [
      new Plugin({
        props: { clipboardSerializer: new MarkedSerializer(base.nodes, base.marks) },
      }),
    ];
  },
});
