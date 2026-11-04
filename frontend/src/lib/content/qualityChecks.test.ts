import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import {
  EEAT_WEIGHTS,
  MAX_LINK_CHECKS,
  TRUST_PHASE1_POINTS,
  TRUST_WEIGHTS,
  authorProfile,
  eeat,
  linksToCheck,
  shippingOnPage,
  scoreGain,
  sentenceGain,
  trust,
  trustBlocks,
  trustGain,
  unplacedSites,
  type LinkCheck,
} from './qualityChecks';

const author = (over: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
  ...over,
});

describe('eeat (Phase 1: the author)', () => {
  it('gives a real author with a bio and profile links every live point', () => {
    const result = eeat({ author: author() });
    expect(result.score).toBe(100);
    // Schema waits for Before you publish's JSON-LD, dates for the live page.
    expect(result.checks).toEqual([
      { id: 'byline', points: EEAT_WEIGHTS.byline, max: EEAT_WEIGHTS.byline },
      { id: 'authorBio', points: EEAT_WEIGHTS.authorBio, max: EEAT_WEIGHTS.authorBio },
    ]);
  });

  it('gives the organization byline none: it is no person', () => {
    const result = eeat({ author: null });
    expect(result.score).toBe(0);
    expect(scoreGain(result, ['byline'])).toBe(60);
  });

  it("counts the person's own image as visual proof, and none with images or spots unconfirmed (CE-049)", () => {
    const visual = (images: number, own: number, openSpots: number) =>
      eeat({ author: author(), visual: { images, own, openSpots } }).checks.find(
        (c) => c.id === 'visualProof',
      );
    expect(visual(2, 1, 0)).toEqual({ id: 'visualProof', points: 10, max: 10 });
    expect(visual(2, 0, 0)).toEqual({ id: 'visualProof', points: 0, max: 10 });
    expect(visual(0, 0, 1)).toEqual({ id: 'visualProof', points: 0, max: 10 });
    // No image and nothing suggested: the check is left out.
    expect(visual(0, 0, 0)).toBeUndefined();
    expect(eeat({ author: author() }).checks.find((c) => c.id === 'visualProof')).toBeUndefined();
  });

  it('counts the author the site names once the person confirms them, the profile with them', () => {
    expect(eeat({ author: null, confirmed: { real: true, profile: false } }).score).toBe(60);
    expect(eeat({ author: null, confirmed: { real: true, profile: true } }).score).toBe(100);
    // A profile with no real author confirmed counts nothing.
    expect(eeat({ author: null, confirmed: { real: false, profile: true } }).score).toBe(0);
    // A picked author is read as it is: confirmations don't add to it.
    expect(
      eeat({ author: author({ sameAs: [] }), confirmed: { real: true, profile: true } }).score,
    ).toBe(80);
  });

  it('gives half the profile points for a bio or links alone', () => {
    // byline 15 + bio 5 of 25.
    expect(eeat({ author: author({ sameAs: [] }) }).score).toBe(80);
    const bare = eeat({ author: author({ bio: '  ', sameAs: [] }) });
    expect(bare.score).toBe(60);
    expect(scoreGain(bare, ['authorBio'])).toBe(40);
    expect(authorProfile(author({ bio: '  ' }))).toEqual({ bio: false, links: true });
  });
});

