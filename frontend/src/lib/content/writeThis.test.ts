import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentOpportunity } from '@/types';
import { writeThisPrompts, writeThisStart } from './writeThis';

const opp = (over: Partial<ContentOpportunity> = {}) =>
  ({
    id: 'o1',
    title: 'Compare office coffee subscriptions for 2025',
    decision: 'create',
    sourceData: {},
    ...over,
  }) as ContentOpportunity;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('writeThisStart', () => {
  it('starts a new page with the brief’s title, else the opportunity’s, this year’s', () => {
    expect(writeThisStart(opp(), 'b2b')).toMatchObject({
      method: 'create',
      title: 'Compare office coffee subscriptions for 2026',
      page: null,
    });
    expect(
      writeThisStart(
        opp({ brief: { suggestedTitle: '  Office coffee for teams  ' } as never }),
        'b2b',
      ).title,
    ).toBe('Office coffee for teams');
  });

  it('takes the page type the opportunity names, else the one its title reads as', () => {
    expect(
      writeThisStart(opp({ sourceData: { assets: [{ type: 'comparison_page' }] } as never }), 'b2b')
        .pageType,
    ).toBe('comparison');
    // A type this kind of site doesn't write: Start's own pick.
    expect(writeThisStart(opp({ title: 'Why teams drink better coffee' }), 'b2b').pageType).toBe(
      'blog_post',
    );
  });

  it('works on the existing page an opportunity names, with its title and type', () => {
    const start = writeThisStart(
      opp({
        decision: 'refresh',
        sourceData: {
          assets: [{ type: 'comparison_page' }],
          targetPages: [{ url: 'https://acme.example/blog/espresso-tips', title: null }],
        } as never,
      }),
      'b2b',
    );
    expect(start).toMatchObject({
      method: 'optimize',
      title: '/blog/espresso-tips',
      page: { url: 'https://acme.example/blog/espresso-tips', title: null },
    });
    // Its address says a blog post; one that says nothing keeps the opportunity's.
    expect(start.pageType).toBe('blog_post');
    expect(
      writeThisStart(
        opp({
          decision: 'refresh',
          sourceData: {
            assets: [{ type: 'comparison_page' }],
            targetPages: [{ url: 'https://acme.example/x', title: 'Ours' }],
          } as never,
        }),
        'b2b',
      ),
    ).toMatchObject({ title: 'Ours', pageType: 'comparison' });
  });
});

describe('writeThisPrompts', () => {
  it('counts a group’s prompts, one for a single prompt, and none it can’t say', () => {
    expect(
      writeThisPrompts({ clusterId: 'c1', sourceData: { prompts: [{}, {}, {}] } as never }),
    ).toBe(3);
    expect(writeThisPrompts({ clusterId: null, sourceData: {} as never })).toBe(1);
    expect(writeThisPrompts({ clusterId: 'c1', sourceData: {} as never })).toBeNull();
    expect(
      writeThisPrompts({ clusterId: null, sourceData: { fromAction: { actionNo: 4 } } as never }),
    ).toBeNull();
  });
});
