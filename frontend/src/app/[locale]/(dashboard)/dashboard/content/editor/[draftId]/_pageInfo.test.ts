import { Editor, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { PageInfoStrip, pageInfoAt, pageInfoKey } from './_pageInfo';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const open = (content: string) => {
  editor = new Editor({ extensions: [StarterKit, PageInfoStrip], content });
  return editor;
};

const INFO = {
  label: 'Page info · shown by your CMS, not part of the content',
  byline: 'By Ada Lovelace · Head of Content, Acme · Updated Oct 23, 2026',
  initials: 'AL',
  photoUrl: null as string | null,
};

const show = (e: Editor, info: typeof INFO | null) =>
  e.view.dispatch(e.state.tr.setMeta(pageInfoKey, info));

/** The page's byline (CE-038): editor-only, outside the page. */
describe('PageInfoStrip', () => {
  it('shows the byline under the H1, outside the page', () => {
    const e = open('<h1>Pipeline forecasting</h1><p>Teams trust it.</p>');
    show(e, INFO);

    const strip = e.view.dom.querySelector<HTMLElement>('[data-page-info]')!;
    // One line, as the mockup: the author's initials, the byline, the label.
    expect(strip.textContent).toBe(INFO.initials + INFO.byline + INFO.label);
    expect(strip.contentEditable).toBe('false');
    expect(strip.previousElementSibling?.tagName).toBe('H1');
    // No save, export, Copy HTML or HTML view has it: they read the page.
    expect(e.getHTML()).toBe('<h1>Pipeline forecasting</h1><p>Teams trust it.</p>');
    expect(e.getText()).not.toContain('Page info');
  });

  it('follows the author, and leaves when there is none to show', () => {
    const e = open('<h1>Title</h1><p>Text</p>');
    show(e, INFO);
    show(e, { ...INFO, byline: 'By Acme Team · Updated Oct 23, 2026' });
    const strips = e.view.dom.querySelectorAll('[data-page-info]');
    expect(strips).toHaveLength(1);
    expect(strips[0].textContent).toContain('By Acme Team');

    // Typing keeps it.
    e.commands.insertContentAt(e.state.doc.content.size, '<p>More</p>');
    expect(e.view.dom.querySelectorAll('[data-page-info]')).toHaveLength(1);

    show(e, null);
    expect(e.view.dom.querySelector('[data-page-info]')).toBeNull();
  });

  it("stays under the H1, above a suggestion's card for the next block", () => {
    // A card the way _suggestions.ts draws one: before its block (side -1).
    const Card = Extension.create({
      name: 'card',
      addProseMirrorPlugins: () => [
        new Plugin({
          props: {
            decorations: (state) =>
              DecorationSet.create(state.doc, [
                Decoration.widget(
                  state.doc.firstChild!.nodeSize,
                  () => Object.assign(document.createElement('div'), { className: 'card' }),
                  { side: -1 },
                ),
              ]),
          },
        }),
      ],
    });
    editor = new Editor({
      extensions: [StarterKit, PageInfoStrip, Card],
      content: '<h1>Title</h1><p>Text</p>',
    });
    show(editor, INFO);
    const order = [...editor.view.dom.children].map((el) =>
      el instanceof HTMLElement && 'pageInfo' in el.dataset
        ? 'strip'
        : el.classList.contains('card')
          ? 'card'
          : el.tagName,
    );
    expect(order).toEqual(['H1', 'strip', 'card', 'P']);
  });

  it("shows the author's photo instead of initials when they have one", () => {
    const e = open('<h1>Title</h1><p>Text</p>');
    show(e, { ...INFO, photoUrl: 'https://example.com/ada.jpg' });
    const img = e.view.dom.querySelector<HTMLImageElement>('[data-page-info] img')!;
    expect(img.src).toBe('https://example.com/ada.jpg');
    expect(img.alt).toBe('');
    expect(e.view.dom.querySelector('[data-page-info]')!.textContent).toBe(
      INFO.byline + INFO.label,
    );
  });

  it('goes at the top of a page that has no H1 first', () => {
    expect(pageInfoAt(open('<p>Text</p><h1>Late title</h1>').state.doc)).toBe(0);
    editor?.destroy();
    const e = open('<h1>Title</h1><p>Text</p>');
    expect(pageInfoAt(e.state.doc)).toBe(e.state.doc.firstChild!.nodeSize);
  });
});
