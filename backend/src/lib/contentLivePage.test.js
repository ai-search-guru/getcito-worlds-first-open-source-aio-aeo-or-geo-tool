import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../config/supabase.js', () => ({ default: { rpc: (...args) => rpc(...args) } }));

const { LOST_PROMPT_CHARS, livePageLine, livePageSummary, readLivePage } =
  await import('./contentLivePage.js');

/**
 * How the live page does now, as the Content Agent is told (learning B5):
 * what it earns as it reads, and the prompts it lost.
 */
const impact = {
  citations: { cur: 12, prev: 20 },
  aiVisits: { cur: 35, prev: 40 },
  promptCounts: { cur: 4, prev: 6, lost: 2 },
  prompts: [
    { text: 'best pour over kettle', cur: 5, prev: 6 },
    { text: 'how long to brew pour over', cur: 0, prev: 2 },
    { text: 'pour over vs french press', cur: 0, prev: 4 },
  ],
};

describe('livePageSummary', () => {
  it('reads the numbers and the lost prompts, the most cited before first', () => {
    expect(livePageSummary(impact)).toEqual({
      days: 30,
      citations: { cur: 12, prev: 20 },
      prompts: { cur: 4, lost: 2 },
      lostPrompts: ['pour over vs french press', 'how long to brew pour over'],
      aiVisits: { cur: 35, prev: 40 },
    });
  });

  it('quotes a lost prompt on one line, cut when it is long', () => {
    const long = `pour over\n\n  kettle ${'x'.repeat(5000)}`;
    const { lostPrompts } = livePageSummary({
      ...impact,
      prompts: [{ text: long, cur: 0, prev: 3 }],
    });
    expect(LOST_PROMPT_CHARS).toBe(300);
    expect(lostPrompts).toHaveLength(1);
    expect(lostPrompts[0].startsWith('pour over kettle x')).toBe(true);
    expect(lostPrompts[0]).toHaveLength(LOST_PROMPT_CHARS + 1);
    expect(lostPrompts[0].endsWith('…')).toBe(true);
    expect(
      livePageLine(livePageSummary({ ...impact, prompts: [{ text: long, cur: 0, prev: 3 }] }))
        .length,
    ).toBeLessThan(1000);
  });

  it('tells nothing of a page neither cited nor visited from AI', () => {
    expect(
      livePageSummary({ citations: { cur: 0, prev: 0 }, aiVisits: { cur: 0, prev: 0 } }),
    ).toBeNull();
    expect(livePageSummary(null)).toBeNull();
  });
});

describe('readLivePage', () => {
  const BRAND = '33333333-3333-3333-3333-333333333333';
  const PAGE = 'https://acme.example/guide';

  it("reads the brand's page over the tab's 30 days, or the window it is given", async () => {
    rpc.mockReset().mockResolvedValue({ data: impact, error: null });
    expect(await readLivePage(BRAND, PAGE)).toMatchObject({
      days: 30,
      citations: { cur: 12, prev: 20 },
    });
    expect(rpc).toHaveBeenCalledWith('content_page_impact', {
      p_brand_id: BRAND,
      p_page: PAGE,
      p_days: 30,
    });
    expect(await readLivePage(BRAND, PAGE, 7)).toMatchObject({ days: 7 });
    expect(rpc).toHaveBeenLastCalledWith('content_page_impact', {
      p_brand_id: BRAND,
      p_page: PAGE,
      p_days: 7,
    });
  });

  it('names three lost prompts, the most cited before first', async () => {
    rpc.mockReset().mockResolvedValue({
      data: {
        ...impact,
        promptCounts: { cur: 1, prev: 5, lost: 4 },
        prompts: [
          { text: 'kept', cur: 3, prev: 1 },
          { text: 'lost 2', cur: 0, prev: 2 },
          { text: 'lost 9', cur: 0, prev: 9 },
          { text: 'lost 1', cur: 0, prev: 1 },
          { text: 'lost 5', cur: 0, prev: 5 },
          { text: 'new', cur: 2, prev: 0 },
        ],
      },
      error: null,
    });
    const summary = await readLivePage(BRAND, PAGE);
    expect(summary.lostPrompts).toEqual(['lost 9', 'lost 5', 'lost 2']);
    // The count is all it lost, past the three named.
    expect(summary.prompts.lost).toBe(4);
  });

  it('tells nothing without a page, or of a page neither cited nor visited', async () => {
    rpc.mockReset();
    expect(await readLivePage(BRAND, null)).toBeNull();
    expect(await readLivePage(BRAND, '')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({
      data: { citations: { cur: 0, prev: 0 }, aiVisits: { cur: 0, prev: 0 }, prompts: [] },
      error: null,
    });
    expect(await readLivePage(BRAND, PAGE)).toBeNull();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await readLivePage(BRAND, PAGE)).toBeNull();
  });

  it('throws when the read fails, for its caller to go on without it', async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'statement timeout' } });
    await expect(readLivePage(BRAND, PAGE)).rejects.toThrow(
      'live page read failed: statement timeout',
    );
  });
});

describe('livePageLine', () => {
  it('says what the page earns, and asks to keep it and answer what it lost', () => {
    const line = livePageLine(livePageSummary(impact));
    expect(line).toContain(
      'tracked AI answers cited it 12 times (20 before), for 4 prompts, and it had 35 AI visits (40 before). It lost 2 prompts it was cited for: "pour over vs french press", "how long to brew pour over".',
    );
    expect(line).toContain('keep the answers, facts and names AI engines may cite from it');
    expect(line).toContain("answer a lost prompt's question");
  });

  it('says one as one', () => {
    const line = livePageLine(
      livePageSummary({
        citations: { cur: 1, prev: 3 },
        aiVisits: { cur: 1, prev: 0 },
        promptCounts: { cur: 1, lost: 1 },
        prompts: [{ text: 'pour over vs french press', cur: 0, prev: 2 }],
      }),
    );
    expect(line).toContain(
      'tracked AI answers cited it 1 time (3 before), for 1 prompt, and it had 1 AI visit (0 before). It lost 1 prompt it was cited for: "pour over vs french press".',
    );
  });

  it('asks nothing about lost prompts when none was lost', () => {
    const line = livePageLine(
      livePageSummary({ ...impact, promptCounts: { cur: 1, lost: 0 }, prompts: [] }),
    );
    expect(line).toContain('for 1 prompt,');
    expect(line).not.toContain('lost');
    expect(livePageLine(null)).toBe('');
  });
});
