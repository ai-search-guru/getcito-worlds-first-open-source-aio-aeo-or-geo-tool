import { describe, expect, it } from 'vitest';
import { pageLabel, pickReferences, referenceQuery, type ChatReference } from './references';

/** The @ menu's rows: a search made safe, each source in turn, a page by its address. */

const ref = (type: ChatReference['type'], id: string): ChatReference => ({ type, id, label: id });

describe('references', () => {
  it('reads a search as words, without what PostgREST filters read', () => {
    expect(referenceQuery('  50% off_(pricing), page\\ ')).toBe('50 off pricing page');
    expect(referenceQuery('x'.repeat(150))).toHaveLength(100);
    // PostgREST reads * as % in like and ilike: "*" alone would match every row.
    expect(referenceQuery('*')).toBe('');
    expect(referenceQuery('price*list')).toBe('price list');
  });

  it('takes each source in turn, once each, up to eight', () => {
    const prompts = ['p1', 'p2', 'p3', 'p4'].map((id) => ref('prompt', id));
    const pages = ['a', 'b'].map((id) => ref('page', id));
    const tasks = ['t1', 't2', 't3', 't4'].map((id) => ref('task', id));
    expect(pickReferences([prompts, pages, tasks]).map((r) => r.id)).toEqual([
      'p1',
      'a',
      't1',
      'p2',
      'b',
      't2',
      'p3',
      't3',
    ]);
    expect(pickReferences([[ref('page', 'a')], [ref('page', 'a')]])).toHaveLength(1);
  });

  it('names a page by its address', () => {
    expect(pageLabel('https://www.getcito.com/pricing/')).toBe('getcito.com/pricing');
  });
});
