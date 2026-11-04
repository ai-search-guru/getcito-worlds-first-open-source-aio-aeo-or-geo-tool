import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { passageKey } from '@/lib/content/citedPassages';
import {
  CITED_EDIT_ALLOWED,
  CitedPassages,
  citedPassagesKey,
  keptCharacters,
  lockedPassageCount,
  htmlWithoutLocked,
  lockedKeysLeft,
  lockedPassagesLeft,
  rewriteFloor,
  type HeldEdit,
} from './_citedPassages';

vi.mock('@/lib/content/citedPassages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content/citedPassages')>();
  return { ...actual, passageKey: vi.fn(actual.passageKey) };
});

if (!('getClientRects' in Range.prototype)) {
  Object.assign(Range.prototype, {
    getClientRects: () => [] as unknown as DOMRectList,
    getBoundingClientRect: () => new DOMRect(),
  });
}

const QUOTED = 'Northwind forecasts each deal from real activity.';
const page = Array.from({ length: 200 }, (_, i) =>
  i === 5 ? `<p>${QUOTED}</p>` : `<p>Paragraph ${i} of the guide.</p>`,
).join('');

let editor: Editor;
const held: HeldEdit[] = [];

/** The position of the paragraph holding this text. */
function paragraphAt(text: string): { from: number; to: number } {
  let found = { from: -1, to: -1 };
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text)
      found = { from: pos, to: pos + node.nodeSize };
    return !node.isTextblock;
  });
  return found;
}

