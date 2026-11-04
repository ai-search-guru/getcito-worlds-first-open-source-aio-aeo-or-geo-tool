import { describe, expect, it } from 'vitest';
import { productAiSays, productNames, productQuote, type AiSaysAnswer } from './aiSays';

/** "What AI says" about a product (ECOM-012, V1). */

describe('productNames', () => {
  it('takes each title, and its name before the variant', () => {
    expect(
      productNames(['Ridge 30L Backpack - Black', 'Northwind Ridge 30L Backpack (2026)', 'Ridge']),
    ).toEqual([
      'Ridge 30L Backpack - Black',
      'Ridge 30L Backpack',
      'Northwind Ridge 30L Backpack (2026)',
      'Northwind Ridge 30L Backpack',
      'Ridge',
    ]);
  });
});

describe('productNames, beside its brand', () => {
  it("looks for the product's own name, never the brand's alone", () => {
    const brands = ['The North Face'];
    expect(productNames(['The North Face | Borealis Backpack'], brands)).toEqual([
      'The North Face | Borealis Backpack',
      'Borealis Backpack',
    ]);
    // The brand opening the title, or after it, or the title being the brand.
    expect(productNames(['The North Face Borealis Backpack - Black'], brands)).toContain(
      'Borealis Backpack',
    );
    expect(productNames(['Borealis Backpack | The North Face'], brands)).toContain(
      'Borealis Backpack',
    );
    expect(productNames(['the north face'], brands)).toEqual([]);
    // Unknown, the brand is the title's head as before.
    expect(productNames(['The North Face | Borealis Backpack'])).toContain('The North Face');
  });

  it("doesn't quote a sentence about the brand as the product's", () => {
    const response =
      'The North Face makes dependable gear. For school, the Borealis Backpack has a laptop sleeve.';
    const says = productAiSays(
      [
        {
          promptResultId: 'r1',
          platform: 'chatgpt-shopping',
          at: '2026-10-27T08:00:00Z',
          promptText: 'best school backpack',
          response,
          titles: ['The North Face | Borealis Backpack'],
        },
      ],
      [],
      [],
      1,
      ['The North Face'],
    );
    expect(says.quotes.map((quote) => quote.text)).toEqual([
      'For school, the Borealis Backpack has a laptop sleeve.',
    ]);
  });
});

describe('productQuote', () => {
  const response = [
    '## Best 30L packs',
    '',
    'For most hikers the **Summit Daypack 30** is the pick.',
    '- The [Ridge 30L Backpack](https://northwind.example/ridge) is tougher, with a lifetime warranty, but heavier at 1.4 kg.',
    '- TrailCo Lite 28 is the cheapest.',
  ].join('\n');

  it('quotes the first sentence naming the product, as the reader sees it', () => {
    expect(productQuote(response, ['Ridge 30L Backpack'])).toBe(
      'The Ridge 30L Backpack is tougher, with a lifetime warranty, but heavier at 1.4 kg.',
    );
  });

  it('quotes nothing when the answer never names it', () => {
    expect(productQuote(response, ['Peak 40'])).toBeNull();
    expect(productQuote(response, [])).toBeNull();
  });
});

describe('productAiSays', () => {
  const answer = (over: Partial<AiSaysAnswer>): AiSaysAnswer => ({
    promptResultId: 'r1',
    platform: 'chatgpt-shopping',
    at: '2026-10-27T08:00:00Z',
    promptText: 'best 30L hiking backpack',
    response: 'The Ridge 30L Backpack is tough. Others are lighter.',
    titles: ['Ridge 30L Backpack - Black'],
    ...over,
  });

  it('quotes each answer once, the latest first, and counts the sources they cited', () => {
    const says = productAiSays(
      [
        answer({ promptResultId: 'r0', at: '2026-10-20T08:00:00Z', response: 'Ridge is fine.' }),
        answer({}),
        // The same words in another answer: quoted once.
        answer({ promptResultId: 'r2', at: '2026-10-25T08:00:00Z', platform: 'gemini-web' }),
        answer({
          promptResultId: 'r3',
          at: '2026-10-26T08:00:00Z',
          response: 'Northwind Ridge 30L is the warranty pick.',
          titles: ['Northwind Ridge 30L'],
        }),
      ],
      [
        {
          promptResultId: 'r1',
          url: 'https://outdoorgear.example/best',
          domain: 'outdoorgear.example',
          title: 'Best packs',
        },
        {
          promptResultId: 'r2',
          url: 'https://outdoorgear.example/best',
          domain: 'outdoorgear.example',
          title: 'Best packs',
        },
        {
          promptResultId: 'r2',
          url: 'https://outdoorgear.example/best',
          domain: 'outdoorgear.example',
          title: 'Best packs',
        },
        {
          promptResultId: 'r3',
          url: 'https://reddit.example/r/hiking',
          domain: 'reddit.example',
          title: null,
        },
      ],
      ['Ridge 30L Backpack'],
      12,
    );
    expect(says.answers).toBe(12);
    expect(says.quotes.map((q) => [q.text, q.platform])).toEqual([
      ['The Ridge 30L Backpack is tough.', 'chatgpt-shopping'],
      ['Northwind Ridge 30L is the warranty pick.', 'chatgpt-shopping'],
    ]);
    expect(says.sources).toEqual([
      {
        url: 'https://outdoorgear.example/best',
        domain: 'outdoorgear.example',
        title: 'Best packs',
        answers: 2,
      },
      { url: 'https://reddit.example/r/hiking', domain: 'reddit.example', title: null, answers: 1 },
    ]);
  });
});