describe('trust (Phase 1: figures and links)', () => {
  const NOW = Date.parse('2026-10-23T12:00:00Z');
  const blocks = (html: string) => trustBlocks(html);
  const read = (rows: Partial<LinkCheck>[]) =>
    new Map(
      rows.map((r) => [r.href!, { status: 'ok', httpStatus: 200, date: null, ...r } as LinkCheck]),
    );
  const run = (html: string, links = new Map<string, LinkCheck>()) =>
    trust({ blocks: blocks(html), links, brandDomains: ['acme.com'], now: NOW });

  it("isn't scored while the page has no figure, dated source or link read", () => {
    const result = run('<h1>Pipeline</h1><p>Teams forecast 5 steps ahead in 2026.</p>');
    expect(result.score).toBeNull();
    expect(result.figures).toBe(0);
  });

  it('counts a figure as sourced when its paragraph links another site', () => {
    const result = run(
      '<p>Win rates rose 42% last year (<a href="https://research.example/report">report</a>).</p>' +
        '<p>Deals close $2.5 million faster.</p>' +
        '<p>Our own page says 3x <a href="https://www.acme.com/pricing">pricing</a>.</p>' +
        '<ul><li>%40 daha hızlı</li></ul>',
    );
    // Our own site is no source: three of four figures have none.
    expect(result.figures).toBe(4);
    expect(result.unsourced).toEqual([
      'Deals close $2.5 million faster.',
      'Our own page says 3x pricing.',
      '%40 daha hızlı',
    ]);
    expect(result.checks).toEqual([
      { id: 'claimsSourced', points: TRUST_WEIGHTS.claimsSourced / 4, max: 30 },
    ]);
    expect(result.score).toBe(25);
  });

  it('reads sources older than 24 months as stale, and leaves undated ones out', () => {
    const result = run(
      '<p>See <a href="https://old.example/a">old</a>, <a href="https://new.example/b">new</a> and <a href="https://undated.example/">undated</a>.</p>',
      read([
        { href: 'https://old.example/a', date: '2024-09-01T00:00:00.000Z' },
        { href: 'https://new.example/b', date: '2025-01-01T00:00:00.000Z' },
        { href: 'https://undated.example/' },
      ]),
    );
    expect(result.dated).toBe(2);
    expect(result.stale.map((l) => l.url)).toEqual(['https://old.example/a']);
    expect(result.checks.find((c) => c.id === 'freshSources')).toEqual({
      id: 'freshSources',
      points: 3.5,
      max: 7,
    });
  });

  it("counts the links that answer, and leaves out the ones that wouldn't tell", () => {
    const result = run(
      '<p><a href="https://gone.example/">gone</a> <a href="https://www.acme.com/x">ours</a> <a href="https://walled.example/">walled</a></p>',
      read([
        { href: 'https://gone.example/', status: 'broken', httpStatus: 404 },
        { href: 'https://www.acme.com/x' },
        { href: 'https://walled.example/', status: 'unknown', httpStatus: 403 },
      ]),
    );
    expect(result.broken.map((l) => l.url)).toEqual(['https://gone.example/']);
    expect(result.checks).toEqual([{ id: 'noBrokenLinks', points: 1.5, max: 3 }]);
    // Links alone don't score Trust; the dead one is worth 1.5 of the 40 Phase 1 points.
    expect(result.score).toBeNull();
    expect(TRUST_PHASE1_POINTS).toBe(40);
    expect(trustGain(result, ['noBrokenLinks'])).toBe(4);
  });

  it('scores Trust only once a figure or a dated source is there', () => {
    const dead = read([{ href: 'https://gone.example/', status: 'broken', httpStatus: 404 }]);
    const working = read([{ href: 'https://gone.example/' }]);
    const linkOnly = '<p>See <a href="https://gone.example/">this</a>.</p>';
    // One link would otherwise set the whole score: 0 dead, 100 working.
    expect(run(linkOnly, dead).score).toBeNull();
    expect(run(linkOnly, working).score).toBeNull();
    expect(trustGain(run(linkOnly, dead), ['noBrokenLinks'])).toBe(8);
    expect(trustGain(run(linkOnly, working), ['noBrokenLinks'])).toBe(0);
    // Out of the page type's Phase 1 points when weighed for it (CE-052).
    expect(trustGain({ ...run(linkOnly, dead), phase1Points: 75 }, ['noBrokenLinks'])).toBe(4);
    expect(trustGain({ ...run(linkOnly, dead), phase1Points: 0 }, ['noBrokenLinks'])).toBe(0);

    // With a figure the links count among Trust's live checks: 30 + 0 of 33.
    const withFigure = run(
      '<p>Win rates rose 42% (<a href="https://gone.example/">this</a>).</p>',
      dead,
    );
    expect(withFigure.score).toBe(91);
    expect(trustGain(withFigure, ['noBrokenLinks'])).toBe(scoreGain(withFigure, ['noBrokenLinks']));
    // A dated source alone is enough too.
    const dated = read([{ href: 'https://gone.example/', date: '2026-01-01T00:00:00.000Z' }]);
    expect(run(linkOnly, dated).score).toBe(100);
  });

  it(`asks for each http(s) link once, ${MAX_LINK_CHECKS} at most`, () => {
    const many = Array.from({ length: 25 }, (_, i) => `<a href="https://s${i}.example/">s</a>`);
    const html = `<p><a href="/pricing">p</a> <a href="https://a.example/">a</a> <a href="https://a.example/">a</a></p><p>${many.join(' ')}</p>`;
    const urls = linksToCheck(blocks(html));
    expect(urls[0]).toBe('https://a.example/');
    expect(urls).toHaveLength(MAX_LINK_CHECKS);
  });

  it('reads only figures as claims: not prices, sizes, years or ranks', () => {
    const claims = [
      'Teams grew 10k accounts.',
      'Revenue hit 2M last year.',
      'It loads 3 times faster.',
      'Rates rose 12 percent.',
      'Costs fell by €4.5 million.',
      '100% of our customers renewed.',
      'Get 50% off and 20% more reach.',
    ];
    const plain = [
      'Plans start at $29/month.',
      'A 10 x 20 cm box.',
      'Room 3X is upstairs.',
      'Support is open 24/7.',
      'We ranked #1 in 2026.',
      'Save 20% on your first order.',
      'Get 50% off all shoes.',
      'A 0% APR loan.',
      'Made from 100% organic cotton.',
      'Our 100% money-back guarantee covers every plan.',
      'Watch it in 4K on any TV.',
      'Roll it into your 401k.',
      'Plans from $1.2k/month.',
    ];
    const result = run(`<p>${[...claims, ...plain].join(' ')}</p>`);
    expect(result.unsourced).toEqual(claims);
  });

  it('counts a link and a sentence once, as the draft saves the link', () => {
    const html =
      '<p>Read <a href="https://WWW.Gone.example?utm_source=mail">this</a>.</p>' +
      '<p>And <a href="https://www.gone.example/">this again</a>.</p>' +
      '<ul><li>Up 40% now.<ul><li>Up 40% now.</li></ul></li></ul>';
    expect(linksToCheck(blocks(html))).toEqual(['https://www.gone.example/']);
    const result = run(
      html,
      read([{ href: 'https://www.gone.example/', status: 'broken', httpStatus: 404 }]),
    );
    expect(result.broken).toHaveLength(1);
    expect(result.figures).toBe(1);
  });

  it("counts the site's trust checks beside the page's own, 5 points for all five", () => {
    const run = (html: string) =>
      trust({
        blocks: blocks(html),
        links: new Map(),
        brandDomains: ['acme.com'],
        siteTrust: { score: 3 },
        now: NOW,
      });
    const result = run('<p>Up 40% (<a href="https://src.example/">source</a>).</p>');
    expect(result.checks).toEqual([
      { id: 'claimsSourced', points: 30, max: 30 },
      { id: 'siteTrust', points: 3, max: TRUST_WEIGHTS.siteTrust },
    ]);
    expect(result.score).toBe(94);
    // Alone, the site's 5 points would be the whole of the page's Trust.
    expect(run('<p>No figures here.</p>').score).toBeNull();
  });
});

