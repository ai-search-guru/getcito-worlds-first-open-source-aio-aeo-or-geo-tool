import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Quality's hand-off (CE-051): the page's fixable checks, in the server's words, as one run. */

const fixDraftRules = vi.fn();
vi.mock('./contentAgent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fixDraftRules: (...args) => fixDraftRules(...args),
}));
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { HANDOFF_CHECKS, handOffDraft, handOffInput } = await import('./contentHandoff.js');

beforeEach(() => {
  fixDraftRules.mockReset().mockResolvedValue({ count: 3, batchId: 'b1' });
});

describe('handOffInput', () => {
  it('takes the fixable checks by key, each with what it names, and who started it', () => {
    const parsed = handOffInput.parse({
      items: [{ key: 'trust:disclosure', detail: 'Disclosure: the product … is offered by Acme.' }],
      locked: [],
    });
    expect(parsed).toMatchObject({ origin: 'person', textRules: [] });
    // A to-do (the person's), or a key it doesn't know: refused.
    expect(handOffInput.safeParse({ items: [{ key: 'eeat:experience' }] }).success).toBe(false);
    expect(handOffInput.safeParse({ items: [] }).success).toBe(false);
    // Phase 3 (CE-052): the page type's own rules, as the Rules tab reads them.
    expect(
      handOffInput.safeParse({ items: [{ key: 'readability:typeRules', detail: 'Specs table' }] })
        .success,
    ).toBe(true);
    expect(HANDOFF_CHECKS['readability:typeRules']).toMatch(/never one made up/);
    // An answer too: fit, sizes, shipping, returns and prices only from the page and the data,
    // else asked of the person, the brand's own ("Your input needed").
    expect(HANDOFF_CHECKS['readability:typeRules']).toMatch(
      /an answer the page and your data don't give \(fit, sizes, shipping, returns, prices\) is \{\{ask: …\}\} too/,
    );
    // A figure with no source is looked up, never left as a placeholder.
    expect(HANDOFF_CHECKS['trust:claimsSourced']).toContain('{{find: …}}');
    expect(Object.values(HANDOFF_CHECKS).join(' ')).not.toContain('placeholder');
    expect(
      handOffInput.safeParse({ items: [{ key: 'readability:longSentences' }], origin: 'cron' })
        .success,
    ).toBe(false);
  });
});

describe('handOffDraft', () => {
  it('runs Fix open rules as a hand-off, the checks in its own words, each once', async () => {
    const input = handOffInput.parse({
      items: [
        { key: 'readability:longSentences', detail: '2 sentences over 35 words' },
        { key: 'trust:claimsSourced', detail: 'Teams save 40% of their time.' },
        { key: 'readability:longSentences', detail: 'again' },
      ],
      textRules: ['Say “we” for the brand'],
      locked: ['a locked passage'],
      origin: 'auto',
    });
    await expect(handOffDraft({ draftId: 'd1', brandId: 'b1', input })).resolves.toEqual({
      count: 3,
      batchId: 'b1',
    });
    expect(fixDraftRules).toHaveBeenCalledWith({
      draftId: 'd1',
      brandId: 'b1',
      input: {
        rules: [
          {
            key: 'readability:longSentences',
            name: HANDOFF_CHECKS['readability:longSentences'],
            detail: '2 sentences over 35 words',
          },
          {
            key: 'trust:claimsSourced',
            name: HANDOFF_CHECKS['trust:claimsSourced'],
            detail: 'Teams save 40% of their time.',
          },
        ],
        textRules: ['Say “we” for the brand'],
        locked: ['a locked passage'],
      },
      handoff: { origin: 'auto' },
    });
  });

  it('passes on a page over its Length, so its checks add as little as they need', async () => {
    const input = handOffInput.parse({
      items: [{ key: 'readability:longSentences', detail: '' }],
      overLength: { count: 17_683, max: 16_798 },
    });
    await handOffDraft({ draftId: 'd1', brandId: 'b1', input });
    expect(fixDraftRules.mock.calls.at(-1)[0].input.overLength).toEqual({
      count: 17_683,
      max: 16_798,
    });
    // A Length of 0 (at most 0): dropped, and the hand-off runs as before.
    const zero = handOffInput.parse({
      items: [{ key: 'readability:longSentences', detail: '' }],
      overLength: { count: 1_500, max: 0 },
    });
    expect(zero.overLength).toBeUndefined();
    await handOffDraft({ draftId: 'd1', brandId: 'b1', input: zero });
    expect(fixDraftRules.mock.calls.at(-1)[0].input).not.toHaveProperty('overLength');
  });
});
