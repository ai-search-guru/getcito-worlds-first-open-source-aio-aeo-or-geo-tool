import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the Content Agent may link (Content Agent rule gaps, A): the brand's
 * own pages, and the draft's sources without the brand's and competitors'
 * own or the ones the person left out.
 */

/** Table reads, and RPC answers (the sources RPC shares its name with the choices table). */
let reads;
let rpcs;
const calls = [];

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      calls.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        limit: async () => reads[table],
        then: (resolve) => resolve(reads[table]),
      };
      return chain;
    },
    rpc: async (name) => (calls.push(`rpc:${name}`), rpcs[name]),
  },
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn() } }));

const { linkAllowList, linkHref, linkKey, linkTargetsPrompt, readLinkTargets } =
  await import('./contentLinks.js');

const LINK_RULES = new Set(['internalLinks', 'outboundLinks']);

beforeEach(() => {
  calls.length = 0;
  reads = {
    site_pages: {
      data: [
        { url: 'https://acme.example/pricing', title: 'Pricing', h1: 'Plans' },
        { url: 'https://acme.example/guides/brew', title: null, h1: 'Brew guide' },
        { url: 'https://acme.example/guides/brew/', title: 'Duplicate', h1: null },
      ],
      error: null,
    },
    // The person's choices in the Sources tab.
    content_draft_sources: {
      data: [
        { ref: 'https://forum.example/thread', included: false, added: false },
        { ref: 'https://standards.example/spec', included: true, added: true },
      ],
      error: null,
    },
  };
  rpcs = {
    content_draft_sources: {
      data: {
        citedPages: [
          { url: 'https://research.example/study?utm_source=chatgpt.com', title: 'Coffee study' },
          { url: 'https://www.rival.example/compare', title: 'Rival compares' },
          { url: 'https://shop.other-rival.example/x', title: 'Other rival' },
          { url: 'https://blog.acme.example/post', title: 'Our blog' },
          { url: 'https://forum.example/thread', title: 'A thread' },
        ],
        brandDomains: ['acme.example'],
        // A competitor's domain may be written with a path.
        competitorDomains: ['rival.example', 'other-rival.example/en'],
      },
      error: null,
    },
  };
});

describe('linkKey', () => {
  it('compares links without www, tracking, a hash or a trailing slash', () => {
    expect(linkKey('https://WWW.Acme.example/Pricing/?utm_source=x&plan=pro#top')).toBe(
      'acme.example/Pricing?plan=pro',
    );
    expect(linkKey('https://acme.example/')).toBe('acme.example');
    expect(linkKey('mailto:hi@acme.example')).toBeNull();
    expect(linkKey('/pricing')).toBeNull();
    expect(linkHref('https://www.acme.example/a/?utm_source=chatgpt.com&plan=pro#top')).toBe(
      'https://www.acme.example/a/?plan=pro',
    );
  });

  it('reads long links in time near their size', () => {
    expect(linkKey('https://acme.example/a//b///')).toBe('acme.example/a//b');
    const slashes = `https://acme.example/${'/'.repeat(100_000)}a`;
    const page = Array.from(
      { length: 500 },
      (_, i) => `https://acme.example/${'/'.repeat(2_000)}${i}`,
    );
    const started = Date.now();
    expect(linkKey(slashes)).toBe(`acme.example/${'/'.repeat(100_000)}a`);
    for (const url of page) linkKey(url);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('readLinkTargets', () => {
  it("offers the brand's pages and the kept sources, never its own or a competitor's", async () => {
    const targets = await readLinkTargets({
      brandId: 'b1',
      draftId: 'd1',
      sourceUrl: 'https://acme.example/pricing',
      ruleKeys: LINK_RULES,
    });

    // The draft's own page and a duplicate left out; a title, else its H1.
    expect(targets.own).toEqual([{ url: 'https://acme.example/guides/brew', title: 'Brew guide' }]);
    // Tracking parameters off the link the page will keep.
    expect(targets.sources.map((s) => s.url)).toEqual([
      'https://research.example/study',
      'https://standards.example/spec',
    ]);
  });

  it('reads only the list the rules asked for need', async () => {
    const targets = await readLinkTargets({
      brandId: 'b1',
      draftId: 'd1',
      sourceUrl: null,
      ruleKeys: new Set(['internalLinks']),
    });
    expect(calls).toEqual(['site_pages']);
    expect(targets.sources).toEqual([]);
    expect(targets.own).toHaveLength(2);
  });

  it('reads nothing when no link rule is asked for', async () => {
    const targets = await readLinkTargets({
      brandId: 'b1',
      draftId: 'd1',
      sourceUrl: null,
      ruleKeys: new Set(['faq']),
    });
    expect(targets).toEqual({ own: [], sources: [] });
    expect(calls).toEqual([]);
  });

  it('leaves a list empty when its read fails', async () => {
    reads.site_pages = { data: null, error: { message: 'down' } };
    rpcs.content_draft_sources = { data: null, error: { message: 'down' } };
    const targets = await readLinkTargets({
      brandId: 'b1',
      draftId: 'd1',
      sourceUrl: null,
      ruleKeys: LINK_RULES,
    });
    expect(targets).toEqual({ own: [], sources: [] });
  });
});

describe('the targets as the model and the check read them', () => {
  const targets = {
    own: [{ url: 'https://acme.example/pricing', title: 'Pricing' }],
    sources: [{ url: 'https://research.example/study', title: 'Coffee study' }],
  };

  it('lists only what the rules asked for need', () => {
    expect(linkTargetsPrompt(targets, new Set(['internalLinks']))).toBe(
      "Pages on the brand's site you may link to (internal links):\n- Pricing — https://acme.example/pricing",
    );
    expect(linkTargetsPrompt(targets, new Set(['citeInline']))).toContain(
      '- Coffee study — https://research.example/study',
    );
    expect(linkTargetsPrompt(targets, new Set(['faq']))).toBe('');
  });

  it('allows each target by its key, giving back its URL', () => {
    const allow = linkAllowList(targets);
    expect(allow.get(linkKey('https://www.acme.example/pricing/'))).toBe(
      'https://acme.example/pricing',
    );
    expect(allow.get(linkKey('https://made-up.example/'))).toBeUndefined();
  });
});