describe('Your input (Phase 2, CE-048)', () => {
  it("counts the person's experience and data in E-E-A-T once the page uses them", () => {
    const none = eeat({ author: author(), used: { experience: false, data: false } });
    // byline 15 + bio 10 of 60.
    expect(none.score).toBe(42);
    expect(none.checks.map((c) => c.id)).toEqual([
      'experience',
      'originalData',
      'byline',
      'authorBio',
    ]);
    expect(scoreGain(none, ['experience'])).toBe(33);
    expect(eeat({ author: author(), used: { experience: true, data: true } }).score).toBe(100);
    // Before Your input is read: Phase 1's checks alone.
    expect(eeat({ author: author() }).checks.map((c) => c.id)).toEqual(['byline', 'authorBio']);
  });

  it("counts an expert's quote in Trust, once Trust is scored", () => {
    const NOW = Date.parse('2026-10-23T12:00:00Z');
    const run = (html: string, quote: boolean | null) =>
      trust({ blocks: trustBlocks(html), links: new Map(), brandDomains: [], quote, now: NOW });
    const sourced = '<p>Up 40% (<a href="https://src.example/">source</a>).</p>';
    expect(run(sourced, true).checks).toEqual([
      { id: 'claimsSourced', points: 30, max: 30 },
      { id: 'expertQuote', points: TRUST_WEIGHTS.expertQuote, max: TRUST_WEIGHTS.expertQuote },
    ]);
    // 30 of 38.
    expect(run(sourced, false).score).toBe(79);
    expect(run(sourced, null).checks.map((c) => c.id)).toEqual(['claimsSourced']);
    // A quote alone doesn't score Trust: one check would set the whole score.
    expect(run('<p>No figures here.</p>', true).score).toBeNull();
  });
});

