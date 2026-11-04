import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibilityScore';
import {
  buildBreakdownRows,
  parseBreakdownGroups,
  pickDriver,
  type BreakdownGroup,
  type BreakdownGroupsPayload,
  type BreakdownRow,
} from './insightsBreakdown';

const group = (
  prompt_id: string,
  platform: string,
  answers: number,
  mention_answers: number,
  citation_answers: number,
  mentions = mention_answers,
  position: [number, number] = [mention_answers * 0.5, mention_answers],
): BreakdownGroup => ({
  prompt_id,
  platform,
  answers,
  mention_answers,
  citation_answers,
  sum_inv_position: position[0],
  position_count: position[1],
  mentions,
});

const prompts = [
  { id: 'p1', text: 'best rank tracker', topic_id: 't1', topic_name: 'Rank tracking' },
  { id: 'p2', text: 'geo tools', topic_id: 't1', topic_name: 'Rank tracking' },
  { id: 'p3', text: 'aeo audit', topic_id: null, topic_name: null },
];

const cur: BreakdownGroupsPayload = {
  groups: [
    group('p1', 'chatgpt', 40, 10, 4),
    group('p1', 'gemini', 40, 30, 12),
    group('p2', 'chatgpt', 20, 0, 0, 0, [0, 0]),
    group('p3', 'gemini', 20, 8, 2),
  ],
  prompts,
};

const prev: BreakdownGroupsPayload = {
  groups: [group('p1', 'chatgpt', 40, 20, 8), group('p1', 'gemini', 40, 30, 12)],
  prompts,
};

const label = (slug: string) => ({ chatgpt: 'ChatGPT', gemini: 'Gemini' })[slug] ?? slug;

/** The card's formula over a set of groups, pooled like the rollups pool answers. */
function pooled(groups: BreakdownGroup[]): number {
  const s = groups.reduce(
    (acc, g) => ({
      answers: acc.answers + g.answers,
      mentionAnswers: acc.mentionAnswers + g.mention_answers,
      citationAnswers: acc.citationAnswers + g.citation_answers,
      inv: acc.inv + (g.sum_inv_position ?? 0),
      n: acc.n + g.position_count,
    }),
    { answers: 0, mentionAnswers: 0, citationAnswers: 0, inv: 0, n: 0 },
  );
  return (
    computeAiVisibilityScore({
      answers: s.answers,
      mentionAnswers: s.mentionAnswers,
      citationAnswers: s.citationAnswers,
      positionFactor: s.n > 0 ? s.inv / s.n : null,
    }) ?? 0
  );
}

describe('buildBreakdownRows', () => {
  it('scores each slice with the card formula over all of its answers', () => {
    const rows = buildBreakdownRows('visibility', cur, prev, label);

    const p1 = rows.byPrompt.find((r) => r.id === 'p1')!;
    expect(p1.cur).toBe(pooled(cur.groups.filter((g) => g.prompt_id === 'p1')));
    expect(p1.curRuns).toBe(80);

    const gemini = rows.byPlatform.find((r) => r.id === 'gemini')!;
    expect(gemini.label).toBe('Gemini');
    expect(gemini.cur).toBe(pooled(cur.groups.filter((g) => g.platform === 'gemini')));
  });

  it('groups prompts into their topics, and the rest into Uncategorized', () => {
    const rows = buildBreakdownRows('visibility', cur, prev, label);

    expect(rows.byTopic.map((r) => r.label).sort()).toEqual(['Rank tracking', 'Uncategorized']);
    const topic = rows.byTopic.find((r) => r.id === 't1')!;
    expect(topic.cur).toBe(pooled(cur.groups.filter((g) => g.prompt_id !== 'p3')));
    expect(rows.byPrompt.find((r) => r.id === 'p1')!.sublabel).toBe('Rank tracking');
  });

  it('measures the change against the previous window and sorts drops first', () => {
    const rows = buildBreakdownRows('visibility', cur, prev, label);

    const chatgpt = rows.byPlatform.find((r) => r.id === 'chatgpt')!;
    expect(chatgpt.prev).toBe(pooled(prev.groups.filter((g) => g.platform === 'chatgpt')));
    expect(chatgpt.delta).toBe(Math.round((chatgpt.cur - chatgpt.prev!) * 10) / 10);
    expect(rows.byPlatform[0].id).toBe('chatgpt');
    // A slice with no answers in the previous window counts as 0 there.
    expect(rows.byPrompt.find((r) => r.id === 'p3')!.prev).toBe(0);
  });

  it('carries no previous value or change without a previous window (All time)', () => {
    const rows = buildBreakdownRows('visibility', cur, null, label);

    for (const r of [...rows.byPrompt, ...rows.byPlatform, ...rows.byTopic]) {
      expect(r.prev).toBeNull();
      expect(r.delta).toBeNull();
    }
  });

  it('sums mentions and gives their percentage change', () => {
    const rows = buildBreakdownRows('mentions', cur, prev, label);

    const p1 = rows.byPrompt.find((r) => r.id === 'p1')!;
    expect(p1).toMatchObject({ cur: 40, prev: 50, delta: -10, deltaPct: -20 });
  });
});

