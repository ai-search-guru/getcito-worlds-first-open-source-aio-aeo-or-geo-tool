import { describe, expect, it } from 'vitest';
import {
  aiVisitsByPage,
  buildOpportunities,
  competitorGapPages,
  excludePatternMatcher,
  normalizeExcludePattern,
  opportunityKey,
  siteCoverage,
} from './opportunities.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const audit = (url, score, days, status = 'completed') => ({
  key: opportunityKey(url),
  url,
  score,
  auditId: `a-${url}`,
  lastAuditedAt: daysAgo(days),
  status,
});

const build = (over = {}) =>
  buildOpportunities({
    primaryHost: 'acme.com',
    staleDays: 90,
    now: NOW,
    ...over,
  });

describe('opportunityKey', () => {
  it('reads every spelling of a page, in any case, as one page', () => {
    expect(
      new Set(
        [
          'https://acme.com/Pricing',
          'https://www.acme.com/pricing/',
          'http://ACME.com/pricing?utm_source=x',
        ].map(opportunityKey),
      ),
    ).toEqual(new Set(['acme.com/pricing']));
    expect(opportunityKey('not a url')).toBeNull();
  });
});

describe('buildOpportunities', () => {
  it("lists GA's valuable pages without AI traffic, with their last audit", () => {
    const { rows } = build({
      gaPages: [
        {
          landing_page: '/pricing',
          value_signal: 'revenue',
          value_percentile: '95',
          sessions: 1200,
          citation_state: 'targeted_not_cited',
          citations: 0,
        },
      ],
      auditPages: [audit('https://acme.com/pricing/', 0.63, 3)],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'acme.com/pricing',
        url: 'https://acme.com/pricing',
        path: '/pricing',
        pinned: false,
        running: false,
        sessions: 1200,
        reasons: [
          {
            type: 'no_ai_traffic',
            signal: 'revenue',
            percentile: 95,
            citationState: 'targeted_not_cited',
          },
        ],
        lastAudit: { at: daysAgo(3), score: 0.63, auditId: 'a-https://acme.com/pricing/' },
      }),
    ]);
  });

  it('lists site pages never audited or audited too long ago, and leaves fresh audits out', () => {
    const { rows } = build({
      sitePages: [
        { url: 'https://acme.com/blog/guide', title: 'Guide', ga_sessions: 40, ai_citations: 3 },
        { url: 'https://acme.com/compare', title: 'Compare', ga_sessions: 90, ai_citations: 0 },
        { url: 'https://acme.com/about', title: 'About', ga_sessions: 10, ai_citations: 0 },
        // A failed audit doesn't count as one.
        { url: 'https://acme.com/team', title: 'Team', ga_sessions: 5, ai_citations: 0 },
      ],
      auditPages: [
        audit('https://acme.com/compare', 0.7, 120),
        audit('https://acme.com/about', 0.8, 10),
        audit('https://acme.com/team', null, 2, 'failed'),
      ],
    });
    // Path order here; the priority score orders the inbox (priority.js).
    expect(rows.map((r) => [r.path, r.reasons])).toEqual([
      ['/blog/guide', [{ type: 'never_audited' }]],
      ['/compare', [{ type: 'stale_audit', days: 120 }]],
      ['/team', [{ type: 'never_audited' }]],
    ]);
    expect(rows[0]).toMatchObject({ title: 'Guide', citations: 3, sessions: 40, lastAudit: null });
  });

  it('merges one page from both sources and keeps checkout-like pages out', () => {
    const { rows } = build({
      gaPages: [
        {
          landing_page: '/pricing',
          value_signal: 'key_events',
          value_percentile: 80,
          sessions: 50,
        },
      ],
      sitePages: [
        { url: 'https://acme.com/Pricing/', title: 'Pricing', ga_sessions: 48, ai_citations: 1 },
        { url: 'https://acme.com/legal/terms', title: 'Terms', ga_sessions: 2, ai_citations: 0 },
        { url: 'https://acme.com/cart', title: 'Cart', ga_sessions: 30, ai_citations: 0 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons.map((r) => r.type)).toEqual(['no_ai_traffic', 'never_audited']);
    expect(rows[0]).toMatchObject({ title: 'Pricing', sessions: 50 });
  });

  it('puts pinned pages first, even with nothing to fix, and lists excluded ones apart', () => {
    const { rows, excluded } = build({
      gaPages: [
        { landing_page: '/pricing', value_signal: 'revenue', value_percentile: 99, sessions: 10 },
      ],
      sitePages: [
        { url: 'https://acme.com/blog', title: 'Blog', ga_sessions: 1, ai_citations: 0 },
        { url: 'https://acme.com/about', title: 'About', ga_sessions: 1, ai_citations: 0 },
      ],
      auditPages: [audit('https://acme.com/about', 0.9, 5)],
      prefs: [
        { page_key: 'acme.com/about', url: 'https://acme.com/about', state: 'pinned' },
        { page_key: 'acme.com/blog', url: 'https://acme.com/blog', state: 'excluded' },
        { page_key: 'acme.com/old', url: 'https://acme.com/old', state: 'excluded' },
      ],
    });
    expect(rows.map((r) => [r.path, r.pinned])).toEqual([
      ['/about', true],
      ['/pricing', false],
    ]);
    expect(excluded.map((e) => [e.path, e.title])).toEqual([
      ['/blog', 'Blog'],
      ['/old', null],
    ]);
  });

  it('marks a page being audited, and lists GA pages only with a primary host', () => {
    const { rows } = build({
      sitePages: [{ url: 'https://acme.com/new', title: null, ga_sessions: 0, ai_citations: 0 }],
      auditPages: [audit('https://acme.com/new', null, 0, 'running')],
    });
    expect(rows[0]).toMatchObject({ path: '/new', running: true, lastAudit: null });

    expect(
      build({
        primaryHost: null,
        gaPages: [
          { landing_page: '/pricing', value_signal: 'revenue', value_percentile: 90, sessions: 5 },
        ],
      }).rows,
    ).toEqual([]);
  });
});

describe('exclude patterns', () => {
  it('stores a pattern as a lowercased path without a trailing slash', () => {
    expect(normalizeExcludePattern(' /Legal/* ')).toBe('/legal/*');
    expect(normalizeExcludePattern('/blog/')).toBe('/blog');
    expect(normalizeExcludePattern('/')).toBe('/');
    expect(normalizeExcludePattern('legal/*')).toBeNull();
    expect(normalizeExcludePattern('/a b')).toBeNull();
    expect(normalizeExcludePattern(`/${'x'.repeat(200)}`)).toBeNull();
  });

  it('matches the whole path, * standing for anything, in any case', () => {
    const excluded = excludePatternMatcher(['/legal/*', '/tag/*/page', '/about.html']);
    expect(excluded('/legal/terms')).toBe(true);
    expect(excluded('/Legal/privacy/eu')).toBe(true);
    expect(excluded('/legal')).toBe(false);
    expect(excluded('/tag/coffee/page')).toBe(true);
    expect(excluded('/about.html')).toBe(true);
    // The dot is a dot, not any character.
    expect(excluded('/aboutxhtml')).toBe(false);
    expect(excludePatternMatcher([])('/x')).toBe(false);
  });

  it('leaves pages under a pattern out of the inbox, unless pinned', () => {
    const { rows, excluded } = build({
      sitePages: [
        { url: 'https://acme.com/stories/old', title: 'Old', ga_sessions: 1, ai_citations: 0 },
        { url: 'https://acme.com/stories/best', title: 'Best', ga_sessions: 1, ai_citations: 0 },
        { url: 'https://acme.com/pricing', title: 'Pricing', ga_sessions: 9, ai_citations: 0 },
      ],
      prefs: [
        {
          page_key: 'acme.com/stories/best',
          url: 'https://acme.com/stories/best',
          state: 'pinned',
        },
      ],
      excludePatterns: ['/stories/*'],
    });
    expect(rows.map((r) => r.path)).toEqual(['/stories/best', '/pricing']);
    // A pattern isn't a page to put back: the Excluded list doesn't show it.
    expect(excluded).toEqual([]);
  });
});

describe('aiVisitsByPage', () => {
  it('takes Google Analytics where it has the page, else the snippet, never both', () => {
    const visits = aiVisitsByPage({
      analytics: [
        { page: 'https://acme.com/a', platform: 'chatgpt', cur_sessions: 4 },
        { page: 'https://acme.com/a', platform: 'perplexity', cur_sessions: 2 },
      ],
      snippet: [
        { page: 'https://acme.com/a', platform: 'chatgpt', cur_sessions: 9 },
        { page: 'https://acme.com/b', platform: 'chatgpt', cur_sessions: 3 },
        { page: null, platform: 'chatgpt', cur_sessions: 50 },
      ],
    });
    expect([...visits]).toEqual([
      ['https://acme.com/a', 6],
      ['https://acme.com/b', 3],
    ]);
    expect(aiVisitsByPage(null).size).toBe(0);
  });
});

describe('competitorGapPages', () => {
  const sitePages = [
    {
      url: 'https://acme.com/subscriptions/pricing',
      title: 'Coffee subscription plans and pricing',
      h1: 'Plans & Pricing',
      description: 'Compare our coffee subscription plans.',
    },
    {
      url: 'https://acme.com/guides/espresso',
      title: 'Espresso machines for beginners',
      h1: 'Espresso machines',
      description: 'How to choose a home espresso machine.',
    },
  ];
  const names = new Map([
    ['crema.example', 'Crema Club'],
    ['north.example', 'Northline'],
  ]);
  const prompt = (id, text, over = {}) => ({
    prompt_id: id,
    prompt_text: text,
    own_results: 0,
    competitor_domains: ['crema.example'],
    ...over,
  });

  it("maps each prompt a competitor wins to the brand's closest page", () => {
    const pages = competitorGapPages({
      prompts: [
        prompt('p1', 'best coffee subscription plans pricing'),
        prompt('p2', 'cheapest coffee subscription plans', {
          competitor_domains: ['north.example', 'crema.example'],
        }),
        prompt('p3', 'which espresso machine for beginners at home'),
      ],
      sitePages,
      competitorNames: names,
    });
    expect(pages).toEqual([
      {
        url: 'https://acme.com/subscriptions/pricing',
        prompts: 2,
        competitors: ['Crema Club', 'Northline'],
      },
      { url: 'https://acme.com/guides/espresso', prompts: 1, competitors: ['Crema Club'] },
    ]);
  });

  it("prefers a prompt's target URLs, and skips prompts the brand is cited on or no page matches", () => {
    const pages = competitorGapPages({
      prompts: [
        prompt('p1', 'best coffee subscription plans pricing'),
        prompt('p2', 'espresso machine for beginners', { own_results: '2' }),
        prompt('p3', 'gift ideas for tea lovers'),
      ],
      targetUrls: [{ prompt_id: 'p1', url: 'https://acme.com/gifts' }],
      sitePages,
      competitorNames: names,
    });
    expect(pages).toEqual([
      { url: 'https://acme.com/gifts', prompts: 1, competitors: ['Crema Club'] },
    ]);
  });

  it('names an unknown competitor domain by its domain', () => {
    const [page] = competitorGapPages({
      prompts: [
        prompt('p1', 'coffee subscription plans', { competitor_domains: ['other.example'] }),
      ],
      sitePages,
      competitorNames: names,
    });
    expect(page.competitors).toEqual(['other.example']);
  });
});

describe('buildOpportunities with competitor-cited pages', () => {
  it('adds the reason to the page, with its traffic from site_pages', () => {
    const { rows } = build({
      sitePages: [
        { url: 'https://acme.com/pricing', title: 'Pricing', ga_sessions: 40, ai_citations: 1 },
        { url: 'https://acme.com/fresh', title: 'Fresh', ga_sessions: 12, ai_citations: 0 },
      ],
      competitorPages: [
        { url: 'https://acme.com/pricing', prompts: 3, competitors: ['Crema Club'] },
        { url: 'https://acme.com/fresh', prompts: 1, competitors: ['Northline'] },
      ],
      auditPages: [audit('https://acme.com/fresh', 0.8, 2)],
    });
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(byPath['/pricing'].reasons).toEqual([
      { type: 'never_audited' },
      { type: 'competitor_cited', prompts: 3, competitors: ['Crema Club'] },
    ]);
    // Audited two days ago, still listed: the competitor gap is the reason,
    // and its title and sessions come from site_pages.
    expect(byPath['/fresh']).toMatchObject({
      reasons: [{ type: 'competitor_cited', prompts: 1, competitors: ['Northline'] }],
      title: 'Fresh',
      sessions: 12,
    });
  });
});

describe('siteCoverage (customer priorities item 11)', () => {
  const page = (path) => ({ url: `https://acme.com${path}` });
  const sitePages = [
    page('/'),
    page('/pricing'),
    page('/blog/old'),
    page('/blog/new/'),
    page('/checkout'),
    page('/legal/terms'),
    page('/careers-at-acme'),
    page('/pricing/'),
  ];
  const auditPages = [
    audit('https://acme.com/', 0.7, 3),
    audit('https://acme.com/blog/old', 0.5, 120),
    // A failed audit is no audit.
    audit('https://acme.com/blog/new', null, 1, 'failed'),
  ];
  const coverage = (over = {}) =>
    siteCoverage({ sitePages, auditPages, staleDays: 90, now: NOW, ...over });

  it('counts the pages the inbox weighs: audited lately, never, or long ago', () => {
    // /checkout is left out as the inbox leaves it; /pricing counts once.
    expect(coverage({ excludePatterns: ['/legal/*', '/careers-at-acme'] })).toEqual({
      pages: 4,
      audited: 1,
      never: 2,
      stale: 1,
    });
  });

  it('agrees with the inbox’s Never audited and Audited N days ago rows', () => {
    const excludePatterns = ['/legal/*'];
    const prefs = [
      { page_key: 'acme.com/pricing', url: 'https://acme.com/pricing', state: 'excluded' },
      { page_key: 'acme.com/checkout', url: 'https://acme.com/checkout', state: 'pinned' },
    ];
    const { rows } = build({ sitePages, auditPages, prefs, excludePatterns });
    const listed = rows.filter((r) =>
      r.reasons.some((x) => x.type === 'never_audited' || x.type === 'stale_audit'),
    );
    const { never, stale, pages, audited } = coverage({ prefs, excludePatterns });
    expect(never + stale).toBe(listed.length);
    // The excluded /pricing is out; the pinned /checkout is in.
    expect({ pages, audited, never, stale }).toEqual({ pages: 5, audited: 1, never: 3, stale: 1 });
  });

  it('is nothing for a brand with no site pages', () => {
    expect(siteCoverage({ staleDays: 90 })).toEqual({ pages: 0, audited: 0, never: 0, stale: 0 });
  });
});
