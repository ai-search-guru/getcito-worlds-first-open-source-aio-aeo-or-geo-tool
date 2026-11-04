import { jsonSchema, zodSchema } from 'ai';

/**
 * generateObject's settings for a "provider/model" string (aiProvider.js
 * resolveModel): the schema, and for Claude what its Messages API asks of a
 * call since Claude Haiku 5.5 and Sonnet 5.5. Any other provider gets the
 * schema as it is and its own defaults, as before.
 *
 * For Claude:
 *   * native structured output (output_config.format), never
 *     @ai-sdk/anthropic's "json" tool: for a model it doesn't know (3.0.58
 *     knows none past 4.6) the SDK picks the tool and forces it with
 *     tool_choice "any", which Sonnet 5.5 turns away with a 400;
 *   * the schema without the keywords output_config.format turns away with
 *     a 400 (claudeJsonSchema); the zod schema still checks the answer;
 *   * maxOutputTokens, sent: for a model it doesn't know the SDK sends
 *     4,096, and Claude 5.5's thinking, on by default, counts toward it;
 *   * no temperature, top_p, top_k or thinking settings: the Messages API
 *     turns sampling settings away (2026-10-21), and a thinking budget or
 *     "disabled" too. None is passed here or by the calls that use this.
 *
 * @param {string} modelId
 * @param {import('zod').ZodType} schema
 * @param {{ maxOutputTokens: number }} options
 */
export function objectOptions(modelId, schema, { maxOutputTokens }) {
  if (!isClaude(modelId)) return { schema };
  return {
    schema: claudeSchema(schema),
    maxOutputTokens,
    providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } },
  };
}

/** A model the first-party Anthropic SDK runs ("anthropic/…"), not one through OpenRouter. */
export function isClaude(modelId) {
  return String(modelId ?? '').split('/')[0] === 'anthropic';
}

/** A zod schema as Claude's structured output takes it, still checked by zod. */
export function claudeSchema(schema) {
  const zod = zodSchema(schema);
  return jsonSchema(() => claudeJsonSchema(zod.jsonSchema), { validate: zod.validate });
}

/** Keywords output_config.format turns away; a length or count is told in the description. */
const DROPPED = new Set([
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
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'propertyNames',
  'contains',
]);
/** The string formats it takes. */
const FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);
/** What a dropped keyword asked, in words the model reads in the description. */
const SAID = {
  minLength: (n) => `at least ${n} characters`,
  maxLength: (n) => `at most ${n} characters`,
  minItems: (n) => `at least ${n} items`,
  maxItems: (n) => `at most ${n} items`,
  minimum: (n) => `at least ${n}`,
  maximum: (n) => `at most ${n}`,
};
/** zod's .int() bounds: no limit worth telling. */
const SAFE = Number.MAX_SAFE_INTEGER;

/**
 * A JSON schema as Claude's structured output takes it: every object closed
 * (additionalProperties false), `oneOf` as `anyOf`, and no keyword it turns
 * away (string lengths, number ranges, item counts beyond minItems 1, a
 * format it doesn't know, $schema). A length or count that matters is told
 * in the description instead, so the model keeps to it: zod, checking the
 * answer, still rejects one that doesn't. Property names are never read as
 * keywords (a property may be called "format").
 */
export function claudeJsonSchema(node) {
  if (Array.isArray(node)) return node.map(claudeJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  const said = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, claudeJsonSchema(schema)]),
      );
    } else if (['items', 'anyOf', 'allOf', 'prefixItems', 'not'].includes(key)) {
      out[key] = claudeJsonSchema(value);
    } else if (key === 'oneOf') {
      out.anyOf = claudeJsonSchema(value);
    } else if (key === 'minItems') {
      out.minItems = Math.min(value, 1);
      if (value > 1) said.push(SAID.minItems(value));
    } else if (key === 'format') {
      if (FORMATS.has(value)) out.format = value;
    } else if (DROPPED.has(key)) {
      if (SAID[key] && Math.abs(value) < SAFE) said.push(SAID[key](value));
    } else {
      out[key] = value;
    }
  }
  if (out.type === 'object' || out.properties) out.additionalProperties = false;
  if (said.length) {
    const note = `(${said.join(', ')})`;
    out.description = out.description ? `${out.description} ${note}` : note;
  }
  return out;
}
