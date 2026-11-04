import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibilityScore';
import { parseChangeDrivers, whyChanged, type ChangeDriversPayload } from './insightsDrivers';

const sums = (answers: number, mentions: number) => ({
  answers,
  mentionAnswers: mentions,
  citationAnswers: 0,
  sumInvPosition: 0,
  positionCount: 0,
});

const engine = (model: string, win: 'cur' | 'prev', answers: number, mentions: number) => ({
  modelUsed: model,
  platform: null,
  win,
  sums: sums(answers, mentions),
});

const prompt = (id: string, win: 'cur' | 'prev', answers: number, mentions: number) => ({
  promptId: id,
  win,
  sums: sums(answers, mentions),
});

const payload = (p: Partial<ChangeDriversPayload>): ChangeDriversPayload => ({
  prompts: [],
  engines: [],
  promptInfo: [],
  newPrompts: { count: 0, firstAdded: null, lastAdded: null },
  ...p,
});

// Model slugs fold into platform names, as resolveProvider does.
const platformOf = (model: string | null) =>
  model?.startsWith('gpt-') ? 'ChatGPT' : model?.startsWith('gemini') ? 'Gemini' : 'Other';

const same = { samePrompts: true };

const score = (answers: number, mentions: number) =>
  computeAiVisibilityScore({
    answers,
    mentionAnswers: mentions,
    citationAnswers: 0,
    positionFactor: null,
  })!;

describe('parseChangeDrivers', () => {
  it('reads the RPC payload and refuses rollups not yet backfilled', () => {
    const parsed = parseChangeDrivers({
      complete: true,
      prompts: [{ prompt_id: 'p1', win: 'prev', answers: '4', mention_answers: 2 }],
      engines: [{ model_used: 'gpt-4o', platform: null, win: 'cur', answers: 3 }],
      prompt_info: [{ id: 'p1', text: 'best crm', topic_id: 't1', topic_name: 'CRM' }],
      new_prompts: { count: 6, first_added: '2026-10-12T19:28:41Z', last_added: null },
    });

    expect(parsed?.prompts[0]).toEqual({ promptId: 'p1', win: 'prev', sums: sums(4, 2) });
    expect(parsed?.engines[0]).toMatchObject({ modelUsed: 'gpt-4o', platform: null, win: 'cur' });
    expect(parsed?.promptInfo[0]).toEqual({
      id: 'p1',
      text: 'best crm',
      topicId: 't1',
      topicName: 'CRM',
    });
    expect(parsed?.newPrompts).toEqual({
      count: 6,
      firstAdded: '2026-10-12T19:28:41Z',
      lastAdded: null,
    });
    expect(parseChangeDrivers({ complete: false })).toBeNull();
  });
});

