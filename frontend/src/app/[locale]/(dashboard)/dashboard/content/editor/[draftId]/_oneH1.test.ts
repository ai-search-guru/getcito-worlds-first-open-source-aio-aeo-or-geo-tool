import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { ONE_H1_AS_IS, OneH1, h1Positions } from './_oneH1';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const open = (content: string) => {
  editor = new Editor({ extensions: [StarterKit, OneH1], content });
  return editor;
};

/** The page, without the empty line the editor keeps after a last heading. */
const html = (e: Editor) => e.getHTML().replace(/(<p><\/p>)+$/, '');

/** One H1 per page: a second one, however it comes, is an H2. */
describe('OneH1', () => {
  it('makes a pasted or inserted H1 an H2, keeping the page’s own', () => {
    const e = open('<h1>Title</h1><p>Text</p>');
    e.commands.insertContentAt(e.state.doc.content.size, '<h1>Pasted</h1><p>More</p>');
    expect(html(e)).toBe('<h1>Title</h1><p>Text</p><h2>Pasted</h2><p>More</p>');

    // Above the title too: the title stays the H1.
    e.commands.insertContentAt(0, '<h1>Above</h1>');
    expect(html(e)).toBe('<h2>Above</h2><h1>Title</h1><p>Text</p><h2>Pasted</h2><p>More</p>');
  });

  it('turns Heading 1 on a second block into Heading 2', () => {
    const e = open('<h1>Title</h1><p>Text</p>');
    e.chain().setTextSelection(9).toggleHeading({ level: 1 }).run();
    expect(html(e)).toBe('<h1>Title</h1><h2>Text</h2>');
  });

  it('lets a page without one have its H1, and a whole new page keep its first', () => {
    const e = open('<p>Text</p>');
    e.chain().setTextSelection(1).toggleHeading({ level: 1 }).run();
    expect(html(e)).toBe('<h1>Text</h1>');

    // The HTML view writes the page anew.
    e.commands.setContent('<h1>One</h1><p>a</p><h1>Two</h1>');
    expect(html(e)).toBe('<h1>One</h1><p>a</p><h2>Two</h2>');
  });

  it('leaves a page that already had two as it was, for the person to fix', () => {
    const e = open('<h1>One</h1><p>a</p><h1>Two</h1>');
    e.commands.insertContentAt(4, ' more');
    expect(html(e)).toBe('<h1>One more</h1><p>a</p><h1>Two</h1>');
  });

  it('keeps the title when an H1 lands right at its start', () => {
    const e = open('<h1>Title</h1><p>Text</p>');
    e.commands.insertContentAt(1, '<h1>New</h1>');
    expect(html(e)).toContain('<h1>Title</h1>');
    expect(html(e).match(/<h1>/g)).toHaveLength(1);
  });

  it('restores a version from History as it was', () => {
    const e = open('<h1>Title</h1><p>Text</p>');
    e.chain().setMeta(ONE_H1_AS_IS, true).setContent('<h1>One</h1><h1>Two</h1>').run();
    expect(html(e)).toBe('<h1>One</h1><h1>Two</h1>');
  });

  it('never lets an empty H1 line stay over the title', () => {
    const e = open('<h1></h1><p>Text</p>');
    e.commands.insertContentAt(e.state.doc.content.size, '<h1>Title</h1>');
    expect(html(e)).toContain('<h1>Title</h1>');
    expect(h1Positions(e.state.doc)).toHaveLength(1);
  });

  it('finds the H1s in lists and cells too', () => {
    const e = open('<h1>A</h1><ul><li><h1>B</h1></li></ul>');
    expect(h1Positions(e.state.doc)).toHaveLength(2);
  });
});
