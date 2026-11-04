import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./prompts.js', import.meta.url)), 'utf8');

describe('topic prompt examples', () => {
  it('keeps every documented example within the prompt schema bounds', () => {
    const schema = source.match(
      /const topicPromptSchema[\s\S]*?prompts: z\.array\(z\.string\(\)\.min\((\d+)\)\.max\((\d+)\)/,
    );
    expect(schema).not.toBeNull();
    const bounds = { min: Number(schema[1]), max: Number(schema[2]) };
    const rule = source.match(/- Write them like real quick searches, e\.g\. ([^\n]+)$/m);
    expect(rule).not.toBeNull();
    const examples = [...rule[1].matchAll(/"([^"]+)"/g)].map(([, example]) => example);
    const currentYear = String(new Date().getFullYear());
    const resolvedExamples = examples.map((example) =>
      example.replace('${new Date().getFullYear()}', currentYear),
    );

    for (const example of resolvedExamples) {
      expect(example.length).toBeGreaterThanOrEqual(bounds.min);
      expect(example.length).toBeLessThanOrEqual(bounds.max);
    }
  });
});
