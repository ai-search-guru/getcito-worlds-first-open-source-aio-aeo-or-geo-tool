import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_SEGMENTS, isExcludedPath } from './pagePaths.js';

/**
 * The AI Traffic Pages section (00178, AT-006) leaves out the same pages as
 * the nightly page detection: its SQL carries a copy of EXCLUDED_SEGMENTS,
 * which must not drift from this list.
 */

const migration = readFileSync(
  new URL('../../../supabase/migrations/00178_ai_traffic_pages.sql', import.meta.url),
  'utf8',
);
const sqlList = migration.match(/seg = any \(array\[([\s\S]*?)\]\)/)?.[1] ?? '';
const sqlSegments = [...sqlList.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("00178's excluded path segments", () => {
  it('are exactly the nightly detection’s', () => {
    expect(sqlSegments.length).toBeGreaterThan(30);
    expect(new Set(sqlSegments)).toEqual(new Set(EXCLUDED_SEGMENTS));
    expect(sqlSegments).toHaveLength(EXCLUDED_SEGMENTS.size);
  });

  it('each exclude a page on its own, as isExcludedPath does', () => {
    for (const segment of sqlSegments) expect(isExcludedPath(`/${segment}`), segment).toBe(true);
  });
});
