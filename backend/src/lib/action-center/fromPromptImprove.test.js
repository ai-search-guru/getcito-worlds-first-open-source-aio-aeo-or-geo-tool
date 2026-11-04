import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
const { tables, errors, reads } = vi.hoisted(() => ({ tables: {}, errors: {}, reads: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    // A read of one table, its filters, order and limit recorded, its rows
    // as given, or its error.
    from: (table) => {
      const filters = [];
      reads.push({ table, filters });
      const chain = {
        select: () => chain,
        eq: (column, value) => (filters.push(['eq', column, value]), chain),
        neq: (column, value) => (filters.push(['neq', column, value]), chain),
        in: (column, value) => (filters.push(['in', column, value]), chain),
        is: (column, value) => (filters.push(['is', column, value]), chain),
        order: (column, options) => (filters.push(['order', column, options]), chain),
        limit: (count) => (filters.push(['limit', count]), chain),
        then: (resolve) =>
          resolve(
            errors[table]
              ? { data: null, error: errors[table] }
              : { data: tables[table] ?? [], error: null },
          ),
      };
      return chain;
    },
  },
}));

const {
  IMPROVE_PAST_ROUNDS,
  IMPROVE_ROUND_TASKS,
  improveBaseline,
  improveRound,
  loadImproveRounds,
  improveGoal,
  improveImpact,
  improveKpiKeys,
  improvePages,
  improveTaskRows,
  improveWhy,
  volumeTier,
} = await import('./fromPromptImprove.js');

const P = (id, state, extra = {}) => ({ id, state, ...extra });

describe('volumeTier', () => {
  it('splits estimated monthly AI searches at 100 and 1,000', () => {
    expect(volumeTier(null)).toBe(0);
    expect(volumeTier(99)).toBe(0);
    expect(volumeTier(100)).toBe(1);
    expect(volumeTier(999)).toBe(1);
    expect(volumeTier(1000)).toBe(2);
  });
});

describe('improveImpact', () => {
  it('is high with demand and a real gap', () => {
    expect(improveImpact([P('chatgpt-web', 'not_mentioned')], 5000)).toBe('high');
    expect(
      improveImpact([P('perplexity-web', 'not_mentioned'), P('google-aio', 'not_cited')], 300),
    ).toBe('high');
  });

  it('is low for a small gap without high demand', () => {
    expect(improveImpact([P('google-aio', 'not_cited')], 50)).toBe('low');
    expect(improveImpact([P('google-aio', 'not_cited')], null)).toBe('low');
  });

  it('is medium otherwise', () => {
    expect(improveImpact([P('chatgpt-web', 'mentioned_late')], 300)).toBe('medium');
    expect(improveImpact([P('chatgpt-web', 'not_mentioned')], null)).toBe('medium');
    expect(improveImpact([P('google-aio', 'not_cited')], 2000)).toBe('medium');
  });
});

describe('improveWhy / improveGoal', () => {
  const platforms = [
    P('perplexity-web', 'not_mentioned'),
    P('gemini-web', 'not_mentioned'),
    P('chatgpt-web', 'mentioned_late', { mentionPosition: 3.4 }),
    P('google-aio', 'not_cited'),
  ];

  it('describes each platform state in one sentence', () => {
    expect(improveWhy(platforms)).toBe(
      'Not mentioned on Perplexity and Gemini; mentioned late (avg #3.4) on ChatGPT; mentioned early but not cited on Google AI Overviews.',
    );
  });

  it('starts with a capital when the brand is mentioned everywhere', () => {
    expect(improveWhy([P('google-aio', 'not_cited')])).toBe(
      'Mentioned early but not cited on Google AI Overviews.',
    );
  });

  it('names the prompt and the platforms in the goal', () => {
    expect(improveGoal('best coffee', platforms.slice(0, 2))).toBe(
      'Get the brand mentioned early and cited for "best coffee" on Perplexity and Gemini.',
    );
  });
});

describe('improveBaseline', () => {
  it('keeps the 7-day read per platform at send time, with its window', () => {
    const window = { from: '2026-10-06T10:00:00.000Z', to: '2026-10-13T10:00:00.000Z' };
    const snapshot = {
      platform: 'chatgpt-web',
      state: 'mentioned_late',
      runs: 8,
      mentionedRuns: 8,
      citedRuns: 0,
      mentionPosition: 3.4,
      citationRank: null,
    };
    expect(improveBaseline([snapshot], '2026-10-13T10:00:00.000Z', window)).toEqual({
      capturedAt: '2026-10-13T10:00:00.000Z',
      window,
      platforms: [snapshot],
    });
  });
});

