import { describe, expect, it, vi } from 'vitest';

// contentAgent.js reaches the admin client at import time, whose config
// hard-exits without SUPABASE_* env (as in CI).
vi.mock('../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));
const { passageKey } = await import('./contentAgent.js');
const {
  REWRITE_SYSTEM_PROMPT,
  cleanPageHtml,
  isPageHtml,
  keepBlocks,
  ownText,
  restoreKept,
  rewriteLinks,
  textLength,
} = await import('./contentRewrite.js');

/**
 * Rewrite the page to these rules: what the page keeps word for word goes
 * to the model as [[KEEP n]] lines and comes back as it was.
 */

const QUOTED = 'AI assistants quote this sentence about tracking today.';
const TABLE = '<table><tbody><tr><td><p>Plan</p></td><td><p></p></td></tr></tbody></table>';
const PAGE =
  '<h1>Best AEO tools</h1>' +
  '<p>GetCito tracks AI answers across <a href="https://acme.example/engines?ref=aff12#top">six engines</a>.</p>' +
  `<p>${QUOTED}</p>` +
  TABLE +
  '<div data-html-block="PGI+aGk8L2I+"></div>' +
  '<ul><li><p>See <a href="/pricing">pricing</a>.</p></li></ul>';

const locked = new Set([passageKey(QUOTED)]);

describe('keepBlocks', () => {
  it('sends a locked passage, a table and an HTML block as kept lines, described', () => {
    const page = keepBlocks(PAGE, locked);
    expect(page.html).toContain('<p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>[[KEEP 3]]</p>');
    expect(page.html).not.toContain('quote this sentence');
    expect(page.kept.get(2)).toBe(TABLE);
    expect([...page.legend.values()]).toEqual([
      `a passage AI assistants quote today: "${QUOTED}"`,
      'a table, 1 rows: "Plan"',
      'an HTML block',
    ]);
    // Kept text counts toward Length; the rest is the model's to rewrite, the H1 included.
    expect(page.keptChars).toBe(textLength(`<p>${QUOTED}</p>${TABLE}`));
    expect(ownText(page)).toBe(textLength(page.html.replace(/\[\[KEEP \d+\]\]/g, ' ')));
    expect(page).toMatchObject({ word: 'KEEP', h1Token: null, h1: '<h1>Best AEO tools</h1>' });
  });

  it('keeps a list whole when it holds a locked passage, and an H1 AI quotes', () => {
    const page = keepBlocks(
      `<h1>Best AEO tools</h1><ul><li><p>${QUOTED}</p></li></ul>`,
      new Set([...locked, passageKey('Best AEO tools')]),
    );
    expect(page.html).toBe('<p>[[KEEP 1]]</p><p>[[KEEP 2]]</p>');
    expect(page.kept.get(2)).toMatch(/^<ul>/);
    expect(page).toMatchObject({ h1Token: 1, h1: null });
    expect(page.legend.get(1)).toBe('the page\'s H1 AI assistants quote today: "Best AEO tools"');
  });

  it('takes no H1 inside an HTML block for the page’s title', () => {
    const page = keepBlocks(
      '<h1>Real title</h1><p>Intro.</p><div data-html-block="x"><h1>Widget</h1></div>',
      new Set(),
    );
    expect(page).toMatchObject({ h1Token: null, h1: '<h1>Real title</h1>' });
  });

  it('marks its lines with a word of its own when the page writes [[KEEP itself', () => {
    const page = keepBlocks(`<p>Write [[KEEP 1]] to keep.</p>${TABLE}`, new Set());
    expect(page.word).toMatch(/^KEEP_[0-9a-f]{4}$/);
    expect(page.html).toContain(`<p>[[${page.word} 1]]</p>`);
    expect(restoreKept(page.html, page.kept, { word: page.word }).html).toBe(
      `<p>Write [[KEEP 1]] to keep.</p>${TABLE}`,
    );
  });
});

describe('cleanPageHtml', () => {
  const links = rewriteLinks(PAGE, new Map([['acme.example/guide', 'https://acme.example/guide']]));

  it('keeps the page’s own links as they are, and the ones offered; unwraps the rest', () => {
    const html = cleanPageHtml(
      '<h1>T</h1><p><a href="https://acme.example/engines?ref=aff12#top">six</a> ' +
        '<a href="/pricing">pricing</a> <a href="https://acme.example/guide/">guide</a> ' +
        '<a href="https://evil.example">x</a> <a href="javascript:alert(1)">y</a> ' +
        '<a href="/\\evil.example">z</a></p><h2><a href="/pricing">Pricing</a></h2>',
      links,
    );
    expect(html).toBe(
      '<h1>T</h1><p><a href="https://acme.example/engines?ref=aff12#top">six</a> ' +
        '<a href="/pricing">pricing</a> <a href="https://acme.example/guide">guide</a> x y z</p>' +
        '<h2>Pricing</h2>',
    );
  });

  it('keeps one H1, first; takes the page’s back when there is none; an H1 that is kept wins', () => {
    expect(cleanPageHtml('<h1>A</h1><p>x</p><h1>B</h1><h4>C</h4>', links)).toBe(
      '<h1>A</h1><p>x</p><h2>B</h2><h3>C</h3>',
    );
    expect(cleanPageHtml('<p>x</p>', links, { originalH1: '<h1>Best AEO tools</h1>' })).toBe(
      '<h1>Best AEO tools</h1><p>x</p>',
    );
    expect(cleanPageHtml('<h1>A</h1><p>[[KEEP 1]]</p>', links, { h1Kept: true })).toBe(
      '<h2>A</h2><p>[[KEEP 1]]</p>',
    );
  });

  it('drops what the editor doesn’t take: attributes, scripts, comments, other tags', () => {
    expect(
      cleanPageHtml(
        '<p class="x" style="y" onclick="z()">a <span>b</span></p><script>z()</script><!-- c -->',
        links,
      ),
    ).toBe('<p>a b</p>');
  });

  it('takes a page out of a code fence, and puts lines left at the root in paragraphs', () => {
    expect(
      cleanPageHtml(
        '```html\n<h1>T</h1>\n[[KEEP 1]]\n<div>Plain <strong>words</strong></div>\n```',
        links,
      ),
    ).toBe('<h1>T</h1><p>[[KEEP 1]]</p><p>Plain <strong>words</strong></p>');
  });
});

describe('isPageHtml', () => {
  it('takes a page in HTML, never one in Markdown or plain text', () => {
    expect(isPageHtml('<h1>T</h1><p>x</p>')).toBe(true);
    expect(isPageHtml('# Title\n\n## Section\n\nText')).toBe(false);
    expect(isPageHtml('Just text.')).toBe(false);
  });
});

describe('restoreKept', () => {
  it('puts each kept block back where its line is, once, as it was', () => {
    const page = keepBlocks(PAGE, locked);
    const { html, missing } = restoreKept(
      '<h1>Best AEO tools</h1><p>[[KEEP 2]]</p><p>Short intro.</p><p>[[KEEP 1]]</p>' +
        '<p>[[KEEP 3]]</p><p>[[KEEP 1]]</p>',
      page.kept,
    );
    expect(missing).toEqual([]);
    // The table's empty cell stays as the editor wrote it.
    expect(html).toBe(
      `<h1>Best AEO tools</h1>${TABLE}<p>Short intro.</p><p>${QUOTED}</p>${page.kept.get(3)}`,
    );
  });

  it('says which it left out, and takes a line run into other text out of it', () => {
    const page = keepBlocks(PAGE, locked);
    const { html, missing } = restoreKept(
      '<p>Intro [[KEEP 1]] more.</p><ul><li>[[KEEP 2]]</li><li>Point</li></ul>',
      page.kept,
    );
    expect(missing).toEqual([1, 3]);
    // A block in a list item goes after its list.
    expect(html).toBe(`<p>Intro  more.</p><ul><li>Point</li></ul>${TABLE}`);
  });

  it('puts the page’s kept H1 first', () => {
    const page = keepBlocks(
      '<h1>Best AEO tools</h1><p>Intro.</p>',
      new Set([passageKey('Best AEO tools')]),
    );
    const { html } = restoreKept('<p>New intro.</p><p>[[KEEP 1]]</p>', page.kept, {
      h1Token: page.h1Token,
    });
    expect(html).toBe('<h1>Best AEO tools</h1><p>New intro.</p>');
  });
});

describe('the rewrite', () => {
  it('counts the page’s text as the Rules tab does, not its markup', () => {
    // A space between blocks, an entity as one character.
    expect(textLength('<h1>Ab</h1><p>c  d &amp; e</p>')).toBe('Ab c d x e'.length);
  });

  it('counts a long page with tags left open in time near its size', () => {
    // As the regexes read them: a tag never closed is text, a script never closed too.
    expect(textLength('<p>a</p><script>b')).toBe('a b'.length);
    expect(textLength('a <b c')).toBe('a <b c'.length);
    for (const tag of ['<p', '<script', '<style ', '<', '</div']) {
      const html = `<p>Lead</p>${tag.repeat(Math.ceil(100_000 / tag.length))}`;
      const started = Date.now();
      expect(textLength(html)).toBeGreaterThan(4);
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });

  it('tells the model to keep every kept line, the facts and one H1, in HTML', () => {
    expect(REWRITE_SYSTEM_PROMPT).toContain('never change, split, merge or drop one');
    expect(REWRITE_SYSTEM_PROMPT).toContain('Never invent numbers');
    expect(REWRITE_SYSTEM_PROMPT).toContain('One H1, the page');
    expect(REWRITE_SYSTEM_PROMPT).toContain('No Markdown, no code fences');
  });
});
