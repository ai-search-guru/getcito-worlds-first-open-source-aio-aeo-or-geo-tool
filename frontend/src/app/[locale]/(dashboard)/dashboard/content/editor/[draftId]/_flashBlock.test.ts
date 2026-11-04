import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { findBlock } from './_flashBlock';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const open = (content: string) => {
  editor?.destroy();
  editor = new Editor({ extensions: [StarterKit], content });
  return editor.state.doc;
};

/** Quality's Show (CE-039): the block of the page a passage is in. */
describe('findBlock', () => {
  it('finds the smallest block holding the passage', () => {
    const doc = open('<h1>Title</h1><blockquote><p>Quoted words.</p><p>More.</p></blockquote>');
    const at = findBlock(doc, 'Quoted words.')!;
    expect(doc.nodeAt(at.from)?.type.name).toBe('paragraph');
    expect(doc.nodeAt(at.from)?.textContent).toBe('Quoted words.');
  });

  it('goes to the first copy of a passage the page has twice', () => {
    // Title, then the passage, a paragraph between, and the passage again.
    let doc = open(
      '<h1>Title</h1><p>Check deals weekly.</p><p>Between.</p><p>Check deals weekly.</p>',
    );
    const first = doc.child(0).nodeSize;
    expect(findBlock(doc, 'Check deals weekly.')).toEqual({
      from: first,
      to: first + doc.child(1).nodeSize,
    });
    // Inside a quote too: its first paragraph, not its second.
    doc = open('<blockquote><p>Check deals weekly.</p><p>Check deals weekly.</p></blockquote>');
    expect(findBlock(doc, 'Check deals weekly.')).toEqual({
      from: 1,
      to: 1 + doc.child(0).child(0).nodeSize,
    });
  });

  it('finds nothing for a passage the page no longer has', () => {
    const doc = open('<p>Check deals weekly.</p>');
    expect(findBlock(doc, 'Gone now.')).toBeNull();
    expect(findBlock(doc, '   ')).toBeNull();
  });
});
