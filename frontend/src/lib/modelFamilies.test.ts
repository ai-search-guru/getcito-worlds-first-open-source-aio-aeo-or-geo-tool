import { describe, expect, it } from 'vitest';
import { isSingleModel, modelFamilies, modelFamilyValue, modelLabel } from './modelFamilies';

/** The model filter's families, and an address's one slug read as its family. */

describe('modelFamilies', () => {
  it('groups the slugs answers came from by the name the page shows', () => {
    expect(modelLabel('chatgpt-web')).toBe('ChatGPT');
    expect(modelLabel('gpt-5-chat-latest')).toBe('ChatGPT');
    expect(
      modelFamilies(['perplexity-web', 'gpt-5-chat-latest', 'chatgpt-web', 'chatgpt-web', '']),
    ).toEqual(['chatgpt-web,gpt-5-chat-latest', 'perplexity-web']);
  });
});

describe('modelFamilyValue', () => {
  const families = ['chatgpt-web,gpt-5-chat-latest', 'perplexity-web'];

  it('reads one slug of a family as the family, as the dropdown sets it', () => {
    expect(modelFamilyValue('chatgpt-web', families)).toBe('chatgpt-web,gpt-5-chat-latest');
    expect(modelFamilyValue('gpt-5-chat-latest', families)).toBe('chatgpt-web,gpt-5-chat-latest');
  });

  it('keeps a family, a family of one, no filter, and a slug the brand has no answers from', () => {
    expect(modelFamilyValue('chatgpt-web,gpt-5-chat-latest', families)).toBe(
      'chatgpt-web,gpt-5-chat-latest',
    );
    expect(modelFamilyValue('perplexity-web', families)).toBe('perplexity-web');
    expect(modelFamilyValue('', families)).toBe('');
    expect(modelFamilyValue('grok-web', families)).toBe('grok-web');
  });

  it('reads a platform id as the family of the same name when no answer was stored under it', () => {
    // ChatGPT's web answers store the model Cloro names ("gpt-5-5"), not "chatgpt-web".
    const stored = modelFamilies(['gpt-5-5', 'gpt-5-3-mini', 'sonar-pro']);
    expect(stored).toEqual(['gpt-5-3-mini,gpt-5-5', 'sonar-pro']);
    expect(modelFamilyValue('chatgpt-web', stored)).toBe('gpt-5-3-mini,gpt-5-5');
    expect(modelFamilyValue('perplexity-web', stored)).toBe('sonar-pro');
    expect(modelFamilyValue('grok-web', stored)).toBe('grok-web');
    // An unknown slug is not ChatGPT, though the page would name it so.
    expect(modelFamilyValue('not-a-model', stored)).toBe('not-a-model');
    expect(modelFamilyValue('chatgpt-web,grok-web', stored)).toBe('chatgpt-web,grok-web');
  });

  it('tells a single slug from a family', () => {
    expect(isSingleModel('chatgpt-web')).toBe(true);
    expect(isSingleModel('chatgpt-web,gpt-5-chat-latest')).toBe(false);
    expect(isSingleModel('')).toBe(false);
  });
});
