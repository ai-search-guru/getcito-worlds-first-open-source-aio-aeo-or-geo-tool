// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A new brand runs Getting started at once when it is its organization's
 * first real brand, and asks first otherwise (00197). The demo brand (00380)
 * comes first for a person who starts without a card, so it must not count,
 * or the brand they set up after adding a card asks instead of showing the
 * 17 steps (00383).
 */
describe('start_brand_getting_started', () => {
  it("leaves the demo brand out of the organization's other brands", () => {
    const schema = readFileSync(join(__dirname, '../../../../supabase/schema.sql'), 'utf8');
    const definitions = schema.split(
      'create or replace function public.start_brand_getting_started()',
    );
    const latest = definitions[definitions.length - 1].split('$$;')[0];
    expect(definitions.length).toBeGreaterThan(1);
    expect(latest).toContain('and not b.is_demo');
  });

  // 00383's backfill confirms only brands the demo brand made "a later
  // brand". A second brand whose first was deleted, in an organization that
  // never had a demo brand, keeps asking.
  it('backfills only in organizations with a demo brand', () => {
    const migration = readFileSync(
      join(__dirname, '../../../../supabase/migrations/00383_getting_started_skip_demo_brand.sql'),
      'utf8',
    );
    const backfill = migration.slice(migration.indexOf('update public.getting_started gs'));
    expect(backfill).toMatch(
      /and exists \(\s*select 1 from public\.brands demo\s+where demo\.organization_id = b\.organization_id\s+and demo\.is_demo\s*\)/,
    );
  });
});
