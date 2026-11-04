import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from './systemPrompt';

describe('buildAgentSystemPrompt', () => {
  const now = new Date('2026-10-08T00:00:00.000Z');

  it('uses the conversation brand for unqualified questions', () => {
    const prompt = buildAgentSystemPrompt(now, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme',
    });

    expect(prompt).toContain("The conversation's default brand is **Acme**");
    expect(prompt).toContain('id: `11111111-1111-1111-1111-111111111111`');
    expect(prompt).toContain('Use this brand for questions that do not name a brand explicitly.');
    expect(prompt).toContain(
      'If the user explicitly asks about another brand, use that brand instead.',
    );
    expect(prompt).toContain('Do not call list_brands just to resolve the default brand.');
  });

  it('keeps to the safety rules: no risk to life, no profanity, no promised results', () => {
    const prompt = buildAgentSystemPrompt(now);

    expect(prompt).toContain('**Nothing that puts a life at risk.**');
    expect(prompt).toContain('local emergency services');
    expect(prompt).toContain('**No profanity and no insults**');
    expect(prompt).toContain('**Never promise results or earnings**');
    expect(prompt).toContain('an estimate or a scenario, not a guarantee');
  });

  it('falls back to brand selection when there is no conversation brand', () => {
    const prompt = buildAgentSystemPrompt(now);

    expect(prompt).toContain('This conversation has no default brand.');
    expect(prompt).toContain('resolve the available brands with `list_brands`');
    expect(prompt).toContain(
      "If there is no default brand and the user doesn't name one, call list_brands.",
    );
  });

  it('lists the Mentions & Sentiment tools and how to read net sentiment', () => {
    const prompt = buildAgentSystemPrompt(now);

    for (const name of [
      'get_mentions_summary',
      'list_mentions',
      'get_mention',
      'get_mention_competitors',
      'get_mentions_perception',
    ]) {
      expect(prompt).toContain(`- **${name}** —`);
    }
    expect(prompt).toContain('Under 20 mentions a figure is a low sample (`lowSample: true`)');
  });
});
