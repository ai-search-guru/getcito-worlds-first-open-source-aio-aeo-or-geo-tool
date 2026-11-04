import { describe, expect, it } from 'vitest';
import { buildTemplates, templateOpportunities, templateOf } from './templates.js';

const site = (path, ga_sessions = null) => ({ url: `https://acme.com${path}`, ga_sessions });
const audited = (path, auditId, score = 0.5, host = 'acme.com', status = 'completed') => ({
  key: `${host}${path}`,
  host,
  path,
  url: `https://${host}${path}`,
  auditId,
  score,
  status,
});
const failing = (auditId, ...keys) => keys.map((signal_key) => ({ audit_id: auditId, signal_key }));

describe('templateOf', () => {
  it('turns the last part of the path into a wildcard', () => {
    expect(templateOf('/blog/milk-drinks')).toBe('/blog/*');
    expect(templateOf('/Guides/Coffee/Espresso')).toBe('/guides/coffee/*');
    expect(templateOf('/pricing')).toBeNull();
    expect(templateOf('/')).toBeNull();
  });
});

describe('buildTemplates', () => {
  it('counts site and audited pages once, and lists the gaps most audited pages share', () => {
    const templates = buildTemplates({
      primaryHost: 'acme.com',
      sitePages: [
        site('/blog/a'),
        site('/blog/b'),
        site('/blog/c'),
        site('/blog/d'),
        site('/pricing'),
      ],
      auditPages: [audited('/blog/a', 'a1'), audited('/blog/b', 'b1'), audited('/blog/c', 'c1')],
      failingRows: [
        ...failing('a1', 'author-byline', 'faq-schema', 'og-meta'),
        ...failing('b1', 'author-byline', 'faq-schema'),
        ...failing('c1', 'author-byline'),
      ],
    });
    expect(templates).toEqual([
      {
        template: '/blog/*',
        pages: 4,
        audited: 3,
        urls: [
          'https://acme.com/blog/a',
          'https://acme.com/blog/b',
          'https://acme.com/blog/c',
          'https://acme.com/blog/d',
        ],
        // The pages an audit of the template starts: the one not audited.
        toAudit: ['https://acme.com/blog/d'],
        running: false,
        sessions: null,
        // og-meta fails on one of three: not the template's.
        sharedGaps: [
          { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 3 },
          { key: 'faq-schema', label: 'FAQ schema', category: 'structure', pages: 2 },
        ],
      },
    ]);
  });

  it('needs three pages, two audited pages for a gap, and the primary host', () => {
    expect(
      buildTemplates({
        primaryHost: 'acme.com',
        sitePages: [site('/docs/a'), site('/docs/b')],
      }),
    ).toEqual([]);

    const [only] = buildTemplates({
      primaryHost: 'acme.com',
      sitePages: [site('/docs/a'), site('/docs/b'), site('/docs/c')],
      auditPages: [audited('/docs/a', 'a1'), audited('/docs/x', 'x1', 0.5, 'other.com')],
      failingRows: failing('a1', 'author-byline'),
    });
    expect(only).toMatchObject({ template: '/docs/*', pages: 3, audited: 1, sharedGaps: [] });
    expect(buildTemplates({ primaryHost: null, sitePages: [site('/a/b')] })).toEqual([]);
  });

  it("leaves out an audit that didn't complete, and orders the biggest template first", () => {
    const templates = buildTemplates({
      primaryHost: 'acme.com',
      sitePages: ['/a/1', '/a/2', '/a/3', '/b/1', '/b/2', '/b/3', '/b/4'].map(site),
      auditPages: [audited('/a/1', 'x1', null), audited('/a/2', 'x2'), audited('/a/3', 'x3')],
      failingRows: [...failing('x1', 'faq-schema'), ...failing('x2', 'faq-schema')],
    });
    expect(templates.map((t) => [t.template, t.pages, t.audited])).toEqual([
      ['/b/*', 4, 0],
      ['/a/*', 3, 2],
    ]);
    // Failing on one of the two completed audits: under two-thirds.
    expect(templates[1].sharedGaps).toEqual([]);
  });

  it("sums the site pages' sessions, and marks a template with an audit running", () => {
    const [blog] = buildTemplates({
      primaryHost: 'acme.com',
      sitePages: [site('/blog/a', 10), site('/blog/b', 5), site('/blog/c')],
      auditPages: [audited('/blog/c', 'c1', null, 'acme.com', 'running')],
    });
    expect(blog).toMatchObject({ sessions: 15, running: true, audited: 0 });
    expect(blog.toAudit).toHaveLength(3);
  });
});

describe('buildTemplates and the pages that carry no opportunity', () => {
  it('leaves out account, checkout or legal pages, as the inbox does', () => {
    const templates = buildTemplates({
      primaryHost: 'acme.com',
      sitePages: [
        ...['/account/orders', '/account/profile', '/account/billing'].map((p) => site(p)),
        ...['/blog/a', '/blog/b', '/blog/legal'].map((p) => site(p)),
      ],
    });
    // /account/* is gone; /blog/legal isn't one of the blog's pages.
    expect(templates).toEqual([]);
  });
});

describe('templateOpportunities', () => {
  const blog = {
    template: '/blog/*',
    pages: 38,
    audited: 12,
    sharedGaps: [
      { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 10 },
    ],
    urls: [],
    toAudit: ['https://acme.com/blog/x'],
    running: false,
    sessions: 900,
  };

  it('turns a template whose pages share gaps into an inbox row', () => {
    expect(templateOpportunities([blog, { ...blog, template: '/docs/*', sharedGaps: [] }])).toEqual(
      [
        {
          key: 'template:/blog/*',
          url: null,
          path: '/blog/*',
          title: null,
          reasons: [
            { type: 'template_gaps', gaps: [{ key: 'author-byline', label: 'Author byline' }] },
          ],
          pinned: false,
          running: false,
          sessions: 900,
          citations: null,
          lastAudit: null,
          template: { pages: 38, audited: 12, toAudit: ['https://acme.com/blog/x'] },
        },
      ],
    );
  });

  it("leaves out a template the brand's exclude patterns cover", () => {
    expect(templateOpportunities([blog], (path) => path.startsWith('/blog/'))).toEqual([]);
  });
});
