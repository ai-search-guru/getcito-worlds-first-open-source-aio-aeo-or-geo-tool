import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fieldDataFor, toWebflowRichText, webflowSlug } from './webflowItems.js';

/** A page as a Webflow CMS item (Send to CMS #1331, phase 2). */

describe('toWebflowRichText', () => {
  it('keeps what Webflow’s rich text keeps, a link’s address and target only', () => {
    const { html, changed } = toWebflowRichText(
      '<h2 id="x" class="big">Why</h2><p style="color:red">Cold <strong>brew</strong> is <a href="https://acme.example/brew" target="_blank" rel="noopener" class="l">smooth</a>.</p><ul><li>One</li></ul><blockquote><p>Said so.</p></blockquote>',
    );
    expect(html).toBe(
      '<h2>Why</h2><p>Cold <strong>brew</strong> is <a href="https://acme.example/brew" target="_blank">smooth</a>.</p><ul><li>One</li></ul><blockquote><p>Said so.</p></blockquote>',
    );
    expect(changed).toEqual({ tables: 0, images: 0 });
  });

  it('turns a table into a list, a row an item, its header naming each cell', () => {
    const { html, changed } = toWebflowRichText(
      '<table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Starter</td><td>$49</td></tr><tr><td>Growth</td><td></td></tr></tbody></table>',
    );
    expect(html).toBe(
      '<ul><li><strong>Plan</strong>: Starter · <strong>Price</strong>: $49</li><li><strong>Plan</strong>: Growth</li></ul>',
    );
    expect(changed.tables).toBe(1);
    // No header row: the cells, one after another.
    expect(toWebflowRichText('<table><tr><td>a &lt;b&gt;</td><td>c</td></tr></table>').html).toBe(
      '<ul><li>a &lt;b&gt; · c</li></ul>',
    );
  });

  it('leaves images, media, scripts and embeds out, and counts the images', () => {
    const { html, changed } = toWebflowRichText(
      '<p>Intro</p><figure><img src="https://acme.example/a.png" alt="A"><figcaption>A</figcaption></figure><p><img src="https://acme.example/b.png"></p><script type="application/ld+json">{"@type":"Article"}</script><iframe src="https://x.example"></iframe><hr><p>End</p>',
    );
    expect(html).toBe('<p>Intro</p><p>End</p>');
    expect(changed.images).toBe(2);
  });

  it('reads a heading 1 as a heading 2, a code block and a definition list as paragraphs, and unwraps the rest', () => {
    expect(
      toWebflowRichText(
        '<div><h1>Title again</h1><section><p><span>Hi</span> <mark>there</mark></p></section><pre><code>npm i &lt;x&gt;</code></pre><dl><dt>Term</dt><dd>Meaning</dd></dl></div>',
      ).html,
    ).toBe('<h2>Title again</h2><p>Hi there</p><p>npm i &lt;x&gt;</p><p>Term</p><p>Meaning</p>');
  });
});

describe('toWebflowRichText, on what pages hold', () => {
  it('reads a cell’s paragraphs, items and lines a space apart, and keeps its links', () => {
    expect(
      toWebflowRichText(
        '<table><tr><th>Tool</th><th>Notes</th></tr><tr><td><p>Acme</p></td><td><p>First</p><p>Second, <a href="https://acme.example/src" class="x">source</a></p><ul><li>a</li><li>b</li></ul>x<br>y</td></tr></table>',
      ).html,
    ).toBe(
      '<ul><li><strong>Tool</strong>: Acme · <strong>Notes</strong>: First Second, <a href="https://acme.example/src">source</a> a b x y</li></ul>',
    );
  });

  it('keeps a table a figure wraps, and a table in a cell once', () => {
    const wrapped = toWebflowRichText(
      '<figure class="wp-block-table"><table><tr><td>a</td><td>b</td></tr></table><figcaption>Prices</figcaption></figure>',
    );
    expect(wrapped.html).toBe('<ul><li>a · b</li></ul><p>Prices</p>');
    expect(wrapped.changed.tables).toBe(1);
    const nested = toWebflowRichText(
      '<table><tr><td>Plan<table><tr><td>x</td><td>y</td></tr></table></td><td>z</td></tr></table>',
    );
    expect(nested.html).toBe('<ul><li>Plan x · y · z</li></ul>');
    expect(nested.changed.tables).toBe(1);
  });

  it('puts words outside a block in a paragraph, an item outside a list too, and counts a picture once', () => {
    const { html, changed } = toWebflowRichText(
      '<div>Loose <strong>words</strong></div><h2>Next</h2><menu><li>Orphan</li></menu><!-- note --><picture><source srcset="a.webp"><img src="a.png"></picture>',
    );
    expect(html).toBe('<p>Loose <strong>words</strong></p><h2>Next</h2><p>Orphan</p>');
    expect(changed.images).toBe(1);
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
    const { html, changed } = toWebflowRichText(
      `<p>Our picks:</p><!-- html-block -->\n${grid}\n<!-- /html-block --><p>More below.</p>`,
    );
    expect(html).toBe(
      '<p>Our picks:</p><ul><li><a href="https://shop.example/products/p1?variant=2">Summit "GTX" Boot</a> $189.00</li><li><a href="https://shop.example/products/p2">Trail Mid</a></li></ul><p>More below.</p>',
    );
    expect(changed.images).toBe(1);
    // A card whose name is gone isn't an item, and a grid of none is nothing.
    expect(
      toWebflowRichText(
        '<div class="getcito-products"><a class="getcito-product" href="https://s.example/p"><strong> </strong></a></div><p>x</p>',
      ).html,
    ).toBe('<p>x</p>');
  });
});

