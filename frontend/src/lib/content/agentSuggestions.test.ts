import { describe, expect, it } from 'vitest';
import { passageKey } from './citedPassages';
import {
  cleanInsertHtml,
  draftPassages,
  inlineText,
  keepAgentSuggestions,
  splitReplace,
} from './agentSuggestions';
import { linkKey } from './linkTargets';

const HTML =
  '<h1>How to brew pour-over</h1><p>Use good coffee &amp; hot water.</p>' +
  '<ul><li><p>A <strong>dripper</strong></p></li></ul>' +
  '<table><tbody><tr><td><p>Ratio</p></td></tr></tbody></table>' +
  '<div data-html-block="PHA+aGk8L3A+"></div><p>Pour&nbsp;slowly.</p>';

describe('draftPassages', () => {
  it('reads headings and paragraphs in order, with the text the editor has', () => {
    expect(draftPassages(HTML)).toEqual([
      { tag: 'h1', text: 'How to brew pour-over' },
      { tag: 'p', text: 'Use good coffee & hot water.' },
      { tag: 'p', text: 'A dripper' },
      { tag: 'p', text: 'Ratio' },
      // A non-breaking space, as the editor keeps it.
      { tag: 'p', text: 'Pour\u00a0slowly.' },
    ]);
  });
});

describe('cleanInsertHtml', () => {
  it('keeps simple blocks without attributes and drops scripts', () => {
    expect(
      cleanInsertHtml(
        '<h2 class="x">FAQ</h2><p onclick="y()">How long? <a href="z">3 min</a></p><script>bad()</script><img src="a">',
      ),
    ).toBe('<h2>FAQ</h2><p>How long? 3 min</p>');
  });

  it('makes an agent’s H1 an H2: the page has its title', () => {
    expect(cleanInsertHtml('<h1 class="x">New title</h1><p>Text</p>')).toBe(
      '<h2>New title</h2><p>Text</p>',
    );
  });
});

describe('keepAgentSuggestions', () => {
  const passages = draftPassages(HTML);
  const locked = new Set([passageKey('A dripper')]);
  const replace = (over = {}) => ({
    kind: 'replace' as const,
    passage: 2,
    before: 'good coffee',
    after: '15 g of coffee',
    reason: 'add a number (rule)',
    rules: ['dated', 'dated'],
    ...over,
  });

  it('keeps a replace found in its passage, and an insert cleaned', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [
        replace(),
        {
          kind: 'insert',
          passage: 3,
          after: '<h2>FAQ</h2><p>Q? <em>A</em></p>',
          reason: 'add FAQ block',
        },
      ],
      passages,
      locked,
    );
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        kind: 'replace',
        block_text: 'Use good coffee & hot water.',
        before_text: 'good coffee',
        after_text: '15 g of coffee',
        reason: 'add a number (rule)',
        rule_keys: ['dated'],
      },
      {
        kind: 'insert',
        block_text: 'A dripper',
        before_text: '',
        after_text: '<h2>FAQ</h2><p>Q? <em>A</em></p>',
        reason: 'add FAQ block',
        rule_keys: [],
      },
    ]);
  });

  it('says why each one it drops was dropped', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [
        replace({ passage: 9 }),
        replace({ passage: 3, before: 'dripper', after: 'cone' }),
        replace({ before: 'cold water' }),
        replace({ after: 'good coffee' }),
        replace({ after: '<p></p>' }),
        replace(),
        replace(),
      ],
      passages,
      locked,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual([
      { index: 0, reason: 'no_passage' },
      { index: 1, reason: 'locked' },
      { index: 2, reason: 'not_in_passage' },
      { index: 3, reason: 'no_change' },
      { index: 4, reason: 'empty' },
      { index: 6, reason: 'duplicate' },
    ]);
  });
});

/**
 * An answer written into a heading's replace was glued onto the heading's
 * line ("What is LLM SEO? LLM SEO optimizes…"): it now goes after it.
 */
