import { describe, expect, it } from 'vitest';
import { parseCompetitorFindings } from './competitorFindings';

/** What Analyze competitor content stored (learning C1), read defensively. */
describe('parseCompetitorFindings', () => {
  it('reads the pages, the brand page and the gaps', () => {
    expect(
      parseCompetitorFindings({
        competitorPages: [
          {
            url: 'https://rival.com/kettles',
            domain: 'rival.com',
            cited: 4,
            words: 1200,
            passes: ['faq-schema', 3],
          },
          { url: 'javascript:alert(1)', cited: 1 },
        ],
        yourPage: { url: 'https://acme.com/kettles', cited: 1, words: null, passes: [] },
        gaps: [
          { key: 'faq-schema', label: 'FAQ schema', competitors: 2, of: 3 },
          { key: 'tables', competitors: 1, of: 0 },
        ],
        yourPageStatus: 'read',
        compared: true,
        unreadable: 0,
      }),
    ).toEqual({
      competitorPages: [
        {
          url: 'https://rival.com/kettles',
          domain: 'rival.com',
          cited: 4,
          words: 1200,
          passes: ['faq-schema'],
        },
      ],
      yourPage: {
        url: 'https://acme.com/kettles',
        domain: null,
        cited: 1,
        words: null,
        passes: [],
      },
      yourPageStatus: 'read',
      gaps: [{ key: 'faq-schema', label: 'FAQ schema', competitors: 2, of: 3 }],
      compared: true,
      unreadable: 0,
      reason: null,
    });
  });

  it("reads whether the brand's page was read and whether theirs were compared", () => {
    const base = { competitorPages: [], yourPage: null, gaps: [] };
    expect(
      parseCompetitorFindings({ ...base, yourPageStatus: 'unreadable', compared: false }),
    ).toMatchObject({ yourPageStatus: 'unreadable', compared: false });
    // Not cited unless it says it couldn't be read; compared unless it says not.
    expect(parseCompetitorFindings({ ...base, yourPageStatus: 'odd' })).toMatchObject({
      yourPageStatus: 'not_cited',
      compared: true,
    });
  });

  it("reads why nothing was compared, and nothing from another tool's output", () => {
    expect(
      parseCompetitorFindings({
        competitorPages: [],
        yourPage: null,
        gaps: [],
        reason: 'none_cited',
      })?.reason,
    ).toBe('none_cited');
    expect(parseCompetitorFindings({ answers: 100 })).toBeNull();
    expect(parseCompetitorFindings(null)).toBeNull();
  });
});
