import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { DEMO_MODULES } = await import('./index.js');
const { PENDING, SKIPPED, brandScopedTables } = await import('./coverage.js');

/**
 * The demo keeps up with the product (00380): every table with a brand_id is
 * built by a demo module, skipped with a reason, or pending a later demo PR.
 * A new brand-scoped table fails this test until the demo says which.
 */

const dir = new URL('../../../../supabase/migrations/', import.meta.url);
const migrations = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(new URL(file, dir), 'utf8'));
const brandTables = brandScopedTables(migrations);

const built = DEMO_MODULES.flatMap((module) => module.tables);

describe('the demo brand covers every brand-scoped table', () => {
  it('finds the brand-scoped tables in the migrations', () => {
    expect(brandTables.size).toBeGreaterThan(80);
    for (const table of ['prompt_results', 'brand_domains', 'actions', 'catalog_products']) {
      expect(brandTables.has(table), table).toBe(true);
    }
    // No brand_id of its own: prompts belong to a brand through their prompt set.
    expect(brandTables.has('prompts')).toBe(false);
  });

  it('has every one built, skipped or pending', () => {
    const missing = [...brandTables].filter(
      (table) => !built.includes(table) && !(table in SKIPPED) && !(table in PENDING),
    );
    // A table here is new: add it to a demo module's `tables` (lib/demo),
    // or to SKIPPED (with why a demo brand has none) or PENDING in coverage.js.
    expect(missing).toEqual([]);
  });

  it('names each table once, and only tables that exist', () => {
    const named = [...built, ...Object.keys(SKIPPED), ...Object.keys(PENDING)];
    expect(named.filter((table, i) => named.indexOf(table) !== i)).toEqual([]);
    expect(named.filter((table) => !brandTables.has(table))).toEqual([]);
  });

  it('says why a table is skipped, and which PR builds a pending one', () => {
    for (const [table, reason] of Object.entries(SKIPPED)) {
      expect(reason.length, table).toBeGreaterThan(20);
    }
    for (const [table, by] of Object.entries(PENDING)) {
      expect(by, table).toMatch(/PR \d|Chat ships/);
    }
  });

  it('builds in an order its rows can point back in', () => {
    const names = DEMO_MODULES.map((module) => module.name);
    expect(names[0]).toBe('core');
    // A Content draft points at the action its opportunity was sent as.
    expect(names.indexOf('actionCenter')).toBeGreaterThan(0);
    expect(names.indexOf('actionCenter')).toBeLessThan(names.indexOf('content'));
  });

  it('keeps what costs or mails out of the demo', () => {
    for (const table of ['cloro_pending_tasks', 'jobs', 'sent_pulses', 'ai_traffic_digests']) {
      expect(SKIPPED[table], table).toBeTruthy();
    }
  });
});

describe('brandScopedTables', () => {
  it('follows tables through creates, added columns, renames and drops', () => {
    const tables = brandScopedTables([
      `create table public.a (id uuid, brand_id uuid not null references public.brands(id));
       create table if not exists "public"."b" ("id" uuid, "brand_id" "uuid");
       create table c (id uuid, note text default 'brand_id');
       -- create table commented (brand_id uuid);
       create table d (id uuid, check (length(name) > 0));`,
      `alter table c add column if not exists brand_id uuid;
       alter table public.b rename to b2;
       alter table d add column other uuid;
       drop table if exists public.a cascade;`,
    ]);
    expect([...tables].sort()).toEqual(['b2', 'c']);
  });
});
