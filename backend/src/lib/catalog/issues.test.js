import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './__fixtures__/fakeDb.js';
import { ISSUE_BATCH, saveItemIssues } from './issues.js';

const source = { id: 'src-1', brand_id: 'brand-1' };
const issue = (externalId, severity, code = 'missing_gtin') => ({
  externalId,
  code,
  severity,
  attribute: 'gtin',
  reportingContext: 'SHOPPING_ADS',
  description: 'Missing value [gtin]',
  detail: null,
  documentation: null,
  resolution: 'merchant_action',
  countries: ['US'],
});

describe('saveItemIssues', () => {
  it("replaces the source's issues, and leaves another source's alone", async () => {
    const fake = fakeDb();
    fake
      .rows('catalog_item_issues')
      .push(
        { id: 'old', source_id: 'src-1', external_id: 'gone' },
        { id: 'other', source_id: 'src-2', external_id: 'kept' },
      );
    await saveItemIssues(source, [issue('A', 'disapproved')], {
      db: fake.db,
      now: new Date('2026-10-27T10:00:00Z'),
    });
    expect(
      fake
        .rows('catalog_item_issues')
        .map((r) => r.external_id)
        .sort(),
    ).toEqual(['A', 'kept']);
    expect(fake.rows('catalog_item_issues').find((r) => r.external_id === 'A')).toMatchObject({
      brand_id: 'brand-1',
      source_id: 'src-1',
      code: 'missing_gtin',
      severity: 'disapproved',
      attribute: 'gtin',
      reporting_context: 'SHOPPING_ADS',
      countries: ['US'],
      created_at: '2026-10-27T10:00:00.000Z',
    });
  });

  it('counts the items with issues, and the issues per severity', async () => {
    const fake = fakeDb();
    await expect(
      saveItemIssues(
        source,
        [
          issue('A', 'disapproved'),
          issue('A', 'demoted', 'image_too_small'),
          issue('B', 'not_impacted'),
        ],
        { db: fake.db },
      ),
    ).resolves.toEqual({ items: 2, disapproved: 1, demoted: 1, not_impacted: 1 });
    await expect(saveItemIssues(source, [], { db: fake.db })).resolves.toEqual({
      items: 0,
      disapproved: 0,
      demoted: 0,
      not_impacted: 0,
    });
    expect(fake.rows('catalog_item_issues')).toHaveLength(0);
  });

  it('writes a large list in batches', async () => {
    const fake = fakeDb();
    const many = Array.from({ length: ISSUE_BATCH + 1 }, (_, i) => issue(`I${i}`, 'demoted'));
    await saveItemIssues(source, many, { db: fake.db });
    const inserts = fake.writes.filter(
      (w) => w.table === 'catalog_item_issues' && w.op === 'insert',
    );
    expect(inserts.map((w) => w.count)).toEqual([ISSUE_BATCH, 1]);
  });
});
