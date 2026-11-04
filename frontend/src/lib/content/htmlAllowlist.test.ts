import { describe, expect, it } from 'vitest';
import {
  cleanHref,
  decodeHtmlBlock,
  encodeHtmlBlock,
  extractKeptBlocks,
  htmlBlockElement,
  jsonLdType,
  normalizeJsonLd,
  restoreKeptBlocks,
} from './htmlAllowlist';

describe('cleanHref', () => {
  it('drops utm_*, gclid and fbclid and keeps every other parameter', () => {
    expect(
      cleanHref('https://acme.com/p?utm_source=x&id=3&utm_medium=y&gclid=z&fbclid=w#top'),
    ).toBe('https://acme.com/p?id=3#top');
    expect(cleanHref('/pricing?utm_campaign=fall&plan=pro')).toBe('/pricing?plan=pro');
    expect(cleanHref('https://acme.com/?UTM_Source=x')).toBe('https://acme.com/');
  });

  it('keeps mailto, and refuses what the toolbar refuses', () => {
    expect(cleanHref('mailto:sales@acme.com')).toBe('mailto:sales@acme.com');
    expect(cleanHref('javascript:alert(1)')).toBeNull();
    expect(cleanHref('//evil.com')).toBeNull();
  });
});

describe('normalizeJsonLd', () => {
  it('writes the JSON again with <, > and & escaped', () => {
    expect(normalizeJsonLd('{ "@type": "Product", "name": "A & B </script><b>" }')).toBe(
      '{"@type":"Product","name":"A \\u0026 B \\u003c/script\\u003e\\u003cb\\u003e"}',
    );
    expect(JSON.parse(normalizeJsonLd('[{"@type":"FAQPage"}]')!)).toEqual([{ '@type': 'FAQPage' }]);
  });

  it('refuses anything that isn’t a JSON object or list', () => {
    expect(normalizeJsonLd('alert(1)')).toBeNull();
    expect(normalizeJsonLd('"text"')).toBeNull();
    expect(normalizeJsonLd('null')).toBeNull();
    expect(normalizeJsonLd(`{"a":"${'x'.repeat(50_001)}"}`)).toBeNull();
  });

  it('names the schema type for the editor’s label', () => {
    expect(jsonLdType('{"@type":"Product"}')).toBe('Product');
    expect(jsonLdType('[{"@type":["FAQPage","WebPage"]}]')).toBe('FAQPage');
    expect(jsonLdType('{}')).toBeNull();
  });
});

describe('extractKeptBlocks and restoreKeptBlocks', () => {
  it('keeps valid schema blocks through cleaning, as script elements of our own', () => {
    const { html, kept } = extractKeptBlocks(
      '<p>a</p><script type="application/ld+json" onload="x()">{"@type":"Product"}</script>' +
        "<script type='application/ld+json'>not json</script><script>alert(1)</script>",
      { htmlBlocks: false },
    );
    expect(kept).toEqual(['<script type="application/ld+json">{"@type":"Product"}</script>']);
    expect(html).toBe('<p>a</p><kept-slot data-i="0"></kept-slot><script>alert(1)</script>');
    expect(restoreKeptBlocks('<p>a</p><kept-slot data-i="0"></kept-slot>', kept)).toBe(
      '<p>a</p><script type="application/ld+json">{"@type":"Product"}</script>',
    );
  });

  it('keeps HTML blocks only where they’re allowed, and only ones that decode and fit', () => {
    const block = htmlBlockElement('<iframe src="https://youtube.com/embed/x"></iframe>');
    const tooLong = htmlBlockElement('x'.repeat(50_001));
    const input = `<p>a</p>${block}<div data-html-block="!!"></div>${tooLong}`;
    expect(extractKeptBlocks(input, { htmlBlocks: true })).toEqual({
      html: '<p>a</p><kept-slot data-i="0"></kept-slot><div data-html-block="!!"></div>',
      kept: [block],
    });
    expect(extractKeptBlocks(input, { htmlBlocks: false }).kept).toEqual([]);
  });

  it('reads tags in any case, and skips other tags and plain scripts', () => {
    const { html, kept } = extractKeptBlocks(
      '<SCRIPT TYPE="Application/LD+JSON">{"@type":"Product"}</SCRIPT>' +
        '<scripts type="application/ld+json">{}</scripts>' +
        '<script>var s = "<script type=application/ld+json>{}";</script><p>b</p>',
      { htmlBlocks: false },
    );
    expect(kept).toEqual(['<script type="application/ld+json">{"@type":"Product"}</script>']);
    expect(html).toBe(
      '<kept-slot data-i="0"></kept-slot><scripts type="application/ld+json">{}</scripts>' +
        '<script>var s = "<script type=application/ld+json>{}";</script><p>b</p>',
    );
  });

  it('finds a block after letters whose lower case is longer, as Turkish İ', () => {
    const { html, kept } = extractKeptBlocks(
      '<h1>İstanbul İçin İyi Kahve</h1><script type="application/ld+json">{"@type":"Product"}</script><p>Sonra.</p>',
      { htmlBlocks: false },
    );
    expect(kept).toEqual(['<script type="application/ld+json">{"@type":"Product"}</script>']);
    expect(html).toBe(
      '<h1>İstanbul İçin İyi Kahve</h1><kept-slot data-i="0"></kept-slot><p>Sonra.</p>',
    );
  });

  it('takes time in proportion to the length on input built to backtrack', () => {
    const unclosed = '<script type=application/ld+json '.repeat(15_000);
    const unended = '<script type="application/ld+json">{"a":1}'.repeat(11_000);
    for (const input of [unclosed, unended]) {
      expect(input.length).toBeGreaterThan(450_000);
      const started = performance.now();
      const { html, kept } = extractKeptBlocks(input, { htmlBlocks: true });
      expect(performance.now() - started).toBeLessThan(500);
      expect(kept).toEqual([]);
      expect(html).toBe(input);
    }
  });

  it('fills a slot nobody kept with nothing', () => {
    expect(restoreKeptBlocks('<kept-slot data-i="7"></kept-slot><p>a</p>', [])).toBe('<p>a</p>');
  });
});

describe('HTML block code', () => {
  it('round-trips any code, Unicode included, as base64 that holds no markup', () => {
    const code = '<script>alert("ğüş")</script>\n<style>p{color:red}</style> &amp; "quotes"';
    const encoded = encodeHtmlBlock(code);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decodeHtmlBlock(encoded)).toBe(code);
  });

  it('refuses what isn’t base64, or isn’t UTF-8', () => {
    expect(decodeHtmlBlock('<script>')).toBeNull();
    expect(decodeHtmlBlock(btoa('\xff\xfe'))).toBeNull();
  });
});