describe('trust (Phase 2: what kind of source each link is, CE-046)', () => {
  const NOW = Date.parse('2026-10-23T12:00:00Z');
  const run = (html: string, over: { pageType?: string; kept?: string[] } = {}) =>
    trust({
      blocks: trustBlocks(html),
      links: new Map(),
      brandDomains: ['acme.com'],
      sources: {
        competitorDomains: ['rival.example'],
        pageType: over.pageType ?? 'guide',
        kept: new Set(over.kept ?? []),
      },
      now: NOW,
    });
  const a = (href: string) => `<a href="${href}">source</a>`;

  it('wants a primary source among them, and none weak or a competitor’s', () => {
    const result = run(
      `<p>Flu season runs from October ${a('https://www.cdc.gov/flu')}.</p>` +
        `<p>People say it works ${a('https://www.reddit.com/r/x/1')}.</p>` +
        `<p>Their tool does it too ${a('https://rival.example/feature')}.</p>` +
        `<p>Reported by ${a('https://www.reuters.com/x')}, on ${a('https://www.acme.com/blog')}.</p>`,
    );
    expect(result.checks).toEqual([
      { id: 'primarySources', points: TRUST_WEIGHTS.primarySources, max: 15 },
      { id: 'noWeakSources', points: (TRUST_WEIGHTS.noWeakSources * 2) / 4, max: 10 },
    ]);
    // Two placed sources score Trust on their own; the brand's own page isn't one.
    expect(result.classified).toBe(4);
    expect(result.score).toBe(80);
    expect(result.weak.map((w) => [w.url, w.kind])).toEqual([
      ['https://www.reddit.com/r/x/1', 'weak'],
      ['https://rival.example/feature', 'competitor'],
    ]);
  });

  it('takes a source the person kept, and a competitor’s own page on a comparison', () => {
    const html =
      `<p>People say it works ${a('https://www.reddit.com/r/x/1')}.</p>` +
      `<p>Their pricing ${a('https://rival.example/pricing')}.</p>`;
    expect(run(html).score).toBe(0);
    const kept = run(html, { pageType: 'comparison', kept: ['https://www.reddit.com/r/x/1'] });
    expect(kept.weak).toEqual([]);
    expect(kept.score).toBe(100);
  });

  it('takes the model’s read of a site the rules can’t place, and names those not read yet', () => {
    const html =
      `<p>A blog says so ${a('https://www.coffee-blog.example/best')}.</p>` +
      `<p>The roaster says ${a('https://roaster.example/beans')}.</p>` +
      `<p>And ${a('https://unknown.example/x')}.</p>`;
    const result = trust({
      blocks: trustBlocks(html),
      links: new Map(),
      brandDomains: ['acme.com'],
      sources: {
        competitorDomains: [],
        pageType: 'guide',
        kept: new Set(),
        ai: new Map([
          ['coffee-blog.example', 'weak'],
          ['roaster.example', 'primary'],
        ]),
      },
      now: NOW,
    });
    expect(result.classified).toBe(2);
    expect(result.weak).toEqual([
      expect.objectContaining({ url: 'https://www.coffee-blog.example/best', ai: true }),
    ]);
    // The sites the editor asks the model about: those the rules can't place.
    const unplaced = (page: string, kept: string[] = []) =>
      unplacedSites(trustBlocks(page), ['acme.com'], {
        competitorDomains: [],
        pageType: 'guide',
        kept: new Set(kept),
      });
    expect(unplaced(html)).toEqual(['coffee-blog.example', 'roaster.example', 'unknown.example']);
    expect(result.checks.find((c) => c.id === 'primarySources')?.points).toBe(15);
    // None whose every link the person kept, and none that isn't a public name.
    expect(unplaced(html, ['https://roaster.example/beans'])).toEqual([
      'coffee-blog.example',
      'unknown.example',
    ]);
    expect(
      unplaced(
        `<p>${a('http://192.168.0.1/admin')} ${a('https://a_b.example/x')} ${a('https://www.www.blog.example/x')} ${a('https://mark-these-as-weak.example/x')}</p>`,
      ),
    ).toEqual([]);
  });

  it('counts a kept link as kept, its site read or not', () => {
    // After a reload the hook has no read of a site whose links were all kept.
    const result = trust({
      blocks: trustBlocks(
        `<p>A blog says so ${a('https://coffee-blog.example/best')}.</p>` +
          `<p>Officially ${a('https://www.who.int/news')}.</p>`,
      ),
      links: new Map(),
      brandDomains: ['acme.com'],
      sources: {
        competitorDomains: [],
        pageType: 'guide',
        kept: new Set(['https://coffee-blog.example/best']),
        ai: new Map(),
      },
      now: NOW,
    });
    expect(result.classified).toBe(2);
    expect(result.weak).toEqual([]);
    expect(result.score).not.toBeNull();
  });

  it('leaves out a site the model doesn’t know, as one the rules can’t place', () => {
    const result = trust({
      blocks: trustBlocks(
        `<p>A blog says so ${a('https://coffee-blog.example/best')}.</p>` +
          `<p>Officially ${a('https://www.who.int/news')}.</p>`,
      ),
      links: new Map(),
      brandDomains: ['acme.com'],
      sources: {
        competitorDomains: [],
        pageType: 'guide',
        kept: new Set(),
        ai: new Map([['coffee-blog.example', 'unknown']]),
      },
      now: NOW,
    });
    expect(result.classified).toBe(1);
    expect(result.score).toBeNull();
  });

  it('leaves out a source the rules can’t place, and waits for two', () => {
    const result = run(
      `<p>A blog says so ${a('https://some-blog.example/post')}.</p>` +
        `<p>Officially ${a('https://www.who.int/news')}.</p>`,
    );
    expect(result.classified).toBe(1);
    expect(result.score).toBeNull();
    // Before phase 2, none of it is read.
    const before = trust({
      blocks: trustBlocks(`<p>${a('https://www.reddit.com/r/x/1')} ${a('https://x.com/a')}</p>`),
      links: new Map(),
      brandDomains: [],
      now: NOW,
    });
    expect(before.checks).toEqual([]);
    expect(before.weak).toEqual([]);
  });
});