beforeEach(() => {
  held.length = 0;
  editor = new Editor({
    extensions: [StarterKit, CitedPassages.configure({ onHeld: (edit) => held.push(edit) })],
    content: page,
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(citedPassagesKey, {
      labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
      unlocked: new Set(),
    }),
  );
  vi.mocked(passageKey).mockClear();
});

afterEach(() => editor.destroy());

describe('keptCharacters', () => {
  it('counts what a page rewrite keeps as it is: quoted passages, quotes, lists holding one', () => {
    const quote = 'A customer said it saved them a week.';
    const small = new Editor({
      extensions: [StarterKit, CitedPassages.configure({ onHeld: () => {} })],
      content: `<p>${QUOTED}</p><p>Plain words to rewrite.</p><blockquote><p>${quote}</p></blockquote><ul><li><p>${QUOTED}</p></li></ul>`,
    });
    try {
      const lock = (unlocked: string[] = []) =>
        small.view.dispatch(
          small.state.tr.setMeta(citedPassagesKey, {
            labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
            unlocked: new Set(unlocked),
          }),
        );
      lock();
      expect(keptCharacters(small.state)).toBe(QUOTED.length * 2 + quote.length);
      // Unlocked by the person: the agent may reword it.
      lock([passageKey(QUOTED)]);
      expect(keptCharacters(small.state)).toBe(quote.length);
    } finally {
      small.destroy();
    }
  });
});

describe('rewriteFloor', () => {
  it('adds the headings and the least answer where nothing kept stands to what a rewrite keeps', () => {
    const quote = 'A customer said it saved them a week.';
    const small = new Editor({
      extensions: [StarterKit, CitedPassages.configure({ onHeld: () => {} })],
      content:
        '<h1>Title</h1><p>Summary to rewrite.</p>' +
        `<h2>Tool A</h2><p>${QUOTED}</p>` +
        `<h2>Tool B</h2><p>Plain answer.</p><blockquote><p>${quote}</p></blockquote>` +
        '<h3>Questions?</h3><p>Plain too.</p>',
    });
    try {
      const lock = (unlocked: string[] = []) =>
        small.view.dispatch(
          small.state.tr.setMeta(citedPassagesKey, {
            labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
            unlocked: new Set(unlocked),
          }),
        );
      lock();
      const kept = QUOTED.length + quote.length;
      const headings = 'Title'.length + 'Tool A'.length + 'Tool B'.length + 'Questions?'.length;
      // The quoted passage answers Tool A; a quote doesn't answer Tool B; the
      // summary and the question need theirs.
      expect(rewriteFloor(small.state, { summary: true })).toEqual({
        kept,
        floor: kept + headings + 100 * 3,
      });
      // No summary asked for: none counted.
      expect(rewriteFloor(small.state, { summary: false }).floor).toBe(kept + headings + 100 * 2);
      // Unlocked: Tool A's answer is the rewrite's to write.
      lock([passageKey(QUOTED)]);
      expect(rewriteFloor(small.state, { summary: true })).toEqual({
        kept: quote.length,
        floor: quote.length + headings + 100 * 4,
      });
    } finally {
      small.destroy();
    }
  });

  it('takes a quoted passage in a quote as the answer, and asks none of a heading over deeper ones', () => {
    const small = new Editor({
      extensions: [StarterKit, CitedPassages.configure({ onHeld: () => {} })],
      content:
        '<h1>Title</h1>' +
        // An empty paragraph under Tools still leaves it a heading that groups.
        `<h2>Tools</h2><p></p><h3>Tool A</h3><blockquote><p>${QUOTED}</p></blockquote>` +
        '<h3>Tool B</h3><p>Plain.</p>',
    });
    try {
      small.view.dispatch(
        small.state.tr.setMeta(citedPassagesKey, {
          labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
          unlocked: new Set(),
        }),
      );
      const headings = 'Title'.length + 'Tools'.length + 'Tool A'.length + 'Tool B'.length;
      // Tools groups; Tool A's answer is the quoted passage; only Tool B needs one.
      expect(rewriteFloor(small.state, { summary: false })).toEqual({
        kept: QUOTED.length,
        floor: QUOTED.length + headings + 100,
      });
    } finally {
      small.destroy();
    }
  });
});

describe('htmlWithoutLocked', () => {
  it('reads the page without the passages still locked, by their words', () => {
    const lock = (unlocked: string[] = []) =>
      editor.view.dispatch(
        editor.state.tr.setMeta(citedPassagesKey, {
          labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
          unlocked: new Set(unlocked),
        }),
      );
    lock();
    expect(lockedKeysLeft(editor.state)).toEqual([passageKey(QUOTED)]);
    const html = `<h1>T</h1><p>${QUOTED}</p><ul><li><p>${QUOTED}</p></li></ul><p>Free words.</p>`;
    expect(htmlWithoutLocked(html, new Set(lockedKeysLeft(editor.state)))).toBe(
      '<h1>T</h1><ul></ul><p>Free words.</p>',
    );
    // Unlocked by the person: the agent may change it, so it stays.
    lock([passageKey(QUOTED)]);
    expect(lockedKeysLeft(editor.state)).toEqual([]);
    expect(htmlWithoutLocked(html, new Set())).toBe(html);
  });
});

describe('locked passages', () => {
  it('marks the quoted passage and counts it, and how many a rewrite keeps', () => {
    expect(lockedPassageCount(editor.state)).toBe(1);
    expect(lockedPassagesLeft(editor.state)).toEqual({ count: 1, chars: QUOTED.length });
    expect(editor.view.dom.querySelectorAll('.cited-passage')).toHaveLength(1);
    // Unlocked by the person: a rewrite keeps none.
    editor.view.dispatch(
      editor.state.tr.setMeta(citedPassagesKey, {
        labels: new Map([[passageKey(QUOTED), 'Cited by ChatGPT 3×']]),
        unlocked: new Set([passageKey(QUOTED)]),
      }),
    );
    expect(lockedPassagesLeft(editor.state)).toEqual({ count: 0, chars: 0 });
  });

  it('reads only the paragraph a keystroke changes, not the whole page', () => {
    const { from } = paragraphAt('Paragraph 100 of the guide.');
    editor.view.dispatch(editor.state.tr.insertText('x', from + 2));
    // The changed paragraph, before and after; 199 others untouched.
    expect(vi.mocked(passageKey).mock.calls.length).toBeLessThanOrEqual(2);
    expect(lockedPassageCount(editor.state)).toBe(1);
    expect(held).toEqual([]);
  });

  it('keeps the mark when typing in the paragraph just before or after the quoted one', () => {
    for (const neighbour of ['Paragraph 4 of the guide.', 'Paragraph 6 of the guide.']) {
      const { from } = paragraphAt(neighbour);
      editor.view.dispatch(editor.state.tr.insertText('x', from + 2));
    }
    expect(editor.view.dom.querySelectorAll('.cited-passage')).toHaveLength(1);
    expect(lockedPassageCount(editor.state)).toBe(1);
  });

  it('holds a change that takes the quoted passage out, and lets one through when allowed', () => {
    const { from, to } = paragraphAt(QUOTED);
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(held).toHaveLength(1);
    expect(paragraphAt(QUOTED).from).toBe(from);

    editor.view.dispatch(editor.state.tr.delete(from, to).setMeta(CITED_EDIT_ALLOWED, true));
    expect(paragraphAt(QUOTED).from).toBe(-1);
    expect(lockedPassageCount(editor.state)).toBe(0);
  });

  it('lets the quoted passage move: it is still in the page', () => {
    const { from, to } = paragraphAt(QUOTED);
    const slice = editor.state.doc.slice(from, to);
    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.insert(end, slice.content).delete(from, to));
    expect(held).toEqual([]);
    expect(paragraphAt(QUOTED).from).toBeGreaterThan(from);
    expect(lockedPassageCount(editor.state)).toBe(1);
  });
});
