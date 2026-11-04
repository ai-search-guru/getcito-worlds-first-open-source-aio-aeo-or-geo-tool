import { createAnthropic } from '@ai-sdk/anthropic';
import { NoObjectGeneratedError, generateObject } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { claudeJsonSchema, isClaude, objectOptions } from './structuredOutput.js';

/**
 * generateObject's settings for Claude 5.5 (Haiku reads, Sonnet writes, in
 * the Content Editor): native structured output, a schema it takes, a token
 * cap its thinking fits in, and no sampling or thinking settings. Requests
 * go to a fake fetch: nothing reaches Anthropic.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { suggestionsSchema } = await import('./contentAgent.js');
const { pageSchema } = await import('./contentWriter.js');
const { rewriteSchema } = await import('./contentRewrite.js');
const { briefSchema } = await import('./contentBrief.js');

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Keywords Claude's structured output turns away with a 400. */
const REFUSED = [
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
  'oneOf',
];

/**
 * What in a JSON schema Claude would refuse: a keyword above, minItems over
 * 1, an object left open; with the optional properties and unions counted
 * (at most 24 and 16 in a request).
 */
function claudeCheck(schema) {
  const problems = [];
  let optional = 0;
  let unions = 0;
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}/${i}`));
    if (!node || typeof node !== 'object') return;
    for (const key of REFUSED) if (key in node) problems.push(`${path}: ${key}`);
    if (node.minItems > 1) problems.push(`${path}: minItems ${node.minItems}`);
    if (node.type === 'object' && node.additionalProperties !== false) {
      problems.push(`${path}: open object`);
    }
    if (node.anyOf || Array.isArray(node.type)) unions += 1;
    const required = new Set(node.required ?? []);
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      if (!required.has(name)) optional += 1;
      walk(child, `${path}/${name}`);
    }
    for (const key of ['items', 'anyOf', 'allOf', '$defs', 'definitions']) {
      if (node[key]) walk(node[key], `${path}/${key}`);
    }
  };
  walk(schema, '');
  return { problems, optional, unions };
}

describe('objectOptions', () => {
  const schema = z.object({ items: z.array(z.string().max(20)).min(2).max(5) });

  it('leaves another provider’s call as it was: the schema alone', () => {
    for (const id of ['google/gemini-3-flash-preview', 'openrouter/anthropic/claude-haiku-4.5']) {
      expect(objectOptions(id, schema, { maxOutputTokens: 16_000 })).toEqual({ schema });
    }
    expect(isClaude('openrouter/anthropic/claude-haiku-4.5')).toBe(false);
    expect(isClaude('anthropic/claude-sonnet-5-5')).toBe(true);
  });

  it('gives Claude native structured output, its token cap and nothing for sampling or thinking', () => {
    const options = objectOptions('anthropic/claude-sonnet-5-5', schema, {
      maxOutputTokens: 32_000,
    });
    expect(options.maxOutputTokens).toBe(32_000);
    expect(options.providerOptions).toEqual({
      anthropic: { structuredOutputMode: 'outputFormat' },
    });
    for (const key of ['temperature', 'topP', 'topK']) expect(options).not.toHaveProperty(key);
    expect(options.providerOptions.anthropic).not.toHaveProperty('thinking');
    expect(options.schema.jsonSchema).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string', description: '(at most 20 characters)' },
          minItems: 1,
          description: '(at least 2 items, at most 5 items)',
        },
      },
      required: ['items'],
      additionalProperties: false,
    });
  });

  it('still checks the answer against the zod schema: a limit Claude wasn’t sent holds', async () => {
    const { schema: claude } = objectOptions('anthropic/claude-haiku-5-5', schema, {
      maxOutputTokens: 16_000,
    });
    expect(await claude.validate({ items: ['a', 'b'] })).toEqual({
      success: true,
      value: { items: ['a', 'b'] },
    });
    expect((await claude.validate({ items: ['a', 'b', 'c', 'd', 'e', 'f'] })).success).toBe(false);
    expect((await claude.validate({ items: ['a'] })).success).toBe(false);
  });
});

describe('claudeJsonSchema', () => {
  it('reads property names as names, never as keywords', () => {
    expect(
      claudeJsonSchema({
        type: 'object',
        properties: {
          format: { type: 'string', format: 'email' },
          maximum: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
          when: { type: 'string', format: 'not-a-format' },
        },
        required: ['format', 'maximum', 'when'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        format: { type: 'string', format: 'email' },
        // zod's .int() bounds aren't a limit worth telling.
        maximum: { type: 'integer' },
        when: { type: 'string' },
      },
      required: ['format', 'maximum', 'when'],
      additionalProperties: false,
    });
  });

  it('turns oneOf into anyOf, and closes objects inside unions and arrays', () => {
    expect(
      claudeJsonSchema({
        oneOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'null' }],
      }),
    ).toEqual({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
        { type: 'null' },
      ],
    });
  });
});

describe("the Content Editor's schemas, as Claude takes them", () => {
  const schemas = () => ({
    suggestionsSchema,
    pageSchema,
    rewriteSchema,
    briefSchema: briefSchema(),
  });

  it('send nothing Claude refuses, within its limits on optional properties and unions', () => {
    for (const rules of ['', 'true']) {
      // The brief rules (2026) give the brief its version 2 schema.
      vi.stubEnv('CONTENT_BRIEF_RULES', rules);
      for (const [name, schema] of Object.entries(schemas())) {
        const { schema: claude } = objectOptions('anthropic/claude-sonnet-5-5', schema, {
          maxOutputTokens: 32_000,
        });
        const check = claudeCheck(claude.jsonSchema);
        expect({ name, problems: check.problems }).toEqual({ name, problems: [] });
        expect(check.optional).toBeLessThanOrEqual(24);
        expect(check.unions).toBeLessThanOrEqual(16);
      }
    }
  });

  it('tell the model the limits they had: at most 8 suggestions, 2 to 12 sections', () => {
    const suggestions = objectOptions('anthropic/claude-sonnet-5-5', suggestionsSchema, {
      maxOutputTokens: 32_000,
    }).schema.jsonSchema;
    expect(suggestions.properties.suggestions.description).toBe('(at most 8 items)');
    const page = objectOptions('anthropic/claude-sonnet-5-5', pageSchema, {
      maxOutputTokens: 32_000,
    }).schema.jsonSchema;
    expect(page.properties.sections.description).toBe('(at least 2 items, at most 12 items)');
    expect(page.properties.sections.minItems).toBe(1);
  });
});

describe('a Claude 5.5 call through @ai-sdk/anthropic, as sent', () => {
  /** A provider whose requests land here, answered with `answer` after a thinking block. */
  function fakeClaude(answer) {
    const sent = [];
    const provider = createAnthropic({
      apiKey: 'test-key',
      // Named, so an ANTHROPIC_BASE_URL in the shell doesn't move it.
      baseURL: 'https://api.anthropic.com/v1',
      fetch: async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(init.body) });
        return new globalThis.Response(
          JSON.stringify({
            type: 'message',
            id: 'msg_1',
            model: 'claude-sonnet-5-5',
            role: 'assistant',
            // Thinking is on by default on Claude 5.5: its block comes first.
            content: [
              { type: 'thinking', thinking: '', signature: 'sig' },
              { type: 'text', text: JSON.stringify(answer) },
            ],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1200, output_tokens: 900 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    return { provider, sent };
  }

  const suggestion = {
    kind: 'replace',
    passage: 1,
    before: 'Old words',
    after: 'New words',
    reason: 'Answers first',
    rules: ['answerFirst'],
    sources: [],
    marks: [],
  };

  it('sends output_config.format, never a forced tool, sampling or thinking settings', async () => {
    const { provider, sent } = fakeClaude({ suggestions: [suggestion] });
    const result = await generateObject({
      model: provider('claude-sonnet-5-5'),
      ...objectOptions('anthropic/claude-sonnet-5-5', suggestionsSchema, {
        maxOutputTokens: 32_000,
      }),
      system: 'You are the Content Agent.',
      prompt: 'Fix the open rules.',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages');
    const { body } = sent[0];
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(32_000);
    // Sonnet 5.5 refuses tool_choice "any" / "tool": the json tool isn't used.
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body.output_config.format.type).toBe('json_schema');
    expect(claudeCheck(body.output_config.format.schema).problems).toEqual([]);
    // The thinking block is left out of the answer read.
    expect(result.object.suggestions).toEqual([suggestion]);
    expect(result.usage).toMatchObject({ inputTokens: 1200, outputTokens: 900 });
  });

  it('rejects an answer past a limit Claude was only told, as zod did before', async () => {
    const { provider } = fakeClaude({ suggestions: Array(9).fill(suggestion) });
    const call = generateObject({
      model: provider('claude-haiku-5-5'),
      ...objectOptions('anthropic/claude-haiku-5-5', suggestionsSchema, {
        maxOutputTokens: 16_000,
      }),
      prompt: 'Fix the open rules.',
    });
    await expect(call).rejects.toSatisfy((err) => NoObjectGeneratedError.isInstance(err));
  });
});
