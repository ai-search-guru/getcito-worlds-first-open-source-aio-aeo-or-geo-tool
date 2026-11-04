import { describe, expect, it } from 'vitest';
import { canWriteOpportunity, opportunityStart } from './opportunityStart';

const page = {
  url: 'https://acme.example/guide',
  title: 'The guide',
  aiCitations: 3,
  gaSessions: 9,
  lastmod: null,
};

describe('opportunityStart', () => {
  it('starts a new page for a create decision, or with no page to work on', () => {
    expect(
      opportunityStart({ id: 'o1', decision: 'create', sourceData: { targetPages: [page] } }),
    ).toEqual({ kind: 'opportunity', id: 'o1', page: null });
    expect(opportunityStart({ id: 'o2', decision: 'optimize', sourceData: {} })).toMatchObject({
      page: null,
    });
    expect(
      opportunityStart({ id: 'o3', decision: null, sourceData: { targetPages: [page] } }),
    ).toMatchObject({ page: null });
  });

  it('starts on the page it works on for every other decision', () => {
    for (const decision of ['optimize', 'expand', 'refresh', 'consolidate', 'defend'] as const) {
      expect(
        opportunityStart({
          id: 'o1',
          decision,
          sourceData: { targetPages: [{ ...page, url: '' }, page] },
        }),
      ).toEqual({ kind: 'opportunity', id: 'o1', page: { url: page.url, title: 'The guide' } });
    }
    expect(
      opportunityStart({
        id: 'o1',
        decision: 'expand',
        sourceData: { targetPages: [{ ...page, title: null }] },
      }).page,
    ).toEqual({ url: page.url, title: null });
  });
});

describe('canWriteOpportunity', () => {
  it('is owned work still open', () => {
    expect(canWriteOpportunity({ type: 'owned', status: 'new' })).toBe(true);
    expect(canWriteOpportunity({ type: 'owned', status: 'in_progress' })).toBe(true);
    expect(canWriteOpportunity({ type: 'earned', status: 'new' })).toBe(false);
    expect(canWriteOpportunity({ type: 'owned', status: 'dismissed' })).toBe(false);
    expect(canWriteOpportunity({ type: 'owned', status: 'done' })).toBe(false);
  });
});