describe('pickDriver', () => {
  const row = (id: string, delta: number | null, runs = { prev: 5, cur: 5 }): BreakdownRow => ({
    id,
    label: id,
    cur: 0,
    prev: delta === null ? null : 0,
    delta,
    deltaPct: null,
    curRuns: runs.cur,
    prevRuns: runs.prev,
  });

  it('picks the biggest drop when the total fell, and the biggest gain when it rose', () => {
    const rows = [row('a', -4), row('b', -1), row('c', 3)];

    expect(pickDriver(rows, -2)?.id).toBe('a');
    expect(pickDriver(rows, 2)?.id).toBe('c');
  });

  it('has no driver when nothing moved that way, or nothing to compare', () => {
    expect(pickDriver([row('a', -1)], 2)).toBeNull();
    expect(pickDriver([row('a', 5)], 0)).toBeNull();
    expect(pickDriver([row('a', null)], null)).toBeNull();
  });

  it('credits no row answered in only one window (VIS-005)', () => {
    // A prompt added this period "rising" from no answers isn't a gain.
    const rows = [row('new', 80, { prev: 0, cur: 4 }), row('gone', -60, { prev: 3, cur: 0 })];
    expect(pickDriver([...rows, row('kept', 2)], 1)?.id).toBe('kept');
    expect(pickDriver(rows, -1)).toBeNull();
  });
});

describe('parseBreakdownGroups', () => {
  it('reads the RPC payload, numeric strings and missing parts included', () => {
    const parsed = parseBreakdownGroups({
      groups: [
        {
          prompt_id: 'p1',
          platform: 'chatgpt',
          answers: '3',
          mention_answers: 1,
          citation_answers: 0,
          sum_inv_position: null,
          position_count: 0,
          mentions: 2,
        },
      ],
    });

    expect(parsed.groups[0]).toMatchObject({ answers: 3, sum_inv_position: null, mentions: 2 });
    expect(parsed.prompts).toEqual([]);
    expect(parseBreakdownGroups(null)).toEqual({ groups: [], prompts: [] });
  });
});

describe('buildBreakdownRows with Same prompts', () => {
  it('measures every row on the prompts answered in both windows', () => {
    const rows = buildBreakdownRows('visibility', cur, prev, label, { samePrompts: true });

    // p1 is the only prompt answered in both windows.
    expect(rows.byPrompt.map((r) => r.id)).toEqual(['p1']);
    const gemini = rows.byPlatform.find((r) => r.id === 'gemini')!;
    expect(gemini.cur).toBe(
      pooled(cur.groups.filter((g) => g.prompt_id === 'p1' && g.platform === 'gemini')),
    );
  });

  it('never reads a prompt added this period as a gain from 0', () => {
    const rows = buildBreakdownRows('visibility', cur, prev, label, { samePrompts: true });

    // p2 and p3 were only answered now: no row includes them.
    expect(rows.byPrompt.map((r) => r.id)).not.toContain('p3');
    expect(rows.byTopic.map((r) => r.id)).not.toContain('__uncategorized__');
    expect(
      [...rows.byPrompt, ...rows.byPlatform, ...rows.byTopic].map((r) => r.delta),
    ).not.toContain(pooled(cur.groups.filter((g) => g.prompt_id === 'p3')));
  });

  it('keeps the rows of earlier prompts unchanged when prompts are added', () => {
    const more: BreakdownGroupsPayload = {
      ...cur,
      groups: [...cur.groups, group('p9', 'gemini', 50, 50, 50)],
    };

    const before = buildBreakdownRows('visibility', cur, prev, label, { samePrompts: true });
    const after = buildBreakdownRows('visibility', more, prev, label, { samePrompts: true });
    expect(after.byPlatform).toEqual(before.byPlatform);
    expect(after.byPrompt).toEqual(before.byPrompt);
  });
});
