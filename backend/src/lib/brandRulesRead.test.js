import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The server reads a brand's rules (00450) itself; none when they can't be read. */

let answer;
const warn = vi.hoisted(() => vi.fn());
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (answer instanceof Error) throw answer;
          return answer;
        },
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ default: { warn } }));

const { readBrandRules } = await import('./brandRulesRead.js');

beforeEach(() => {
  warn.mockReset();
});

describe('readBrandRules', () => {
  it('reads the brand’s rules', async () => {
    answer = { data: { brand_rules: [' Cite official sources. '] }, error: null };
    expect(await readBrandRules('b1')).toEqual(['Cite official sources.']);
    expect(await readBrandRules(null)).toEqual([]);
  });

  it('reads none before 00450, quietly, and none on a failed read, saying so', async () => {
    answer = {
      data: null,
      error: { code: '42703', message: 'column brands.brand_rules does not exist' },
    };
    expect(await readBrandRules('b1')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    answer = { data: null, error: { code: '500', message: 'down' } };
    expect(await readBrandRules('b1')).toEqual([]);
    answer = new Error('socket');
    expect(await readBrandRules('b1')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