describe('webflowSlug', () => {
  it('makes a slug Webflow takes', () => {
    expect(webflowSlug('soğuk-demleme-kahve')).toBe('soguk-demleme-kahve');
    expect(webflowSlug('Größe_und.Preis')).toBe('grosse_und-preis');
    expect(webflowSlug('--Ilık su--')).toBe('ilik-su');
    expect(webflowSlug('…')).toBeNull();
    expect(webflowSlug('a'.repeat(250))).toHaveLength(200);
  });
});

describe('fieldDataFor', () => {
  const page = {
    title: 'Cold brew at home',
    metaTitle: '',
    metaDescription: '',
    reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
  };
  const body = `<p>${'Cold brew is coffee steeped in cold water for 12 to 18 hours. '.repeat(4)}</p>`;

  it('puts each part in the field the map gives it, falling back where a page has none', () => {
    const data = fieldDataFor(
      {
        page,
        slug: 'cold-brew-at-home',
        body,
        jsonLd: [{ '@type': 'Article', headline: '</script>' }],
      },
      {
        body: 'post-body',
        metaTitle: 'seo-title',
        metaDescription: 'post-summary',
        jsonLd: 'schema',
        reviewer: 'reviewed-by',
      },
    );
    expect(data.name).toBe('Cold brew at home');
    expect(data.slug).toBe('cold-brew-at-home');
    expect(data['post-body']).toBe(body);
    expect(data['seo-title']).toBe('Cold brew at home');
    // The opening words, cut at a word.
    expect(data['post-summary']).toMatch(/^Cold brew is coffee steeped .{60,}…$/);
    expect(data['post-summary'].length).toBeLessThanOrEqual(160);
    expect(data.schema).toBe('{"@type":"Article","headline":"\\u003c/script>"}');
    expect(JSON.parse(data.schema)).toEqual({ '@type': 'Article', headline: '</script>' });
    expect(data['reviewed-by']).toBe('Dr. Grace Hopper, Clinical Reviewer');
  });

  it('sends the page’s own meta, several JSON-LD blocks as a list, and nothing for a part the map leaves out', () => {
    const data = fieldDataFor(
      {
        page: { ...page, metaTitle: 'Cold brew, simply', metaDescription: 'How to make it.' },
        slug: 's',
        body: '<p>x</p>',
        jsonLd: [{ '@type': 'Article' }, { '@type': 'FAQPage' }],
      },
      { body: 'post-body', metaDescription: 'post-summary', jsonLd: 'schema' },
    );
    expect(data).toEqual({
      name: 'Cold brew at home',
      slug: 's',
      'post-body': '<p>x</p>',
      'post-summary': 'How to make it.',
      schema: '[{"@type":"Article"},{"@type":"FAQPage"}]',
    });
    // No JSON-LD: the field is emptied, so an item sent again loses what the page dropped.
    expect(
      fieldDataFor(
        { page, slug: 's', body: '<p>x</p>', jsonLd: [] },
        { body: 'b', jsonLd: 'schema' },
      ),
    ).toHaveProperty('schema', '');
  });

  it('dates a new item the day it’s sent, as ISO 8601, and leaves an item sent again its own date', () => {
    const sentAt = new Date('2026-10-27T09:30:00Z');
    const item = { page, slug: 's', body: '<p>x</p>', jsonLd: [] };
    expect(fieldDataFor({ ...item, sentAt }, { body: 'b', date: 'date' })).toEqual({
      name: 'Cold brew at home',
      slug: 's',
      b: '<p>x</p>',
      date: '2026-10-27T09:30:00.000Z',
    });
    expect(fieldDataFor(item, { body: 'b', date: 'date' })).not.toHaveProperty('date');
    // No date field in the map: nothing dated.
    expect(fieldDataFor({ ...item, sentAt }, { body: 'b' })).toEqual({
      name: 'Cold brew at home',
      slug: 's',
      b: '<p>x</p>',
    });
  });
  it('clears the mapped reviewer field when a page has no reviewer', () => {
    expect(
      fieldDataFor(
        { page: { ...page, reviewer: '' }, slug: 's', body: '<p>x</p>', jsonLd: [] },
        { body: 'b', reviewer: 'reviewed-by' },
      ),
    ).toEqual({ name: 'Cold brew at home', slug: 's', b: '<p>x</p>', 'reviewed-by': '' });
  });
});
