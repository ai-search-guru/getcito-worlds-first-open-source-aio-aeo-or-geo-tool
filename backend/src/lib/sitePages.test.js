import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { looksBlocked, normalizePageUrl, parseHead, parseSitemap, robotsSitemaps, selectPages } =
  await import('./sitePages.js');

describe('normalizePageUrl', () => {
  it('keeps pages of the site and its subdomains in one form', () => {
    expect(normalizePageUrl('http://www.example.com/blog/post/?utm=x#top', 'example.com')).toBe(
      'https://example.com/blog/post',
    );
    expect(normalizePageUrl('/pricing', 'example.com')).toBe('https://example.com/pricing');
    expect(normalizePageUrl('https://docs.example.com/', 'www.example.com')).toBe(
      'https://docs.example.com',
    );
  });

  it('drops other hosts, files and transactional or legal paths', () => {
    expect(normalizePageUrl('https://notexample.com/a', 'example.com')).toBeNull();
    expect(normalizePageUrl('https://example.com/guide.pdf', 'example.com')).toBeNull();
    expect(normalizePageUrl('https://example.com/checkout', 'example.com')).toBeNull();
    expect(normalizePageUrl('mailto:hi@example.com', 'example.com')).toBeNull();
  });
});

describe('sitemaps', () => {
  it('reads page entries and child sitemaps', () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>
      <urlset>
        <url><loc>https://example.com/a?x=1&amp;y=2</loc><lastmod>2026-09-01</lastmod></url>
        <url><loc><![CDATA[https://example.com/b]]></loc></url>
      </urlset>`;
    expect(parseSitemap(xml)).toEqual({
      sitemaps: ['https://example.com/post-sitemap.xml'],
      urls: [
        { loc: 'https://example.com/a?x=1&y=2', lastmod: '2026-09-01' },
        { loc: 'https://example.com/b', lastmod: null },
      ],
    });
  });

  it('finds the sitemaps robots.txt declares', () => {
    expect(
      robotsSitemaps(
        'User-agent: *\nDisallow:\nSitemap: https://example.com/s.xml\nsitemap: https://example.com/t.xml.gz',
      ),
    ).toEqual(['https://example.com/s.xml', 'https://example.com/t.xml.gz']);
  });
});

describe('parseHead', () => {
  it('reads the title, description and first heading', () => {
    const html = `<html><head><title> Best AI tools &amp; more </title>
      <meta content="Compare the tools." name="description"></head>
      <body><h1 class="x">AI <span>tools</span></h1><h1>second</h1></body></html>`;
    expect(parseHead(html)).toEqual({
      title: 'Best AI tools & more',
      description: 'Compare the tools.',
      h1: 'AI tools',
    });
  });

  it('falls back to og:description and leaves missing fields null', () => {
    expect(parseHead(`<meta property='og:description' content='From OG'>`)).toEqual({
      title: null,
      description: 'From OG',
      h1: null,
    });
  });
});

describe('looksBlocked', () => {
  it('sends bot walls to the proxy and lets real misses stand', () => {
    expect(looksBlocked(403, '')).toBe(true);
    expect(looksBlocked(200, '<title>Just a moment...</title>')).toBe(true);
    expect(looksBlocked(404, '<h1>Not found</h1>')).toBe(false);
  });
});

describe('selectPages', () => {
  it('merges sources and ranks citations, then traffic, then sitemap order', () => {
    const pages = selectPages(
      {
        sitemap: [
          { loc: 'https://example.com/old', lastmod: '2025-01-01' },
          { loc: 'https://example.com/blog', lastmod: null },
          { loc: 'https://example.com/cited', lastmod: null },
        ],
        ga: [
          ['/blog/', 40],
          ['/checkout', 900],
        ],
        citations: [{ url: 'https://www.example.com/cited', cur_citations: 3 }],
      },
      'example.com',
    );
    expect(pages.map((p) => [p.url, p.sources])).toEqual([
      ['https://example.com/cited', ['citation', 'sitemap']],
      ['https://example.com/blog', ['ga', 'sitemap']],
      ['https://example.com/old', ['sitemap']],
    ]);
    expect(pages[1].ga_sessions).toBe(40);
    expect(pages[2].lastmod).toBe('2025-01-01T00:00:00.000Z');
  });

  it('keeps at most the limit', () => {
    const sitemap = Array.from({ length: 5 }, (_, i) => ({ loc: `https://example.com/p${i}` }));
    expect(selectPages({ sitemap, ga: [], citations: [] }, 'example.com', 2)).toHaveLength(2);
  });
});
