import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { CACHE_MARK, MAX_CACHE_MARKS, stepPrompt, todayLine } from './prompt';

/**
 * A step's prompt in cache order (W1-18; CHAT-04 §D items 21–25): core
 * rules, the workspace, the chat so far, this turn; at most four marks, on
 * copies, and none for a step nothing reads back.
 */

const user = (content: string): ModelMessage => ({ role: 'user', content });
const parts = (over: Partial<Parameters<typeof stepPrompt>[0]> = {}) => ({
  core: 'Core rules.',
  workspace: 'Workspace.',
  history: [user('Earlier?'), { role: 'assistant', content: 'Earlier.' } as ModelMessage],
  turn: user('Now?'),
  steps: [] as ModelMessage[],
  cache: true,
  ...over,
});

const isMarked = (m: { providerOptions?: unknown }) =>
  JSON.stringify(m.providerOptions) === JSON.stringify(CACHE_MARK);

describe('stepPrompt', () => {
  it('orders the blocks from stable to changing, and marks the system blocks and the history', () => {
    const { system, messages, marks } = stepPrompt(parts());
    expect(system.map((m) => m.content)).toEqual(['Core rules.', 'Workspace.']);
    expect(system.every(isMarked)).toBe(true);
    expect(messages.map((m) => m.content)).toEqual(['Earlier?', 'Earlier.', 'Now?']);
    expect(isMarked(messages[1])).toBe(true);
    expect(messages.filter(isMarked)).toHaveLength(1);
    expect(marks).toBe(3);
  });

  it('puts the loaded skills below the workspace block, unmarked (CHAT-13 item 6)', () => {
    const cached = stepPrompt(parts({ skills: 'Skills.' }));
    expect(cached.system.map((m) => m.content)).toEqual(['Core rules.', 'Workspace.', 'Skills.']);
    expect(cached.system.map(isMarked)).toEqual([true, true, false]);
    expect(cached.marks).toBe(3);
    const plain = stepPrompt(parts({ skills: 'Skills.', cache: false }));
    expect(plain.system.map((m) => m.content)).toEqual(['Core rules.', 'Workspace.', 'Skills.']);
  });

  it("marks the step's last call or result once there is one, within four marks", () => {
    const steps: ModelMessage[] = [
      { role: 'assistant', content: 'Reading.' },
      { role: 'user', content: 'Result.' },
    ];
    const { messages, marks } = stepPrompt(parts({ steps }));
    expect(marks).toBe(MAX_CACHE_MARKS);
    expect(isMarked(messages.at(-1)!)).toBe(true);
    // Copies: the run's own messages keep no mark.
    expect(steps[1].providerOptions).toBeUndefined();
  });

  it('marks nothing for a step that nothing reads back, or another provider', () => {
    const { system, messages, marks } = stepPrompt(parts({ cache: false }));
    expect(marks).toBe(0);
    expect([...system, ...messages].some((m) => m.providerOptions)).toBe(false);
  });

  it('keeps the day out of the stable blocks', () => {
    expect(todayLine(new Date('2026-10-30T23:59:00.000Z'))).toBe('Today is 2026-10-30.');
  });
});
