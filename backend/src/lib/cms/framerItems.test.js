import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { framerFieldData, framerSlug, toFramerHtml } from './framerItems.js';

/** A page as a Framer CMS item (Send to CMS #1331, phase 2; 00295). */

describe('toFramerHtml', () => {
  it('keeps what Framer’s formatted text is sent with, a link’s address and target only', () => {
    const { html, changed } = toFramerHtml(
      '<h2 id="x" class="big">Why</h2><p style="color:red">Cold <strong>brew</strong> is <a href="https://acme.example/brew" target="_blank" rel="noopener" class="l">smooth</a>.</p><ul><li>One</li></ul><blockquote><p>Said so.</p></blockquote>',
    );
    expect(html).toBe(
      '<h2>Why</h2><p>Cold <strong>brew</strong> is <a href="https://acme.example/brew" target="_blank">smooth</a>.</p><ul><li>One</li></ul><blockquote><p>Said so.</p></blockquote>',
    );
    expect(changed).toEqual({ images: 0 });
  });

  it('keeps a table, its header row as its head, each cell a line of words, links and emphasis', () => {
    expect(
      toFramerHtml(
        '<table class="t"><caption>Prices <em>2026</em></caption><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td><p>Starter</p><p>for <a href="https://acme.example/s" class="x">one</a></p></td><td style="x">$49</td></tr><tr><td>Growth</td><td></td></tr><tr><td></td><td></td></tr></tbody></table>',
      ).html,
    ).toBe(
      '<p>Prices <em>2026</em></p><table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Starter for <a href="https://acme.example/s">one</a></td><td>$49</td></tr><tr><td>Growth</td><td></td></tr></tbody></table>',
    );
    // No header row: all of it is its body.
    expect(
      toFramerHtml('<table>\n<tr><td>a &lt;b&gt;</td><td>c<br>d</td></tr>\n</table>').html,
    ).toBe('<table><tbody><tr><td>a &lt;b&gt;</td><td>c d</td></tr></tbody></table>');
  });

  it('keeps a cell’s colspan and rowspan when they are whole numbers from 1 to 1000', () => {
    expect(
      toFramerHtml(
        '<table><tr><th colspan="2" class="x" style="y">Plans</th></tr><tr><td rowspan=" 3 " data-x="1">Starter</td><td colspan="0">a</td></tr><tr><td colspan="1001" rowspan="two">b</td><td colspan="1000">c</td></tr></table>',
      ).html,
    ).toBe(
      '<table><thead><tr><th colspan="2">Plans</th></tr></thead><tbody><tr><td rowspan="3">Starter</td><td>a</td></tr><tr><td>b</td><td colspan="1000">c</td></tr></tbody></table>',
    );
  });

  it('keeps a first row of mixed header and data cells in the body, its header cells as they are', () => {
    expect(
      toFramerHtml(
        '<table><tr><th>Plan</th><td>Note</td></tr><tr><th>Starter</th><td>$49</td></tr></table>',
      ).html,
    ).toBe(
      '<table><tbody><tr><th>Plan</th><td>Note</td></tr><tr><th>Starter</th><td>$49</td></tr></tbody></table>',
    );
  });

  it('reads a table in a cell as a line of it, and keeps a table a figure wraps', () => {
    expect(
      toFramerHtml(
        '<table><tr><td>Plan<table><tr><td>x</td><td>y</td></tr></table></td><td>z</td></tr></table>',
      ).html,
    ).toBe('<table><tbody><tr><td>Plan x · y</td><td>z</td></tr></tbody></table>');
    expect(
      toFramerHtml(
        '<figure class="wp-block-table"><table><tr><td>a</td><td>b</td></tr></table><figcaption>Prices</figcaption></figure>',
      ).html,
    ).toBe('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table><p>Prices</p>');
  });

  it('leaves images, media, scripts, styles, forms and embeds out, and counts the images', () => {
    const { html, changed } = toFramerHtml(
      '<p>Intro</p><figure><img src="https://acme.example/a.png" alt="A"><figcaption>A</figcaption></figure><p><img src="https://acme.example/b.png"></p><script type="application/ld+json">{"@type":"Article"}</script><style>p{}</style><form><input></form><iframe src="https://x.example"></iframe><video src="v.mp4"></video><p>End</p>',
    );
    expect(html).toBe('<p>Intro</p><p>End</p>');
    expect(changed.images).toBe(3);
    // A table of nothing but an image goes with it.
    expect(toFramerHtml('<table><tr><td><img src="a.png"></td></tr></table><p>x</p>')).toEqual({
      html: '<p>x</p>',
      changed: { images: 1 },
    });
  });

  it('reads a heading 1 as a heading 2, keeps code, and unwraps the rest', () => {
    expect(
      toFramerHtml(
        '<div><h1>Title again</h1><section><p><span>Hi</span> <mark>there</mark> <code class="c">npm</code></p></section><pre class="p"><code class="language-sh">npm i &lt;x&gt;\n  --save</code></pre><pre> </pre><dl><dt>Term</dt><dd>Meaning</dd></dl></div>Loose <strong>words</strong><menu><li>Orphan</li></menu>',
      ).html,
    ).toBe(
      '<h2>Title again</h2><p>Hi there <code>npm</code></p><pre><code>npm i &lt;x&gt;\n  --save</code></pre><p>Term</p><p>Meaning</p><p>Loose <strong>words</strong></p><p>Orphan</p>',
    );
  });

  it('reads a product grid as a list, a product a line: its name linked, its price after it', () => {
    // The editor's and the agent's grid (frontend/src/lib/content/productBlock.ts, shoppingBlocks.js).
    const grid = JSON.parse(
      readFileSync(
        new URL(
          '../../../../frontend/src/lib/content/__fixtures__/product-block.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ).html;
    const { html, changed } = toFramerHtml(
      `<p>Our picks:</p><!-- html-block -->\n${grid}\n<!-- /html-block --><p>More below.</p>`,
    );
    expect(html).toBe(
      '<p>Our picks:</p><ul><li><a href="https://shop.example/products/p1?variant=2">Summit "GTX" Boot</a> $189.00</li><li><a href="https://shop.example/products/p2">Trail Mid</a></li></ul><p>More below.</p>',
    );
    expect(changed.images).toBe(1);
  });
});

describe('framerSlug', () => {
  it('makes a slug of lowercase letters, digits and dashes, from the slug, else the title, else the draft', () => {
    expect(framerSlug({ slug: 'Soğuk_demleme.Kahve', title: 'x', draftId: 'd1' })).toBe(
      'soguk-demleme-kahve',
    );
    expect(framerSlug({ slug: '…', title: 'Café crème', draftId: 'd1' })).toBe('cafe-creme');
    expect(framerSlug({ slug: 'привет-мир', title: '日本語', draftId: 'dr1' })).toBe('page-dr1');
  });
});

describe('framerFieldData', () => {
  const page = {
    title: '  Cold   brew at home ',
    metaTitle: '',
    metaDescription: '',
    reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
  };
  const body = `<p>${'Cold brew is coffee steeped in cold water for 12 to 18 hours. '.repeat(4)}</p>`;
  const map = {
    title: 'fTitle',
    body: 'fBody',
    metaTitle: 'fSeoTitle',
    metaDescription: 'fSeoDesc',
    jsonLd: 'fSchema',
    reviewer: 'fReviewer',
  };

  it('puts each part in its field as Framer takes it, falling back where a page has none', () => {
    const data = framerFieldData(
      { page, body, jsonLd: [{ '@type': 'Article', headline: '</script>' }] },
      map,
    );
    expect(data.fTitle).toEqual({ type: 'string', value: 'Cold brew at home' });
    expect(data.fBody).toEqual({ type: 'formattedText', value: body, contentType: 'html' });
    expect(data.fSeoTitle).toEqual({ type: 'string', value: 'Cold brew at home' });
    // The opening words, cut at a word.
    expect(data.fSeoDesc.type).toBe('string');
    expect(data.fSeoDesc.value).toMatch(/^Cold brew is coffee steeped .{60,}…$/);
    expect(data.fSeoDesc.value.length).toBeLessThanOrEqual(160);
    expect(data.fSchema).toEqual({
      type: 'string',
      value: '{"@type":"Article","headline":"\\u003c/script>"}',
    });
    expect(data.fReviewer).toEqual({
      type: 'string',
      value: 'Dr. Grace Hopper, Clinical Reviewer',
    });
    expect(
      framerFieldData({ page: { ...page, title: 'T'.repeat(300) }, body }, map).fTitle.value,
    ).toHaveLength(256);
  });

  it('sends the page’s own meta, an empty JSON-LD it hasn’t (clearing an old one), and nothing for a part the map leaves out', () => {
    expect(
      framerFieldData(
        {
          page: { ...page, metaTitle: 'Cold brew, simply', metaDescription: 'How to make it.' },
          body: '<p>x</p>',
          jsonLd: [],
        },
        map,
      ),
    ).toEqual({
      fTitle: { type: 'string', value: 'Cold brew at home' },
      fBody: { type: 'formattedText', value: '<p>x</p>', contentType: 'html' },
      fSeoTitle: { type: 'string', value: 'Cold brew, simply' },
      fSeoDesc: { type: 'string', value: 'How to make it.' },
      fSchema: { type: 'string', value: '' },
      fReviewer: { type: 'string', value: 'Dr. Grace Hopper, Clinical Reviewer' },
    });
    expect(
      framerFieldData(
        { page, body: '<p>x</p>', jsonLd: [{ '@type': 'Article' }, { '@type': 'FAQPage' }] },
        { title: 'fTitle', body: 'fBody', jsonLd: 'fSchema' },
      ),
    ).toEqual({
      fTitle: { type: 'string', value: 'Cold brew at home' },
      fBody: { type: 'formattedText', value: '<p>x</p>', contentType: 'html' },
      fSchema: { type: 'string', value: '[{"@type":"Article"},{"@type":"FAQPage"}]' },
    });
  });

  it('clears the mapped reviewer field when a page has no reviewer', () => {
    expect(
      framerFieldData({ page: { ...page, reviewer: '' }, body: '<p>x</p>', jsonLd: [] }, map)
        .fReviewer,
    ).toEqual({ type: 'string', value: '' });
  });
});