describe('trust: the claims the model read (Phase 2, CE-045)', () => {
  const NOW = Date.parse('2026-10-23T12:00:00Z');
  const html =
    '<p>Ledgerly is the fastest forecasting app. Every plan is SOC 2 certified.</p>' +
    '<p>It is rated #1 by analysts (<a href="https://analysts.example/report">report</a>).</p>';
  const read = (claims: Parameters<typeof trust>[0]['claims']) =>
    trust({ blocks: trustBlocks(html), links: new Map(), brandDomains: [], claims, now: NOW });

  it('counts a claim with no source in its block as a figure with none, and one with a source as sourced', () => {
    const result = read([
      {
        text: 'Ledgerly is the fastest forecasting app. Every plan is SOC 2 certified.',
        claims: [
          { text: 'the fastest forecasting app', kind: 'superlative' },
          { text: 'SOC 2 certified', kind: 'fact' },
        ],
      },
      {
        // As Trust reads the block: a space at the link's edge.
        text: 'It is rated #1 by analysts ( report).',
        claims: [{ text: 'rated #1 by analysts', kind: 'superlative' }],
      },
    ]);
    expect(result.unsourced).toEqual([
      'Ledgerly is the fastest forecasting app.',
      'Every plan is SOC 2 certified.',
    ]);
    const block = 'Ledgerly is the fastest forecasting app. Every plan is SOC 2 certified.';
    expect(result.marks).toEqual([
      {
        text: 'the fastest forecasting app',
        sentence: 'Ledgerly is the fastest forecasting app.',
        block,
      },
      { text: 'SOC 2 certified', sentence: 'Every plan is SOC 2 certified.', block },
    ]);
    expect(result.aiClaims).toBe(2);
    expect(result.figures).toBe(3);
    // 1 of 3 sourced: Trust is scored from the claims alone.
    expect(result.checks.find((c) => c.id === 'claimsSourced')?.points).toBe(10);
    expect(result.score).not.toBeNull();
  });

  it('finds a claim by its words when its block reads otherwise, and leaves Phase 1 as it was', () => {
    const result = read([
      { text: 'a block written since', claims: [{ text: 'SOC 2 certified', kind: 'fact' }] },
    ]);
    expect(result.unsourced).toEqual(['Every plan is SOC 2 certified.']);
    const before = read(null);
    expect(before.unsourced).toEqual([]);
    expect(before.marks).toEqual([]);
    expect(before.aiClaims).toBe(0);
    expect(before.score).toBeNull();
  });

  it('says a figure the rules found is no AI check', () => {
    const result = trust({
      blocks: trustBlocks('<p>Teams cut 40% of their busywork. Ledgerly is the fastest app.</p>'),
      links: new Map(),
      brandDomains: [],
      claims: [
        {
          text: 'Teams cut 40% of their busywork. Ledgerly is the fastest app.',
          claims: [
            { text: 'cut 40% of their busywork', kind: 'number' },
            { text: 'the fastest app', kind: 'superlative' },
          ],
        },
      ],
      now: NOW,
    });
    expect(result.unsourced).toHaveLength(2);
    expect(result.aiClaims).toBe(1);
    // Underlined in the model's words where it read some, the figure's sentence too.
    expect(result.marks.map((m) => m.text)).toEqual([
      'cut 40% of their busywork',
      'the fastest app',
    ]);
  });

  it('leaves out a claim taken out of its block since, not one it makes up', () => {
    // The claims were read with "SOC 2 certified." in the block; it's gone now.
    const page = '<p>Ledgerly is the fastest forecasting app.</p>';
    const result = trust({
      blocks: trustBlocks(page),
      links: new Map(),
      brandDomains: [],
      claims: [
        {
          text: 'Ledgerly is the fastest forecasting app.',
          claims: [
            { text: 'the fastest forecasting app', kind: 'superlative' },
            { text: 'SOC 2 certified', kind: 'fact' },
          ],
        },
      ],
      now: NOW,
    });
    expect(result.unsourced).toEqual(['Ledgerly is the fastest forecasting app.']);
    expect(result.marks.map((m) => m.text)).toEqual(['the fastest forecasting app']);
    expect(result.figures).toBe(1);
  });

  it("finds each claim in its own block, and lists them in the page's order", () => {
    // The first block's claim moved to another block since it was read;
    // the model's claims come after the rules' figures in the read.
    const page =
      '<p>Teams cut 40% of their busywork.</p>' +
      '<p>Ledgerly is the fastest app. Every plan is SOC 2 certified.</p>';
    const result = trust({
      blocks: trustBlocks(page),
      links: new Map(),
      brandDomains: [],
      claims: [
        {
          text: 'Ledgerly is the fastest app.',
          claims: [
            { text: 'the fastest app', kind: 'superlative' },
            { text: 'SOC 2 certified', kind: 'fact' },
          ],
        },
        { text: 'Teams cut 40% of their busywork.', claims: [] },
      ],
      now: NOW,
    });
    expect(result.unsourced).toEqual([
      'Teams cut 40% of their busywork.',
      'Ledgerly is the fastest app.',
      'Every plan is SOC 2 certified.',
    ]);
    expect(result.marks.map((m) => [m.text, m.block])).toEqual([
      ['Teams cut 40% of their busywork.', 'Teams cut 40% of their busywork.'],
      ['the fastest app', 'Ledgerly is the fastest app. Every plan is SOC 2 certified.'],
      ['SOC 2 certified', 'Ledgerly is the fastest app. Every plan is SOC 2 certified.'],
    ]);
  });
});

