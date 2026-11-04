import { Editor } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { trustBlocks } from '@/lib/content/qualityChecks';
import { ClaimMarksExtension, claimMarksKey, textRanges, writingBlock } from './_claimMarks';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const open = (content: string) => {
  editor?.destroy();
  editor = new Editor({
    extensions: [
      StarterKit,
      TableKit.configure({ table: { resizable: false } }),
      ClaimMarksExtension,
    ],
    content,
  });
  return editor;
};
const words = (e: Editor, { from, to }: { from: number; to: number }) =>
  e.state.doc.textBetween(from, to);

/** Claims with no source (Quality CE-045): found by their words, underlined in the draft. */
describe('textRanges', () => {
  it('finds a text in its block, across bold and links, each time it is there', () => {
    const e = open(
      '<h1>Title</h1><p>Ledgerly is <strong>the fastest</strong> app. Ledgerly is the fastest app.</p>',
    );
    const ranges = textRanges(e.state.doc, 'the fastest app');
    expect(ranges).toHaveLength(2);
    for (const range of ranges) expect(words(e, range)).toBe('the fastest app');
    // Not across two blocks.
    expect(textRanges(open('<p>the fastest</p><p>app</p>').state.doc, 'the fastest app')).toEqual(
      [],
    );
  });

  it("finds Trust's words where the page has no space: a link's edge, a line break, a no-break space", () => {
    const html =
      '<p>Teams save 40<strong>%</strong> (<a href="https://x.example">report</a>).</p>' +
      '<p>First line<br>SOC 2\u00a0certified plans.</p>';
    const e = open(html);
    const [first, second] = trustBlocks(html).map((b) => b.text);
    // As Trust reads them: "40 %", "( report)", the break and the no-break space a space.
    expect(first).toBe('Teams save 40 % ( report).');
    expect(second).toBe('First line SOC 2 certified plans.');
    const [a] = textRanges(e.state.doc, first, first);
    expect(words(e, a)).toBe('Teams save 40% (report).');
    const [b] = textRanges(e.state.doc, 'line SOC 2 certified', second);
    expect(words(e, b)).toBe('lineSOC 2\u00a0certified');
  });

  it("looks in the claim's block only, never in a heading", () => {
    const html =
      '<h2>Why Ledgerly is the fastest forecasting app</h2>' +
      '<p>Ledgerly is the fastest forecasting app, <a href="https://g2.example">G2</a> says.</p>' +
      '<p>Ledgerly is the fastest forecasting app for small teams.</p>';
    const e = open(html);
    const blocks = trustBlocks(html);
    const ranges = textRanges(e.state.doc, 'the fastest forecasting app', blocks[1].text);
    expect(ranges).toHaveLength(1);
    // The third paragraph's, not the heading's or the sourced one's.
    expect(e.state.doc.resolve(ranges[0].from).parent.textContent).toContain('small teams');
    // A list item's own words hold its paragraph, not its nested list's.
    const list = '<ul><li><p>Rated #1 by G2.</p><ul><li><p>Rated #1 by G2.</p></li></ul></li></ul>';
    const inList = open(list);
    expect(textRanges(inList.state.doc, 'Rated #1', trustBlocks(list)[0].text)).toHaveLength(2);
  });
});

describe('writingBlock', () => {
  const at = (e: Editor, text: string) => {
    let pos = -1;
    e.state.doc.descendants((node, p) => {
      if (pos === -1 && node.isText && node.text?.includes(text)) pos = p + 1;
    });
    e.commands.setTextSelection(pos);
    return writingBlock(e);
  };

  it("reads the cursor's block as Trust does: a paragraph, a list item, a quote, a cell", () => {
    const html =
      '<h2>A heading</h2><p>Teams save <strong>40</strong>% (<a href="https://x.example">report</a>).</p>' +
      '<ul><li><p>Outer item</p><ul><li><p>Inner item</p></li></ul></li></ul>' +
      '<blockquote><p>Rated #1.</p><p>Loved by users.</p></blockquote>' +
      '<table><tbody><tr><td><p>Clinically tested</p></td><td><p>Other cell</p></td></tr></tbody></table>';
    const e = open(html);
    const blocks = trustBlocks(e.getHTML()).map((b) => b.text);
    expect(at(e, 'Teams save')).toBe(blocks[0]);
    expect(at(e, 'Outer item')).toBe('Outer item');
    expect(at(e, 'Inner item')).toBe('Inner item');
    expect(at(e, 'Loved by')).toBe('Rated #1. Loved by users.');
    expect(at(e, 'Clinically')).toBe('Clinically tested');
    expect(blocks).toEqual(
      expect.arrayContaining(['Outer item', 'Rated #1. Loved by users.', 'Clinically tested']),
    );
    // Not Trust's: nothing to leave for later.
    expect(at(e, 'A heading')).toBeNull();
  });
});

describe('ClaimMarksExtension', () => {
  it('underlines each claim in its block with why on hover, and moves the marks as the page changes', () => {
    const e = open('<h2>SOC 2 certified</h2><p>Every plan is SOC 2 certified.</p>');
    const mark = {
      text: 'SOC 2 certified',
      sentence: 'Every plan is SOC 2 certified.',
      block: 'Every plan is SOC 2 certified.',
    };
    e.view.dispatch(e.state.tr.setMeta(claimMarksKey, { marks: [mark], title: 'No source.' }));
    const found = claimMarksKey.getState(e.state)!.decorations.find();
    expect(found).toHaveLength(1);
    expect(words(e, found[0])).toBe('SOC 2 certified');
    expect(e.view.dom.querySelector('h2 [title]')).toBeNull();
    expect(e.view.dom.querySelector('p [title="No source."]')?.textContent).toBe('SOC 2 certified');
    // Typing before it moves the mark with the words.
    e.commands.insertContentAt(e.state.doc.child(0).nodeSize + 1, 'Now ');
    const moved = claimMarksKey.getState(e.state)!.decorations.find();
    expect(words(e, moved[0])).toBe('SOC 2 certified');
    // An empty list clears them.
    e.view.dispatch(e.state.tr.setMeta(claimMarksKey, { marks: [], title: '' }));
    expect(claimMarksKey.getState(e.state)!.decorations.find()).toEqual([]);
  });
});
