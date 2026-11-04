import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PlaceholderMarks,
  placeholderIndexAt,
  placeholderMarksKey,
  placeholderRanges,
  selectPlaceholder,
  stepPlaceholder,
} from './_placeholderMarks';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const open = (content: string) => {
  editor = new Editor({ extensions: [StarterKit, PlaceholderMarks], content });
  return editor;
};

/** Each placeholder's text, as the page reads. */
const texts = (e: Editor) =>
  placeholderRanges(e.state.doc).map((r) => e.state.doc.textBetween(r.from, r.to));

/** The page's placeholders (CE-044), marked and stepped through. */
describe('placeholderRanges', () => {
  it("finds every placeholder in order, in paragraphs and lists, across a line's marks", () => {
    const e = open(
      '<h1>Title</h1><p>Rivals like [competitor] lead. Ensure your <strong>[About]</strong> and [Documentation] pages.</p>' +
        '<ul><li><p>Check [OpenAI release notes]</p></li></ul><p>Not [1], [x] or [docs](https://a.example).</p>',
    );
    expect(texts(e)).toEqual([
      '[competitor]',
      '[About]',
      '[Documentation]',
      '[OpenAI release notes]',
    ]);
  });

  it("reads a heading's only in the agent's own forms", () => {
    const e = open(
      '<h2>Best CRM tools [2026 Update]</h2><h2>Grew [figure, source] last year</h2><p>[price]</p>',
    );
    expect(texts(e)).toEqual(['[figure, source]', '[price]']);
  });

  it('finds two that read the same as two', () => {
    const e = open('<p>See [notes].</p><h2>FAQ</h2><p>Also in [notes].</p>');
    expect(texts(e)).toEqual(['[notes]', '[notes]']);
  });
});

describe('PlaceholderMarks', () => {
  it('tints each placeholder, and follows the page as it changes', () => {
    const e = open('<p>Rivals like [competitor] and [partner] lead.</p>');
    const marks = () =>
      [...e.view.dom.querySelectorAll('[data-placeholder-mark]')].map((m) => m.textContent);
    expect(marks()).toEqual(['[competitor]', '[partner]']);
    expect(placeholderMarksKey.getState(e.state)?.ranges).toHaveLength(2);

    const [first] = placeholderRanges(e.state.doc);
    e.chain().setTextSelection({ from: first.from, to: first.to }).insertContent('Acme').run();
    expect(marks()).toEqual(['[partner]']);
    expect(placeholderMarksKey.getState(e.state)?.ranges).toHaveLength(1);
  });
});

describe('stepPlaceholder', () => {
  const ranges = [
    { from: 5, to: 10, block: { from: 0, to: 20 } },
    { from: 25, to: 30, block: { from: 20, to: 40 } },
    { from: 45, to: 50, block: { from: 40, to: 60 } },
  ];

  it('goes to the next one after the cursor, and round to the first past the last', () => {
    expect(stepPlaceholder(ranges, 0, 1)).toBe(ranges[0]);
    expect(stepPlaceholder(ranges, 7, 1)).toBe(ranges[1]);
    expect(stepPlaceholder(ranges, 12, 1)).toBe(ranges[1]);
    expect(stepPlaceholder(ranges, 47, 1)).toBe(ranges[0]);
    expect(stepPlaceholder(ranges, 55, 1)).toBe(ranges[0]);
  });

  it('goes to the one before, and round to the last before the first', () => {
    expect(stepPlaceholder(ranges, 27, -1)).toBe(ranges[0]);
    expect(stepPlaceholder(ranges, 40, -1)).toBe(ranges[1]);
    expect(stepPlaceholder(ranges, 7, -1)).toBe(ranges[2]);
    expect(stepPlaceholder(ranges, 0, -1)).toBe(ranges[2]);
  });

  it('finds none in a page without one', () => {
    expect(stepPlaceholder([], 3, 1)).toBeNull();
  });

  it('goes on past two that touch, the second selected starting where the first ends', () => {
    const e = open('<p>Call [ab][cd] or [ef].</p>');
    const found = placeholderRanges(e.state.doc);
    expect(found.map((r) => e.state.doc.textBetween(r.from, r.to))).toEqual([
      '[ab]',
      '[cd]',
      '[ef]',
    ]);
    expect(found[0].to).toBe(found[1].from);
    // On the second (its start is the first's end), Next is the third, not the second again.
    expect(placeholderIndexAt(found, found[1].from)).toBe(1);
    expect(stepPlaceholder(found, found[1].from, 1)).toBe(found[2]);
    expect(stepPlaceholder(found, found[1].from, -1)).toBe(found[0]);
    // On the first, Next is the second.
    expect(stepPlaceholder(found, found[0].from, 1)).toBe(found[1]);
  });
});

describe('placeholderIndexAt', () => {
  const ranges = [
    { from: 5, to: 10, block: { from: 0, to: 30 } },
    { from: 10, to: 15, block: { from: 0, to: 30 } },
    { from: 20, to: 25, block: { from: 0, to: 30 } },
  ];

  it('reads the one the cursor is in, at its end too, and the second where two touch', () => {
    expect(placeholderIndexAt(ranges, 7)).toBe(0);
    expect(placeholderIndexAt(ranges, 10)).toBe(1);
    expect(placeholderIndexAt(ranges, 25)).toBe(2);
    expect(placeholderIndexAt(ranges, 17)).toBe(-1);
  });
});

describe('selectPlaceholder', () => {
  it('selects the placeholder, to type over', () => {
    const e = open('<p>Rivals like [competitor] lead.</p>');
    selectPlaceholder(e, placeholderRanges(e.state.doc)[0]);
    const { from, to } = e.state.selection;
    expect(e.state.doc.textBetween(from, to)).toBe('[competitor]');
  });
});
