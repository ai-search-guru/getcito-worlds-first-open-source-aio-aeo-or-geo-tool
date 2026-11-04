import { describe, expect, it } from 'vitest';
import { inSourceScope, scopeDomainArgs } from './scope.js';
import type { SourceCategory } from './classify.js';

/**
 * Resolving a source scope to RPC arguments (#745).
 *
 * The whole point is that the query, not the result set, gets narrowed — the
 * URL list is capped at the top 2,000 by citation count, so a scope applied
 * afterwards reports a slice of the global top N as the whole scope. These
 * pin the two things that would quietly reintroduce that: sending nothing
 * when a scope covers nothing, and sending an include list where the exclude
 * list belongs.
 */

const row = (domain: string, category: SourceCategory) => ({ domain, category });

const rows = [
  row('mybrand.com', 'you'),
  row('blog.mybrand.com', 'you'),
  row('rival.com', 'competitor'),
  row('other-rival.com', 'competitor'),
  row('reddit.com', 'forum'),
  row('techcrunch.com', 'editorial'),
  row('randomsite.com', 'other'),
];

describe('scopeDomainArgs', () => {
  it('sends no scope at all for All', () => {
    expect(scopeDomainArgs('all', rows)).toEqual({});
    expect(scopeDomainArgs(undefined, rows)).toEqual({});
  });

  it('includes the brand-owned domains for Brand', () => {
    expect(scopeDomainArgs('own', rows)).toEqual({
      p_domains: ['mybrand.com', 'blog.mybrand.com'],
    });
  });

  it('includes the competitor domains for Competitors', () => {
    expect(scopeDomainArgs('competitors', rows)).toEqual({
      p_domains: ['rival.com', 'other-rival.com'],
    });
  });

  it('excludes rather than includes for Third-party', () => {
    // The set this scope covers is everything else — 17,532 domains on the
    // largest brand. Naming the four to leave out is the same statement in a
    // request that fits in a packet.
    expect(scopeDomainArgs('third_party', rows)).toEqual({
      p_exclude_domains: ['mybrand.com', 'blog.mybrand.com', 'rival.com', 'other-rival.com'],
    });
  });

  it('sends an empty include list when a scope covers nothing', () => {
    // A brand with no competitor ever cited must see an empty table, not
    // every URL in the window. The empty array is the instruction.
    const noRivals = rows.filter((r) => r.category !== 'competitor');
    expect(scopeDomainArgs('competitors', noRivals)).toEqual({ p_domains: [] });
  });

  it('omits the exclude list when there is nothing to exclude', () => {
    // The mirror image: with nothing to leave out, Third-party is the whole
    // set, and an empty array would be sent as a filter that matches nothing.
    const thirdPartyOnly = rows.filter((r) => r.category !== 'you' && r.category !== 'competitor');
    expect(scopeDomainArgs('third_party', thirdPartyOnly)).toEqual({});
  });

  it('treats every category that is neither ours nor a rival as third-party', () => {
    // forum / editorial / other are not enumerated anywhere in the resolver;
    // it decides by what a domain is *not*, so a new category added to
    // classifyDomain lands in Third-party without a change here.
    const args = scopeDomainArgs('third_party', rows);
    expect(args.p_exclude_domains).not.toContain('reddit.com');
    expect(args.p_exclude_domains).not.toContain('techcrunch.com');
    expect(args.p_exclude_domains).not.toContain('randomsite.com');
  });

  it('handles a window with no citations at all', () => {
    expect(scopeDomainArgs('own', [])).toEqual({ p_domains: [] });
    expect(scopeDomainArgs('third_party', [])).toEqual({});
  });
});

describe('inSourceScope', () => {
  it("keeps a scope's sources, and every source for All", () => {
    const inScope = (scope: Parameters<typeof inSourceScope>[1]) =>
      rows.filter((r) => inSourceScope(r.category, scope)).map((r) => r.domain);
    expect(inScope('own')).toEqual(['mybrand.com', 'blog.mybrand.com']);
    expect(inScope('competitors')).toEqual(['rival.com', 'other-rival.com']);
    expect(inScope('third_party')).toEqual(['reddit.com', 'techcrunch.com', 'randomsite.com']);
    expect(inScope('all')).toHaveLength(rows.length);
    expect(inScope(undefined)).toHaveLength(rows.length);
  });
});