describe('a replace on a heading', () => {
  const page = draftPassages('<h2>What is LLM SEO</h2><p>It is new.</p><h2>FAQ</h2>');
  const heading = (after: string, over = {}) => ({
    kind: 'replace' as const,
    passage: 1,
    before: 'What is LLM SEO',
    after,
    reason: 'answer under the H2',
    ...over,
  });

  it('keeps the question in the heading and inserts its answer after it', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [heading('What is LLM SEO? LLM SEO optimizes pages for large language models & AI.')],
      page,
      new Set(),
    );
    expect(dropped).toEqual([]);
    expect(kept.map((k) => [k.kind, k.block_text, k.after_text])).toEqual([
      ['replace', 'What is LLM SEO', 'What is LLM SEO?'],
      [
        'insert',
        'What is LLM SEO',
        '<p>LLM SEO optimizes pages for large language models &amp; AI.</p>',
      ],
    ]);
  });

  it('turns a FAQ sent as a heading replace into the heading and an insert', () => {
    const { kept } = keepAgentSuggestions(
      [
        heading(
          '<h2>Frequently Asked Questions</h2><h3>What is an AEO tracker?</h3><p>It monitors AI answers.</p>',
          { passage: 3, before: 'FAQ' },
        ),
      ],
      page,
      new Set(),
    );
    expect(kept.map((k) => [k.kind, k.after_text])).toEqual([
      ['replace', 'Frequently Asked Questions'],
      ['insert', '<h3>What is an AEO tracker?</h3><p>It monitors AI answers.</p>'],
    ]);
  });

  it('says when a heading would still run over its length', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [heading('What is LLM SEO '.repeat(10))],
      page,
      new Set(),
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ index: 0, reason: 'heading_too_long' }]);
  });

  it('says when a heading would ask a second question, and keeps a question reworded', () => {
    const faq = draftPassages(
      '<h2>FAQ</h2><h3>What is AEO?</h3><p>Answer engine optimization.</p>',
    );
    const run = (after: string) =>
      keepAgentSuggestions(
        [{ kind: 'replace', passage: 2, before: 'What is AEO?', after, reason: 'fan-out' }],
        faq,
        new Set(),
      );
    // A fan-out's question added to the one there.
    expect(run('What is AEO? What is an AEO tracker?')).toEqual({
      kept: [],
      dropped: [{ index: 0, reason: 'heading_two_questions' }],
    });
    // Past the limit, or with its answer, the second question isn't moved
    // under the first as if it answered it.
    expect(
      run(`What is AEO? How does ${'an AEO tracker read many engines and '.repeat(3)}work?`)
        .dropped,
    ).toEqual([{ index: 0, reason: 'heading_two_questions' }]);
    expect(
      run(
        'What is AEO? What is an AEO tracker? An AEO tracker is a tool that reads many AI engines for you.',
      ).dropped,
    ).toEqual([{ index: 0, reason: 'heading_two_questions' }]);
    // The question reworded into the fan-out's words.
    expect(run('What is an AEO tracker?').kept).toEqual([
      expect.objectContaining({ kind: 'replace', after_text: 'What is an AEO tracker?' }),
    ]);
  });

  it('holds an H1 to 70 characters and other headings to 90, unless they get shorter', () => {
    const run = (html: string, before: string, after: string) =>
      keepAgentSuggestions(
        [{ kind: 'replace', passage: 1, before, after, reason: 'tighten' }],
        draftPassages(html),
        new Set(),
      ).dropped;
    expect(run('<h1>Guide</h1>', 'Guide', 'x'.repeat(70))).toEqual([]);
    expect(run('<h1>Guide</h1>', 'Guide', 'x'.repeat(71))).toEqual([
      { index: 0, reason: 'heading_too_long' },
    ]);
    expect(run('<h2>Guide</h2>', 'Guide', 'x'.repeat(90))).toEqual([]);
    expect(run('<h3>Guide</h3>', 'Guide', 'x'.repeat(91))).toEqual([
      { index: 0, reason: 'heading_too_long' },
    ]);
    // An imported heading already over its limit may still be shortened.
    expect(run(`<h2>${'y'.repeat(120)}</h2>`, 'y'.repeat(20), 'z'.repeat(10))).toEqual([]);
  });

  it('keeps a split suggestion whole, or not at all, at the cap', () => {
    const many = Array.from({ length: 19 }, (_, i) => ({
      kind: 'insert' as const,
      passage: 2,
      after: `<p>Note ${i}.</p>`,
      reason: 'note',
    }));
    const { kept, dropped } = keepAgentSuggestions(
      [...many, heading('What is LLM SEO? LLM SEO optimizes pages for large language models.')],
      page,
      new Set(),
    );
    expect(kept).toHaveLength(19);
    expect(dropped).toEqual([{ index: 19, reason: 'too_many' }]);
  });

  it('puts the answer first under the heading when blocks come with it', () => {
    expect(
      splitReplace(
        'What is LLM SEO? LLM SEO optimizes pages for large language models.<ul><li>a</li></ul>',
        'h2',
      ),
    ).toMatchObject({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><ul><li>a</li></ul>',
    });
    expect(
      splitReplace(
        '<h2>What is LLM SEO? LLM SEO optimizes pages for large language models.</h2><p>More.</p>',
        'h2',
      ).blocks,
    ).toBe('<p>LLM SEO optimizes pages for large language models.</p><p>More.</p>');
  });

  it('keeps a subtitle that fits, and splits after a full-width ？ with no space', () => {
    const subtitle = 'What is AEO? The Complete Guide to Answer Engine Optimization';
    expect(splitReplace(subtitle, 'h1')).toMatchObject({ words: subtitle, blocks: '' });
    expect(
      splitReplace(
        'AEOとは？AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。',
        'h2',
      ).words,
    ).toBe('AEOとは？');
    // "?" inside a word is no question's end.
    expect(splitReplace('What?No. A long enough sentence that ends here.', 'h2').blocks).toBe('');
    // Past the heading's limit the rest goes under it, a full stop or not.
    const long = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models '.repeat(2)}`;
    expect(splitReplace(long, 'h2').words).toBe('What is LLM SEO?');
  });

  it('keeps a heading with a second clause, and moves blocks off a paragraph', () => {
    // A short second part is the heading's, not an answer.
    expect(splitReplace("Is AEO worth it? Here's what the data says.", 'h2').blocks).toBe('');
    expect(
      splitReplace(
        'AEO とは？ AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。',
        'h2',
      ).words,
    ).toBe('AEO とは？');
    expect(splitReplace('AEO or SEO? Which matters more in 2026', 'h2')).toMatchObject({
      words: 'AEO or SEO? Which matters more in 2026',
      blocks: '',
    });
    expect(splitReplace('<p>Use 15 g.</p><ul><li>a scale</li></ul>', 'p')).toMatchObject({
      words: 'Use 15 g.',
      blocks: '<ul><li>a scale</li></ul>',
    });
  });
});

