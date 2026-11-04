import { describe, expect, it } from 'vitest';
import {
  FOLD_TURNS,
  KEEP_TURNS,
  MESSAGE_CHARS,
  historyMessages,
  planHistory,
  type HistoryRow,
} from './history';

/**
 * What a run sends of the chat so far (W1-18; CHAT-04 items 5, 7 and 23):
 * recent turns as they were, older turns folded a few at a time into a short
 * summary that stays the same between folds, and a few lines for the reader.
 */

const chat = (turns: number, answer = (i: number) => `Answer ${i}.`): HistoryRow[] =>
  Array.from({ length: turns }, (_, i) => [
    { role: 'user' as const, content: `Question ${i}?` },
    { role: 'assistant' as const, content: answer(i) },
  ]).flat();

const BUDGET = 24_000;

describe('planHistory', () => {
  it('keeps a short chat as it was, starting with the person', () => {
    const plan = planHistory(
      [{ role: 'assistant', content: 'Hi!' }, ...chat(3), { role: 'user', content: '  ' }],
      BUDGET,
    );
    expect(plan.summary).toBeNull();
    expect(plan.folded).toBe(0);
    expect(plan.recent[0]).toEqual({ role: 'user', content: 'Question 0?' });
    expect(plan.recent).toHaveLength(6);
    expect(historyMessages(plan)).toBe(plan.recent);
  });

  it('folds older turns a few at a time, so the summary stays the same between folds', () => {
    expect(planHistory(chat(KEEP_TURNS + FOLD_TURNS - 1), BUDGET).folded).toBe(0);
    const at8 = planHistory(chat(KEEP_TURNS + FOLD_TURNS), BUDGET);
    expect(at8.folded).toBe(FOLD_TURNS);
    const at9 = planHistory(chat(KEEP_TURNS + FOLD_TURNS + 1), BUDGET);
    const at11 = planHistory(chat(KEEP_TURNS + FOLD_TURNS + 3), BUDGET);
    // Same summary from 8 to 11 turns: the prompt cache keeps it.
    expect(at9.summary).toBe(at8.summary);
    expect(at11.summary).toBe(at8.summary);
    expect(at8.summary).toContain('Earlier in this chat, in short:');
    expect(at8.summary).toContain('- Asked: Question 0?\n  Answered: Answer 0.');
    expect(at8.summary).not.toContain('Question 4?');
    expect(at8.recent[0]).toEqual({ role: 'user', content: 'Question 4?' });
    // The writer gets the summary first.
    expect(historyMessages(at8)[0]).toEqual({ role: 'user', content: at8.summary });
  });

  it('folds more when the recent turns are over the budget, and shortens a long message', () => {
    const long = planHistory(
      chat(6, () => 'x'.repeat(10_000)),
      BUDGET,
    );
    expect(long.folded).toBeGreaterThan(0);
    const sizes = long.recent.map((m) => (m.content as string).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MESSAGE_CHARS + 20);
    expect(long.recent.at(-1)?.content).toMatch(/\[…shortened\]$/);
    // Never folds the last turn away.
    const one = planHistory(
      chat(1, () => 'x'.repeat(50_000)),
      1_000,
    );
    expect(one.folded).toBe(0);
    expect(one.recent).toHaveLength(2);
  });

  it('leaves the oldest summary lines out when the summary is over its room', () => {
    const plan = planHistory(
      chat(40, (i) => `Answer ${i} `.repeat(40)),
      4_000,
    );
    expect(plan.summary).toMatch(/older turns left out\)/);
    expect(plan.summary!.length).toBeLessThan(4_000);
  });

  it('gives the reader the last turns in a few lines', () => {
    expect(planHistory([], BUDGET).digest).toBeNull();
    const plan = planHistory(
      chat(5, (i) => `Answer ${i}\nwith   lines.`),
      BUDGET,
    );
    expect(plan.digest).toBe(
      [
        'The chat so far (last 2 of 5 turns):',
        '- Asked: Question 3?\n  Answered: Answer 3 with lines.',
        '- Asked: Question 4?\n  Answered: Answer 4 with lines.',
      ].join('\n'),
    );
  });
});

describe('planHistory, cache and encoding', () => {
  it('keeps the summary the same between folds in a long chat', () => {
    const rows: HistoryRow[] = [];
    const summaries: (string | null)[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push(
        { role: 'user', content: `Question ${i} ${'q'.repeat(300)}` },
        { role: 'assistant', content: `Answer ${i} ${'a'.repeat(600 + (i % 3) * 400)}` },
      );
      summaries.push(planHistory(rows, BUDGET).summary);
    }
    const changedAt = summaries.flatMap((s, i) => (i > 0 && s !== summaries[i - 1] ? [i + 1] : []));
    // Turn counts at which the summary changed: only when FOLD_TURNS more turns fold.
    for (const turns of changedAt) expect((turns - KEEP_TURNS) % FOLD_TURNS).toBe(0);
    expect(changedAt.length).toBeGreaterThan(0);
  });

  it('never cuts an emoji in half in the summary, the digest or a recent message', () => {
    const question = `${'q'.repeat(198)}😀 and more`;
    const long = `${'a'.repeat(MESSAGE_CHARS - 1)}😀 tail`;
    const rows: HistoryRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push({ role: 'user', content: question }, { role: 'assistant', content: long });
    }
    const plan = planHistory(rows, BUDGET);
    const texts = [
      plan.summary ?? '',
      plan.digest ?? '',
      ...plan.recent.map((m) => (typeof m.content === 'string' ? m.content : '')),
    ];
    expect(plan.summary).not.toBeNull();
    for (const text of texts) expect(text.isWellFormed()).toBe(true);
  });
});
