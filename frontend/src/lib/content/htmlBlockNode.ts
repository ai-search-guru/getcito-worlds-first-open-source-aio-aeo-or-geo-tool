import { Node } from '@tiptap/core';
import { decodeHtmlBlock, encodeHtmlBlock } from './htmlAllowlist';

/**
 * An HTML block's place in the page's schema (CE-028): the node as the
 * editor parses and writes it, without its view, so the server can read a
 * page into the same document (the go-live gate, docText.ts). The editor's
 * HtmlBlock adds its view (_HtmlBlock.tsx).
 */
export const HtmlBlockNode = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { code: { default: '', rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-html-block]',
        getAttrs: (el) => {
          const code = decodeHtmlBlock(el.getAttribute('data-html-block') ?? '');
          return code ? { code } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    return ['div', { 'data-html-block': encodeHtmlBlock(node.attrs.code as string) }];
  },
});
