import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateObject = vi.fn();
vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/**
 * The AI adoption rate behind every est_ai_volume: 45% of a prompt's Google
 * volume unless the install sets AI_VOLUME_MULTIPLIER.
 */
async function multiplier() {
  vi.resetModules();
  const { AI_VOLUME_MULTIPLIER } = await import('./intentExtraction.js');
  return AI_VOLUME_MULTIPLIER;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AI_VOLUME_MULTIPLIER', () => {
  it('defaults to 45% of Google volume', async () => {
    vi.stubEnv('AI_VOLUME_MULTIPLIER', '');
    expect(await multiplier()).toBe(0.45);
  });

  it('takes the rate an install sets', async () => {
    vi.stubEnv('AI_VOLUME_MULTIPLIER', '0.2');
    expect(await multiplier()).toBe(0.2);
  });
});

const {
  DECIDER_BATCH_SIZE,
  INTENT_CRITERIA,
  INTENT_ONLY_SYSTEM_PROMPT,
  classifyIntentsByDecider,
  classifyQueryIntents,
  intentOnlySchema,
} = await import('./intentExtraction.js');

/** A decision model that answers every question with `pick(query)`. */
const answering = (pick) =>
  vi.fn(async ({ state, questions }) =>
    Object.fromEntries(
      Object.keys(questions).map((name) => [name, { choice: pick(state.queries[name]) }]),
    ),
  );

const queriesOf = (n) => Array.from({ length: n }, (_, i) => `query ${i}`);

describe('intent labels', () => {
  it('gives the chat model and the decision model the same labels', () => {
    expect(Object.keys(INTENT_CRITERIA)).toEqual(intentOnlySchema.shape.intent.options);
    for (const [label, meaning] of Object.entries(INTENT_CRITERIA)) {
      expect(INTENT_ONLY_SYSTEM_PROMPT).toContain(`- ${label}: ${meaning}\n`.trimEnd());
    }
  });
});

describe('classifyIntentsByDecider', () => {
  it('asks 200 queries in two requests, one choice question per query', async () => {
    const decide = answering((query) => (query.endsWith('7') ? 'how-to' : 'what-is'));
    const intents = await classifyIntentsByDecider(queriesOf(200), decide);

    expect(decide).toHaveBeenCalledTimes(2);
    const sizes = decide.mock.calls.map(([{ questions }]) => Object.keys(questions).length);
    expect(sizes).toEqual([DECIDER_BATCH_SIZE, 200 - DECIDER_BATCH_SIZE]);
    const [{ questions }] = decide.mock.calls[0];
    expect(questions.q0).toMatchObject({ type: 'choice', criteria: INTENT_CRITERIA });
    expect(questions.q0.instructions).toContain('"query 0"');

    expect(Object.keys(intents)).toHaveLength(200);
    expect(intents['query 17']).toBe('how-to');
    expect(intents['query 150']).toBe('what-is');
  });

  it('leaves out an answer outside the labels, and a batch that fails', async () => {
    let call = 0;
    const decide = vi.fn(async ({ questions }) => {
      call += 1;
      if (call === 2) throw new Error('Decisions API 503');
      return {
        ...Object.fromEntries(Object.keys(questions).map((name) => [name, { choice: 'other' }])),
        q1: { choice: 'shopping' },
        q2: {},
      };
    });
    const intents = await classifyIntentsByDecider(queriesOf(130), decide);

    expect(decide).toHaveBeenCalledTimes(2);
    expect(Object.keys(intents)).toHaveLength(DECIDER_BATCH_SIZE - 2);
    expect(intents['query 0']).toBe('other');
    expect(intents).not.toHaveProperty('query 1');
    expect(intents).not.toHaveProperty('query 2');
    expect(intents).not.toHaveProperty('query 128');
  });
});

describe('classifyQueryIntents', () => {
  const chatModel = vi.fn(() => ({ id: 'chat' }));

  beforeEach(() => {
    generateObject.mockReset();
    generateObject.mockImplementation(async () => ({ object: { intent: 'comparison' } }));
    chatModel.mockClear();
  });

  it('uses the decision model when FANOUT_INTENTS_DECIDER is set and OpenRouter is configured', async () => {
    vi.stubEnv('FANOUT_INTENTS_DECIDER', '1');
    const decide = answering(() => 'best-top');
    const intents = await classifyQueryIntents(['best crm'], {
      chatModel,
      decideFn: decide,
      deciderConfigured: () => true,
    });
    expect(intents).toEqual({ 'best crm': 'best-top' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(chatModel).not.toHaveBeenCalled();
  });

  it('keeps the chat model, a call per query, when the switch is off or OpenRouter is not configured', async () => {
    const decide = answering(() => 'best-top');
    for (const [flag, configured] of [
      ['', true],
      ['1', false],
    ]) {
      vi.stubEnv('FANOUT_INTENTS_DECIDER', flag);
      generateObject.mockClear();
      const intents = await classifyQueryIntents(['crm vs erp', 'what is a crm'], {
        chatModel,
        decideFn: decide,
        deciderConfigured: () => configured,
      });
      expect(intents).toEqual({ 'crm vs erp': 'comparison', 'what is a crm': 'comparison' });
      expect(generateObject).toHaveBeenCalledTimes(2);
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it('leaves out a query whose chat call fails, and makes no call for no queries', async () => {
    generateObject
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ object: { intent: 'how-to' } });
    const deps = { chatModel, decideFn: vi.fn(), deciderConfigured: () => false };
    expect(await classifyQueryIntents(['a', 'b'], deps)).toEqual({ b: 'how-to' });
    expect(await classifyQueryIntents([], deps)).toEqual({});
    expect(chatModel).toHaveBeenCalledTimes(1);
  });
});
