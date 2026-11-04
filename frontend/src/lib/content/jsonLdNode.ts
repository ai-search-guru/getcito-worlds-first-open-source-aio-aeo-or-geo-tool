import { Node } from '@tiptap/core';
import { jsonLdType, normalizeJsonLd } from './htmlAllowlist';

export interface JsonLdOptions {
  /** The block's label in the editor, from its schema type ("Schema · Product"). */
  label: (type: string | null) => string;
}

/**
 * Schema JSON-LD in a draft (Content Editor CE-020: "schema JSON-LD is
 * kept"). In the page's HTML it is the script element; in the editor, a
 * labelled block that isn't text, so it neither counts toward the length nor
 * gets typed into, and is edited in the HTML view. Its JSON is checked and
 * written again on the way in (normalizeJsonLd), so it can't carry markup.
 */
export const JsonLd = Node.create<JsonLdOptions>({
  name: 'jsonLd',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { label: (type) => (type ? `Schema · ${type}` : 'Schema') };
  },

  addAttributes() {
    return { json: { default: '{}', rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: 'script[type="application/ld+json"]',
        getAttrs: (el) => {
          const json = normalizeJsonLd((el.textContent ?? '').trim());
          return json ? { json } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    return ['script', { type: 'application/ld+json' }, node.attrs.json as string];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.contentEditable = 'false';
      dom.dataset.jsonLd = '';
      dom.className =
        'not-prose my-4 flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground';
      dom.textContent = `{ } ${this.options.label(jsonLdType(node.attrs.json as string))}`;
      return { dom };
    };
  },
});