describe('trust: consistent with brand facts (Phase 2, CE-047)', () => {
  const NOW = Date.parse('2026-10-24T12:00:00Z');
  const mismatch = {
    kind: 'price' as const,
    page: '$59',
    fact: '$49',
    source: 'pricing' as const,
    sentence: 'Pro costs $59 per month.',
  };
  const read = (
    brandFacts: Parameters<typeof trust>[0]['brandFacts'],
    html = '<p>Pro costs $59 per month.</p>',
  ) =>
    trust({ blocks: trustBlocks(html), links: new Map(), brandDomains: [], brandFacts, now: NOW });

  it('gives the share of the compared facts that match, and names the ones that don’t', () => {
    const result = read({ compared: 2, mismatches: [mismatch] });
    expect(result.checks.find((c) => c.id === 'brandFacts')).toEqual({
      id: 'brandFacts',
      points: 5,
      max: 10,
    });
    expect(result.mismatches).toEqual([mismatch]);
  });

  it('leaves the check out with nothing compared, and scores no Trust from it alone', () => {
    expect(read({ compared: 0, mismatches: [] }).checks.map((c) => c.id)).toEqual([]);
    const alone = read({ compared: 1, mismatches: [] }, '<p>A page with no figure.</p>');
    expect(alone.score).toBeNull();
    expect(read(null).mismatches).toEqual([]);
  });
});

describe('trust: the proof of the brand’s own claims (Phase 2, CE-049)', () => {
  const NOW = Date.parse('2026-10-24T12:00:00Z');
  const html =
    '<p>Ledgerly cut close times by 40% (<a href="https://www.acme.com/awards">award</a>). The market grew 12% in 2025.</p>' +
    '<p>Teams forecast 3x faster (<a href="https://www.acme.com/blog">blog</a>).</p>';
  const blocks = trustBlocks(html);
  const read = (proofs: { block: string; sentence: string }[] | null, page = blocks) =>
    trust({ blocks: page, links: new Map(), brandDomains: ['acme.com'], proofs, now: NOW });
  const award = { block: blocks[0].text, sentence: 'Ledgerly cut close times by 40% ( award).' };

  it("counts a link to the brand's own site as the source of its own claim's sentence, and nowhere else", () => {
    expect(read(null).unsourced).toEqual([
      'Ledgerly cut close times by 40% ( award).',
      'The market grew 12% in 2025.',
      'Teams forecast 3x faster ( blog).',
    ]);
    // The block's other figure isn't the brand's to prove: its own link doesn't source it.
    expect(read([award]).unsourced).toEqual([
      'The market grew 12% in 2025.',
      'Teams forecast 3x faster ( blog).',
    ]);
  });

  it('finds the proof once a link on its claim adds a space at its edge', () => {
    const linked = trustBlocks(
      '<p>We are <a href="https://www.acme.com/trust">ISO 27001</a>-certified for 3 years.</p>',
    );
    expect(linked[0].text).toBe('We are ISO 27001 -certified for 3 years.');
    expect(
      read(
        [
          {
            block: 'We are ISO 27001-certified for 3 years.',
            sentence: 'We are ISO 27001-certified for 3 years.',
          },
        ],
        linked,
      ).unsourced,
    ).toEqual([]);
  });

  it("gives a sentence's gain only while it is unsourced", () => {
    const result = read(null);
    const sentence = 'Teams forecast 3x faster ( blog).';
    const gain = sentenceGain(result, sentence);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBe(
      (read([{ block: blocks[1].text, sentence }]).score ?? 0) - (result.score ?? 0),
    );
    expect(sentenceGain(result, 'Not on the page.')).toBe(0);
    expect(sentenceGain(null, sentence)).toBe(0);
  });
});