describe('whyChanged', () => {
  it('credits the one platform that moved with the whole change', () => {
    const result = whyChanged(
      payload({
        engines: [
          engine('gpt-4o', 'cur', 100, 60),
          engine('gpt-4o', 'prev', 100, 30),
          engine('gemini-2.5-pro', 'cur', 100, 40),
          engine('gemini-2.5-pro', 'prev', 100, 40),
        ],
      }),
      platformOf,
      same,
    );

    const change = Math.round((score(200, 100) - score(200, 70)) * 10) / 10;
    expect(result.status).toBe('ok');
    expect(result.gains).toEqual([
      {
        kind: 'platform',
        id: 'ChatGPT',
        name: 'ChatGPT',
        prev: Math.round(score(100, 30) * 10) / 10,
        cur: Math.round(score(100, 60) * 10) / 10,
        // Each score's sample size, for a Low sample mark on the row (VIS-005).
        answers: { prev: 100, cur: 100 },
        impact: change,
      },
    ]);
    expect(result.drops).toEqual([]);
  });

  it('weighs a slice by its answers, so a small swing ranks below a big one', () => {
    const result = whyChanged(
      payload({
        prompts: [
          prompt('big', 'cur', 90, 50),
          prompt('big', 'prev', 90, 30),
          prompt('small', 'cur', 10, 10),
          prompt('small', 'prev', 10, 0),
        ],
        engines: [engine('gpt-4o', 'cur', 100, 60), engine('gpt-4o', 'prev', 100, 30)],
        promptInfo: [
          { id: 'big', text: 'Big prompt', topicId: 't1', topicName: 'Topic' },
          { id: 'small', text: 'Small prompt', topicId: 't1', topicName: 'Topic' },
        ],
      }),
      platformOf,
      { samePrompts: true, limit: 5 },
    );

    const prompts = result.gains.filter((d) => d.kind === 'prompt');
    expect(prompts.map((d) => d.id)).toEqual(['big', 'small']);
    // The small prompt went 0 → 100 on its own but moved the total less.
    expect(prompts[1].cur - prompts[1].prev).toBeGreaterThan(prompts[0].cur - prompts[0].prev);
    expect(prompts[1].impact).toBeLessThan(prompts[0].impact);
    // Its topic carries both prompts.
    expect(result.gains.find((d) => d.kind === 'topic')).toMatchObject({ id: 't1', name: 'Topic' });
  });

  it('lists gains and drops apart, largest first, up to the limit', () => {
    const result = whyChanged(
      payload({
        prompts: [
          prompt('a', 'cur', 50, 40),
          prompt('a', 'prev', 50, 10),
          prompt('b', 'cur', 50, 5),
          prompt('b', 'prev', 50, 20),
          prompt('c', 'cur', 50, 25),
          prompt('c', 'prev', 50, 20),
        ],
        engines: [engine('gpt-4o', 'cur', 150, 70), engine('gpt-4o', 'prev', 150, 50)],
        promptInfo: [],
      }),
      platformOf,
      { samePrompts: true, limit: 1 },
    );

    expect(result.gains).toHaveLength(1);
    expect(result.gains[0]).toMatchObject({ kind: 'prompt', id: 'a', name: null });
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]).toMatchObject({ kind: 'prompt', id: 'b' });
    expect(result.drops[0].impact).toBeLessThan(0);
  });

  it('credits nothing to a slice whose answers grew at the same rates', () => {
    const result = whyChanged(
      payload({
        engines: [
          engine('gpt-4o', 'cur', 100, 50),
          engine('gpt-4o', 'prev', 50, 25),
          engine('gemini-2.5-pro', 'cur', 50, 10),
          engine('gemini-2.5-pro', 'prev', 50, 10),
        ],
      }),
      platformOf,
      same,
    );

    // The overall score rose with ChatGPT's larger share, but neither
    // platform did better or worse than before.
    expect(result.status).toBe('ok');
    expect(result.gains).toEqual([]);
    expect(result.drops).toEqual([]);
  });

  it('skips a slice answered in only one window', () => {
    const result = whyChanged(
      payload({
        engines: [
          engine('gpt-4o', 'cur', 50, 30),
          engine('gpt-4o', 'prev', 50, 30),
          engine('gemini-2.5-pro', 'cur', 30, 30),
        ],
      }),
      platformOf,
      same,
    );

    expect([...result.gains, ...result.drops].map((d) => d.id)).not.toContain('Gemini');
  });

  it('explains nothing on fewer than 20 compared answers in a window', () => {
    const result = whyChanged(
      payload({
        engines: [engine('gpt-4o', 'cur', 2, 2), engine('gpt-4o', 'prev', 16, 4)],
        newPrompts: { count: 6, firstAdded: null, lastAdded: null },
      }),
      platformOf,
      same,
    );

    expect(result).toEqual({
      status: 'lowSample',
      answers: { cur: 2, prev: 16 },
      samePrompts: true,
      gains: [],
      drops: [],
      newPrompts: { count: 6, firstAdded: null, lastAdded: null },
    });
  });
});
