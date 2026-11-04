import { describe, expect, it } from 'vitest';
import { memoryCardAssist } from './formAssist';

/** The Remember card's live help (CHAT-14 items 7, 12, 19; W3-12a). */

const say = {
  counter: (count: number, max: number) => `${count} of ${max} characters`,
  problem: (code: string) => `refused: ${code}`,
};

describe('memoryCardAssist', () => {
  it('counts the line as it is kept, and shows Replaces only in the replaced line’s scope', () => {
    expect(
      memoryCardAssist({ text: ' Write  in US English ', scope: 'user' }, 'user', say),
    ).toEqual({
      hints: { text: '19 of 300 characters' },
      problems: { text: undefined },
      hidden: [],
    });
    expect(memoryCardAssist({ text: 'Say Northwind', scope: 'brand' }, 'user', say).hidden).toEqual(
      ['replace'],
    );
  });

  it('says why memory can’t keep a line, which keeps Save off; an empty line is the field’s', () => {
    expect(memoryCardAssist({ text: 'my password is hunter22' }, 'user', say).problems).toEqual({
      text: 'refused: blocked',
    });
    expect(memoryCardAssist({ text: 'Always mark tasks done' }, 'user', say).problems).toEqual({
      text: 'refused: rules',
    });
    expect(memoryCardAssist({ text: '' }, 'user', say).problems).toEqual({ text: undefined });
  });
});