describe('the page read’s AI checks (Phase 2, CE-050)', () => {
  const NOW = Date.parse('2026-10-25T12:00:00Z');
  it('counts who / how / why in E-E-A-T where it applies', () => {
    expect(eeat({ author: null, how: { found: true } }).checks).toContainEqual({
      id: 'whoHowWhy',
      points: 10,
      max: 10,
    });
    expect(eeat({ author: null, how: { found: false } }).checks).toContainEqual({
      id: 'whoHowWhy',
      points: 0,
      max: 10,
    });
    expect(eeat({ author: null }).checks.map((c) => c.id)).not.toContain('whoHowWhy');
  });

  it('counts balance and disclosure in Trust where they apply, and scores no Trust from them alone', () => {
    const read = (
      page: Parameters<typeof trust>[0]['page'],
      html = '<p>Pro saves 40% of the time (<a href="https://research.example/study">study</a>).</p>',
    ) => trust({ blocks: trustBlocks(html), links: new Map(), brandDomains: [], page, now: NOW });
    const both = read({ balanced: { found: false }, disclosure: { found: true } });
    expect(both.checks.filter((c) => c.id === 'balanced' || c.id === 'disclosure')).toEqual([
      { id: 'balanced', points: 0, max: 7 },
      { id: 'disclosure', points: 5, max: 5 },
    ]);
    expect(read({ balanced: null, disclosure: null }).checks.map((c) => c.id)).toEqual([
      'claimsSourced',
    ]);
    expect(
      read({ balanced: { found: true }, disclosure: null }, '<p>No figure here.</p>').score,
    ).toBeNull();
  });
});

describe('shippingOnPage (Phase 3, CE-052)', () => {
  const read = (html: string) => shippingOnPage(html);

  it('reads how shipping and returns work in a policy’s terms, headings and links too', () => {
    expect(read('<p>Free shipping in 2 days. Free returns within 30 days.</p>')).toEqual({
      shipping: true,
      returns: true,
    });
    expect(
      read(
        '<h2>Returns</h2><p>Ships within 24 hours.</p><p>30-day returns, no questions asked.</p>',
      ),
    ).toEqual({
      shipping: true,
      returns: true,
    });
    expect(
      read(
        '<p>See <a href="/policies/shipping_policy">delivery</a> and <a href="/pages/returns-and-refunds">this</a>.</p>',
      ),
    ).toEqual({ shipping: true, returns: true });
    expect(
      read('<p>Details: <a href="#versandkosten">Versand</a>, <a href="/reembolso">aquí</a>.</p>'),
    ).toEqual({
      shipping: true,
      returns: true,
    });
    // Turkish, capital İ at a sentence's start too.
    expect(read('<p>Kargo ücretsiz. İade koşulları: 14 gün.</p>')).toEqual({
      shipping: true,
      returns: true,
    });
  });

  it('reads the common ways shops state their terms (#1494 review)', () => {
    const shipping = [
      '<h3>Delivery &amp; Returns</h3><p>We send every order with tracking.</p>',
      '<p>Standard delivery 3–5 working days.</p>',
      '<p>Free UK delivery on orders over £50.</p>',
      '<p>Delivery: 2–4 working days.</p>',
      '<p>Expédition sous 24h.</p>',
      '<p>Entrega en 24/48 horas.</p>',
      '<p>Versand innerhalb von 2 Tagen.</p>',
      '<p>Siparişiniz 2 iş gününde teslim edilir.</p>',
      '<h2>Shipping</h2><p>Orders leave our warehouse daily.</p>',
    ];
    for (const html of shipping) expect(read(html)?.shipping).toBe(true);
    const returns = [
      '<p>Returns are accepted within 30 days.</p>',
      '<h2>Returns &amp; Exchanges</h2><p>Send it back unused.</p>',
      '<p>Retours acceptés, satisfait ou remboursé.</p>',
      '<p>Reembolso en 14 días.</p>',
      '<p>Kostenlose Retoure und Umtausch.</p>',
      '<p>Ücretsiz değişim hakkı.</p>',
    ];
    for (const html of returns) expect(read(html)?.returns).toBe(true);
  });

  it('reads no policy in everyday words', () => {
    for (const html of [
      '<p>Ships with a USB-C cable. In return, you get a two-year warranty.</p>',
      '<p>A strong return on investment, served from a content delivery network.</p>',
      '<p>Press Return to save. Trade it on any stock exchange.</p>',
      '<p>A sturdy daypack for wet hikes.</p>',
      // A spec, a product's link, a product named for the word.
      '<table><tr><td>Shipping weight</td><td>1.2 kg</td></tr></table>',
      '<p>See our <a href="/collections/delivery-bags">delivery bags</a>.</p>',
      '<p>Kargo pantolon, yüzde 100 pamuk.</p>',
      // A policy's heading with nothing under it.
      '<h2>Shipping</h2><h2>Materials</h2><p>Recycled nylon.</p>',
    ]) {
      expect(read(html)).toEqual({ shipping: false, returns: false });
    }
  });

  it('reads a page in a language its words aren’t written for by its links alone', () => {
    expect(shippingOnPage('<p>Spedizione gratuita in 24 ore.</p>', 'it')).toBeNull();
    expect(
      shippingOnPage('<p>Vedi <a href="/policies/shipping-policy">spedizione</a>.</p>', 'it'),
    ).toEqual({ shipping: true, returns: false });
  });
});

