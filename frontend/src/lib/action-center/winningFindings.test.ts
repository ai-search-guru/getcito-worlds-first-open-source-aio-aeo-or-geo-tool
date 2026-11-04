import { describe, expect, it } from 'vitest';
import { parseWinningFindings } from './winningFindings';

/** What "Find what sets your winning pages apart" stored (learning C4), read defensively. */
describe('parseWinningFindings', () => {
  it('reads the winning pages, the patterns and the pages missing them', () => {
    expect(
      parseWinningFindings({
        winningPages: [
          { url: 'https://acme.com/kettles', source: 'audit', words: null, passes: ['tables', 3] },
          { url: 'javascript:alert(1)', source: 'read' },
          { url: 'https://acme.com/guide', source: 'read', words: 1400, passes: [] },
        ],
        others: 12,
        patterns: [
          {
            key: 'faq-schema',
            label: 'FAQ schema',
            winners: 2,
            ofWinners: 2,
            others: 1,
            ofOthers: 12,
          },
          { key: 'tables', winners: 1, ofWinners: 2, others: 0, ofOthers: 0 },
          { label: 'no key', winners: 1, ofWinners: 1, others: 0, ofOthers: 3 },
        ],
        missingPages: [
          { url: 'https://acme.com/tea', missing: ['faq-schema'] },
          { url: 'https://acme.com/cups', missing: [] },
        ],
        unreadable: 1,
        reason: null,
      }),
    ).toEqual({
      winningPages: [
        { url: 'https://acme.com/kettles', source: 'audit', words: null, passes: ['tables'] },
        { url: 'https://acme.com/guide', source: 'read', words: 1400, passes: [] },
      ],
      others: 12,
      patterns: [
        {
          key: 'faq-schema',
          label: 'FAQ schema',
          winners: 2,
          ofWinners: 2,
          others: 1,
          ofOthers: 12,
        },
      ],
      missingPages: [{ url: 'https://acme.com/tea', missing: ['faq-schema'] }],
      unreadable: 1,
      reason: null,
    });
  });

  it('keeps why nothing was compared, and nothing it does not know', () => {
    expect(
      parseWinningFindings({
        winningPages: [],
        patterns: [],
        others: 2,
        reason: 'too_few_audited',
      }),
    ).toMatchObject({ others: 2, reason: 'too_few_audited', missingPages: [] });
    expect(parseWinningFindings({ winningPages: [], patterns: [], reason: 'other' })?.reason).toBe(
      null,
    );
  });

  it("isn't this task's output otherwise", () => {
    expect(parseWinningFindings(null)).toBeNull();
    expect(parseWinningFindings({ competitorPages: [], gaps: [] })).toBeNull();
  });
});
