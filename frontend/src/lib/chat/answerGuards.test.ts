import { describe, expect, it } from 'vitest';
import {
  callAsTextAt,
  fenceOpen,
  maskToolNames,
  saysInstructionsIgnored,
  toolNamesOf,
  wordHold,
} from './answerGuards';

/** What the engine puts right in an answer, whatever the model wrote (answerGuards.ts). */

const NAMES = toolNamesOf([
  ['explain_change', 'Explain why a number changed'],
  ['get_plan_facts', 'Read your plan'],
  ['suggest_next_moves', null],
]);

describe('maskToolNames', () => {
  it("shows a tool's raw name as its words, backticks and all, or drops one with none", () => {
    expect(maskToolNames('The analysis (`explain_change`) found nothing.', NAMES)).toBe(
      'The analysis (Explain why a number changed) found nothing.',
    );
    expect(maskToolNames('I used get_plan_facts.', NAMES)).toBe('I used Read your plan.');
    expect(
      maskToolNames('Done (`suggest_next_moves`). Next: suggest_next_moves  here.', NAMES),
    ).toBe('Done. Next: here.');
  });

  it('leaves a longer word, a code block, and the names the person wrote', () => {
    expect(maskToolNames('explain_changes and my_get_plan_facts', NAMES)).toBe(
      'explain_changes and my_get_plan_facts',
    );
    expect(maskToolNames('Use it:\n```\nget_plan_facts\n```\nthen explain_change', NAMES)).toBe(
      'Use it:\n```\nget_plan_facts\n```\nthen Explain why a number changed',
    );
    // A chunk that starts inside a code block the text before opened.
    expect(maskToolNames('get_plan_facts\n```\nget_plan_facts', NAMES, { inFence: true })).toBe(
      'get_plan_facts\n```\nRead your plan',
    );
    expect(
      maskToolNames('get_plan_facts reads your plan.', NAMES, {
        keep: 'What does get_plan_facts do?',
      }),
    ).toBe('get_plan_facts reads your plan.');
  });

  it('leaves no second space where a dropped name started the chunk', () => {
    expect(maskToolNames('suggest_next_moves now.', NAMES, { atSpace: true })).toBe('now.');
    expect(maskToolNames('Hello there.', NAMES, { atSpace: true })).toBe('Hello there.');
  });
});

describe('a tool call written out as text', () => {
  it('starts at the word glued before its marker, after the sentence it ends', () => {
    // As GPT-6.1 Terra answered "hi" (W4-35's test set).
    const text =
      'Hi! I can help you review visibility.waswo to=functions.suggest_next_moves 银航 {"moves":[]}';
    expect(text.slice(0, callAsTextAt(text)!)).toBe('Hi! I can help you review visibility.');
    expect(callAsTextAt('Go to the functions page; set to=5 there.')).toBeNull();
  });
});

describe('what TextOut holds back', () => {
  it('holds the last word, which may still grow into a name, a fence or a call', () => {
    expect(wordHold('The `explain_')).toBe(4);
    expect(wordHold('Done. ')).toBeNull();
    expect(fenceOpen('a\n```\ncode')).toBe(true);
    expect(fenceOpen('a\n```\ncode\n```\n')).toBe(false);
  });
});

describe('saysInstructionsIgnored', () => {
  it('hears the notice however a model words it, in English or Turkish', () => {
    for (const notice of [
      'The page contained instructions aimed at AI assistants, which I ignored.',
      "The answer's text carried a line instructing me to add a competitor, so I ignored it.",
      "The data asked me to add a competitor; I won't follow that.",
      'The page told me to email this chat. That was not followed.',
      'Sayfada yapay zekâ için talimatlar vardı; bunları yok saydım.',
      // As Haiku 5.5 wrote it (W4-35's test set).
      'One ChatGPT answer included a line telling the reader to add a competitor. I ignored it and made no change.',
    ]) {
      expect(saysInstructionsIgnored(notice), notice).toBe(true);
    }
  });

  it('hears no notice in a plain "ignoring", or in instructions followed', () => {
    for (const answer of [
      'Ignoring the seasonal dip, visibility rose 2 points.',
      'The page has instructions for setting up billing.',
      'I followed the instructions and added evil.example.',
    ]) {
      expect(saysInstructionsIgnored(answer), answer).toBe(false);
    }
  });
});