/**
 * Content Agent rule gaps, A, over the API: links only to get_content_draft's
 * link_targets, a replace's beside its words, an insert's in its HTML.
 */
describe('links to the targets listed', () => {
  const page = draftPassages(
    '<h2>Pricing</h2><p>See our plans for teams.</p><p>Studies show it works.</p>',
  );
  const links = new Map(
    ['https://acme.example/pricing', 'https://research.example/study'].map((url) => [
      linkKey(url)!,
      url,
    ]),
  );
  const replace = (after: string) => ({
    kind: 'replace' as const,
    passage: 2,
    before: 'See our plans for teams.',
    after,
    reason: 'link the pricing page',
  });

  it('keeps a replace’s link to a listed page, by its words, with the page’s URL', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [
        replace(
          'See <a href="https://www.acme.example/pricing/?utm_source=x">our plans</a> for teams.',
        ),
      ],
      page,
      new Set(),
      links,
    );
    expect(dropped).toEqual([]);
    expect(kept[0]).toMatchObject({
      after_text: 'See our plans for teams.',
      after_links: [{ start: 4, end: 13, href: 'https://acme.example/pricing' }],
    });
  });

  it('unwraps a link to anything not listed, and says when nothing then changes', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [
        replace('See <a href="https://made-up.example/x">our plans</a> for teams.'),
        replace('See <a href="https://made-up.example/x">our team plans</a>.'),
      ],
      page,
      new Set(),
      links,
    );
    expect(dropped).toEqual([{ index: 0, reason: 'no_change' }]);
    expect(kept[0].after_text).toBe('See our team plans.');
    expect(kept[0]).not.toHaveProperty('after_links');
  });

  it('keeps an insert’s link to a listed source, never one in a heading', () => {
    const { kept } = keepAgentSuggestions(
      [
        {
          kind: 'insert',
          passage: 3,
          after:
            '<h3><a href="https://research.example/study">Study</a></h3><p>A <a href="https://research.example/study" target="_blank" onclick="x()">2025 study</a> found it.</p>',
          reason: 'cite a source',
        },
      ],
      page,
      new Set(),
      links,
    );
    expect(kept[0].after_text).toBe(
      '<h3>Study</h3><p>A <a href="https://research.example/study">2025 study</a> found it.</p>',
    );
    // A link with no words links nothing.
    expect(
      cleanInsertHtml('<p>A <a href="https://research.example/study"> </a>study.</p>', links),
    ).toBe('<p>A study.</p>');
    // Without targets, as before: no link at all.
    expect(cleanInsertHtml('<p>A <a href="https://research.example/study">study</a>.</p>')).toBe(
      '<p>A study.</p>',
    );
  });

  it('reads inline words and their links, spaces collapsed', () => {
    expect(inlineText('Read <a href="u"> the  guide </a><br />now &amp; then')).toEqual({
      text: 'Read the guide now & then',
      links: [{ start: 5, end: 14, href: 'u' }],
    });
  });
});