describe('trust: a product page’s shipping and returns (Phase 3, CE-052)', () => {
  const NOW = Date.parse('2026-10-25');

  it('counts half for one of the two, and is left out where not read', () => {
    const run = (shipping: { shipping: boolean; returns: boolean } | null) =>
      trust({
        blocks: trustBlocks('<p>Win rates rose 42% last year.</p>'),
        links: new Map(),
        brandDomains: ['acme.com'],
        shipping,
        now: NOW,
      });
    expect(
      run({ shipping: true, returns: false }).checks.find((c) => c.id === 'shippingReturns'),
    ).toEqual({
      id: 'shippingReturns',
      points: 5,
      max: 10,
    });
    expect(run(null).checks.some((c) => c.id === 'shippingReturns')).toBe(false);
    expect(run(null).shipping).toBeNull();
  });
});

describe('trust: a product page’s price and stock against its feed (Phase 3, CE-053)', () => {
  const NOW = Date.parse('2026-10-25');

  it('counts the share that matches, names what differs, and is left out where not compared', () => {
    const run = (feed: Parameters<typeof trust>[0]['feed']) =>
      trust({
        blocks: trustBlocks('<p>The Ridge 28 costs $129.</p>'),
        links: new Map(),
        brandDomains: ['acme.com'],
        feed,
        now: NOW,
      });
    const differs = {
      kind: 'price' as const,
      page: '$129',
      feed: '$119',
      sentence: 'The Ridge 28 costs $129.',
    };
    const read = run({ compared: 2, mismatches: [differs] });
    expect(read.checks.find((c) => c.id === 'feedMatch')).toEqual({
      id: 'feedMatch',
      points: 5,
      max: 10,
    });
    expect(read.feed).toEqual([differs]);
    expect(run({ compared: 0, mismatches: [] }).checks.some((c) => c.id === 'feedMatch')).toBe(
      false,
    );
    expect(run(null).checks.some((c) => c.id === 'feedMatch')).toBe(false);
    expect(run(null).feed).toEqual([]);
  });
});

describe('trust: a category page’s intro facts (Phase 3, CE-054)', () => {
  it('counts the share the person confirmed, and is left out where the intro states none', () => {
    const run = (intro: { total: number; confirmed: number } | null) =>
      trust({
        blocks: trustBlocks('<p>Choose from 120+ daypacks.</p>'),
        links: new Map(),
        brandDomains: ['acme.com'],
        intro,
        now: Date.parse('2026-10-25'),
      });
    expect(run({ total: 2, confirmed: 1 }).checks.find((c) => c.id === 'introFacts')).toEqual({
      id: 'introFacts',
      points: 5,
      max: 10,
    });
    // Trust's own: scored from it alone.
    expect(run({ total: 1, confirmed: 1 }).score).toBe(100);
    expect(run({ total: 0, confirmed: 0 }).checks.some((c) => c.id === 'introFacts')).toBe(false);
    expect(run(null).score).toBeNull();
  });
});

describe('eeat: customer cases (Phase 3, CE-052)', () => {
  it('counts the share confirmed publishable, and none where the page has no case', () => {
    const check = (cases: { total: number; confirmed: number } | null) =>
      eeat({ author: null, cases }).checks.find((c) => c.id === 'customerCase');
    expect(check({ total: 2, confirmed: 1 })).toEqual({ id: 'customerCase', points: 5, max: 10 });
    expect(check({ total: 0, confirmed: 0 })).toBeUndefined();
    expect(check(null)).toBeUndefined();
  });
});