describe('improveTaskRows', () => {
  it('makes one human task per suggestion with its text exactly as edited', () => {
    const rows = improveTaskRows('a1', [
      {
        id: 'perplexity-web:0',
        platform: 'perplexity-web',
        title: 'Edited title',
        body: 'Edited body',
        sources: [{ type: 'fanout', ref: 'q' }],
      },
      { id: 'own:1', platform: 'chatgpt-web', title: 'My own idea', body: '', sources: [] },
    ]);
    expect(rows).toEqual([
      {
        action_id: 'a1',
        position: 1,
        task_key: null,
        title: 'Edited title',
        status: 'todo',
        mode: 'human',
        permission: 'read',
        details: {
          body: 'Edited body',
          platform: 'perplexity-web',
          platformLabel: 'Perplexity',
          sources: [{ type: 'fanout', ref: 'q' }],
        },
      },
      expect.objectContaining({
        position: 2,
        title: 'My own idea',
        details: { body: '', platform: 'chatgpt-web', platformLabel: 'ChatGPT', sources: [] },
      }),
    ]);
  });
});

describe('improvePages', () => {
  it('collects the brand pages the suggestions name, once each', () => {
    const suggestions = [
      {
        sources: [
          { type: 'brand_page', ref: 'https://acme.com/plans' },
          { type: 'fanout', ref: 'best coffee subscription' },
        ],
      },
      { sources: [{ type: 'brand_page', ref: 'https://acme.com/plans' }] },
      { sources: [{ type: 'competitor_url', ref: 'https://rival.com/x' }] },
      {},
    ];
    expect(improvePages(suggestions)).toEqual(['https://acme.com/plans']);
  });
});

describe('improveKpiKeys', () => {
  it('measures citations only when the action names brand pages', () => {
    expect(improveKpiKeys(['https://acme.com/plans'])).toContain('citations');
    expect(improveKpiKeys([])).toEqual(['ai_visibility', 'mentions']);
  });
});

/**
 * Earlier Improve rounds on a prompt (learning B5): what the next
 * generation is told each one did, and how its platforms moved.
 */
describe('improveRound', () => {
  const now = new Date('2026-10-28T09:00:00Z');

  it('reads how its platforms moved and which suggestions were done', () => {
    expect(
      improveRound(
        {
          created_at: '2026-09-10T08:00:00Z',
          status: 'completed',
          position_outcome: {
            measuredAt: '2026-10-20T03:00:00Z',
            final: true,
            platforms: [
              { platform: 'chatgpt-web', verdict: 'improved' },
              { platform: 'gemini-web', verdict: 'unchanged' },
            ],
          },
        },
        [
          {
            title: 'Add a table to /pricing',
            status: 'completed',
            details: { platform: 'chatgpt-web' },
          },
          { title: 'Pitch seriouseats.com', status: 'todo', details: { platform: 'gemini-web' } },
          { title: 'Add an FAQ', status: 'skipped', details: { platform: 'gemini-web' } },
          { title: 'Run it again', status: 'failed', details: { platform: 'gemini-web' } },
          { title: ' ', status: 'todo', details: null },
        ],
        now,
      ),
    ).toEqual({
      sent: '2026-09-10',
      daysAgo: 48,
      open: false,
      final: true,
      platforms: [
        { id: 'chatgpt-web', verdict: 'improved' },
        { id: 'gemini-web', verdict: 'unchanged' },
      ],
      suggestions: [
        { platform: 'chatgpt-web', title: 'Add a table to /pricing', status: 'done' },
        { platform: 'gemini-web', title: 'Pitch seriouseats.com', status: 'not_done' },
        // Skipped is the team's call, told apart; a failed run is not done.
        { platform: 'gemini-web', title: 'Add an FAQ', status: 'skipped' },
        { platform: 'gemini-web', title: 'Run it again', status: 'not_done' },
      ],
    });
  });

  it('reads an open round with no read yet', () => {
    expect(improveRound({ status: 'in_progress', position_outcome: null }, [], now)).toEqual({
      sent: null,
      daysAgo: null,
      open: true,
      final: false,
      platforms: [],
      suggestions: [],
    });
  });

  /**
   * Its first read is the baseline itself, and for 7 days the read's days
   * overlap the baseline's: every platform reads "unchanged" whatever the
   * suggestions do, so the round is too early to read, not a failure.
   */
  it('reads a round whose read is still within 7 days of the send as too early', () => {
    const sentToday = {
      created_at: '2026-10-28T08:00:00Z',
      status: 'new',
      position_outcome: {
        measuredAt: '2026-10-28T08:00:00Z',
        final: false,
        platforms: [{ platform: 'gemini-web', verdict: 'unchanged' }],
      },
    };
    expect(improveRound(sentToday, [], now)).toMatchObject({
      sent: '2026-10-28',
      daysAgo: 0,
      platforms: [{ id: 'gemini-web', verdict: 'too_early' }],
    });
    const sixDaysIn = {
      ...sentToday,
      created_at: '2026-10-21T08:00:00Z',
      position_outcome: { ...sentToday.position_outcome, measuredAt: '2026-10-27T20:00:00Z' },
    };
    expect(improveRound(sixDaysIn, [], now)).toMatchObject({
      daysAgo: 7,
      platforms: [{ id: 'gemini-web', verdict: 'too_early' }],
    });
    // A full window after the send, the read is the platform's own.
    const weekIn = {
      ...sixDaysIn,
      position_outcome: { ...sixDaysIn.position_outcome, measuredAt: '2026-10-28T08:00:00Z' },
    };
    expect(improveRound(weekIn, [], now).platforms).toEqual([
      { id: 'gemini-web', verdict: 'unchanged' },
    ]);
  });
});

