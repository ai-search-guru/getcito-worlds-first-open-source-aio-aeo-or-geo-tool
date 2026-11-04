import { describe, expect, it } from 'vitest';
import { fileTitle, startPageType, summarizeContent } from './start';

describe('summarizeContent', () => {
  it('names content by its first heading, and counts headings and text', () => {
    expect(
      summarizeContent('<p>Intro</p><h2>Returns policy</h2><p>30 days.</p><h3>Refunds</h3>'),
    ).toEqual({
      title: 'Returns policy',
      headings: 2,
      characters: 'Intro Returns policy 30 days. Refunds'.length,
    });
  });

  it('falls back to the file’s name, then the first paragraph, cut at a word', () => {
    expect(summarizeContent('<p>Plans start at $9.</p>', 'Pricing notes').title).toBe(
      'Pricing notes',
    );
    expect(summarizeContent('<p>Short one</p><p>Next</p>').title).toBe('Short one');
    const long = summarizeContent(`<p>${'word '.repeat(30)}</p>`).title;
    expect(long.endsWith('word…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(81);
  });

  it('keeps words from running together across blocks', () => {
    expect(summarizeContent('<p>One</p><ul><li>two</li><li>three</li></ul>').characters).toBe(
      'One two three'.length,
    );
  });
});

describe('fileTitle', () => {
  it('drops the extension', () => {
    expect(fileTitle('Q3 brief.docx')).toBe('Q3 brief');
    expect(fileTitle('notes')).toBe('notes');
  });
});

describe('startPageType', () => {
  it('picks the type the title or content shows, else a blog post', () => {
    expect(startPageType({ title: 'Northwind vs HubSpot' }, 'b2b')).toEqual({
      pageType: 'comparison',
      detected: true,
    });
    expect(
      startPageType(
        {
          title: 'Trail Runner X',
          html: '<script type="application/ld+json">{"@type":"Product"}</script>',
        },
        'ecommerce',
      ),
    ).toEqual({ pageType: 'product_page', detected: true });
    expect(startPageType({ title: 'Our story' }, 'b2c')).toEqual({
      pageType: 'blog_post',
      detected: false,
    });
  });
});