describe('improveRound suggestions', () => {
  it('keeps the first 12 suggestions, in task order, each title on one line', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      title: i === 0 ? 'Add a table\n  to /pricing\r\n' : `Task ${i + 1}`,
      status: 'todo',
      details: null,
    }));
    const { suggestions } = improveRound({ status: 'new' }, tasks);
    expect(IMPROVE_ROUND_TASKS).toBe(12);
    expect(suggestions).toHaveLength(12);
    expect(suggestions[0].title).toBe('Add a table to /pricing');
    expect(suggestions.at(-1).title).toBe('Task 12');
  });
});

describe('loadImproveRounds', () => {
  beforeEach(() => {
    reads.length = 0;
    for (const table of Object.keys(errors)) delete errors[table];
  });

  it("reads the brand's own last two rounds on the prompt, newest first, not dismissed, with their suggestions", async () => {
    // As the read returns them: newest first.
    tables.actions = [
      { id: 'a2', status: 'in_progress', created_at: '2026-10-01T08:00:00Z' },
      { id: 'a1', status: 'completed', created_at: '2026-09-10T08:00:00Z' },
    ];
    tables.action_tasks = [
      { action_id: 'a1', title: 'Add a table to /pricing', status: 'completed', details: {} },
      { action_id: 'a2', title: 'Pitch seriouseats.com', status: 'todo', details: {} },
      { action_id: 'other', title: 'Not this round', status: 'completed', details: {} },
    ];

    const rounds = await loadImproveRounds({ promptId: 'p1', brandId: 'b1' });

    expect(IMPROVE_PAST_ROUNDS).toBe(2);
    expect(reads[0]).toEqual({
      table: 'actions',
      filters: [
        ['eq', 'brand_id', 'b1'],
        ['eq', 'kind', 'prompt_improve'],
        ['eq', 'payload->>promptId', 'p1'],
        ['is', 'payload->>region', null],
        ['neq', 'status', 'dismissed'],
        ['is', 'deleted_at', null],
        ['order', 'created_at', { ascending: false }],
        ['limit', 2],
      ],
    });
    // The tasks of those rounds only, in their order on the action.
    expect(reads[1]).toEqual({
      table: 'action_tasks',
      filters: [
        ['in', 'action_id', ['a2', 'a1']],
        ['order', 'position', undefined],
      ],
    });
    expect(rounds.map((round) => [round.sent, round.suggestions.map((s) => s.title)])).toEqual([
      ['2026-10-01', ['Pitch seriouseats.com']],
      ['2026-09-10', ['Add a table to /pricing']],
    ]);
  });

  it('fails with what could not be read, for the route to write without it', async () => {
    errors.actions = { message: 'timeout' };
    await expect(loadImproveRounds({ promptId: 'p1', brandId: 'b1' })).rejects.toThrow(
      'earlier Improve rounds read failed: timeout',
    );

    delete errors.actions;
    tables.actions = [{ id: 'a1', status: 'completed', created_at: '2026-09-10T08:00:00Z' }];
    errors.action_tasks = { message: 'permission denied' };
    await expect(loadImproveRounds({ promptId: 'p1', brandId: 'b1' })).rejects.toThrow(
      "earlier Improve rounds' tasks read failed: permission denied",
    );
  });

  /**
   * An Improve set is kept per region, and the action keeps the region of
   * the set it was sent from: a US set reads the US rounds, the all-regions
   * set the rounds sent without one ('' and null alike).
   */
  it("reads only the rounds sent for the set's region", async () => {
    tables.actions = [];
    reads.length = 0;
    await loadImproveRounds({ promptId: 'p1', brandId: 'b1', region: 'US' });
    expect(reads[0].filters).toContainEqual(['eq', 'payload->>region', 'US']);
    expect(reads[0].filters).not.toContainEqual(['is', 'payload->>region', null]);

    for (const region of ['', null, undefined]) {
      reads.length = 0;
      await loadImproveRounds({ promptId: 'p1', brandId: 'b1', region });
      expect(reads[0].filters).toContainEqual(['is', 'payload->>region', null]);
      expect(
        reads[0].filters.some(([op, column]) => op === 'eq' && column === 'payload->>region'),
      ).toBe(false);
    }
  });

  it('reads no tasks when there is no earlier round', async () => {
    reads.length = 0;
    tables.actions = [];
    expect(await loadImproveRounds({ promptId: 'p1', brandId: 'b1' })).toEqual([]);
    expect(reads.map((read) => read.table)).toEqual(['actions']);
  });
});
