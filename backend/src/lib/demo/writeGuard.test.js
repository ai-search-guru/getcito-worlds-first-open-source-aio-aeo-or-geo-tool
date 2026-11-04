import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { brandScopedTables } from './coverage.js';

/**
 * People can't write the demo brand's data (00381): every table they can
 * write under RLS that belongs to a brand carries refuse_demo_brand_writes,
 * which lets only a role that bypasses RLS (the server) through. Read from
 * the migrations, as coverage.test.js reads the brand-scoped tables: a new
 * table people can write fails here until its migration attaches it.
 */

const dir = new URL('../../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const migrations = files.map((file) => readFileSync(new URL(file, dir), 'utf8'));

/** Tables people can write that belong to no brand, and why they need no trigger. */
const NOT_A_BRAND_ROW = {
  api_keys: "The organization's API keys.",
  brands:
    "The brands themselves: their policies refuse a demo brand's insert, update and delete (00380).",
  chat_auto_choices:
    "A person's \"Don't ask again\" ticks in Chat (00401), by tool, in their workspace: no brand's.",
  chat_user_prefs: "A person's own Chat preferences (00400): no brand's.",
  content_authors: "The organization's authors, shared by its brands.",
  content_rule_sets: "The organization's content rules per page type, shared by its brands.",
  invitations: "The organization's invitations.",
  organizations: 'The organization itself.',
  profiles: "A person's own profile.",
  white_label_kits:
    "The organization's white-label kit (00429), shared by its brands; a brand's client logo is on brands.",
};

/**
 * Tables with a brand_id that people may write on a demo brand too, and why:
 * nothing of the demo's sample data, and nothing that costs.
 */
const OPEN_ON_A_DEMO_BRAND = {
  chat_notices:
    "A person's own notes from the system (00446): they only mark them read or close them, no sample data and nothing that costs; none is ever written about a demo brand.",
  prompt_table_views:
    "A person's column layout of the Tracked Prompts table (00363): it changes no sample data and costs nothing; the web keeps it open while read-only too.",
};

const name = (raw) =>
  raw
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();

const roles = (raw) =>
  raw
    .replace(/"/g, '')
    .toLowerCase()
    .split(',')
    .map((role) => role.trim());

/** Each migration's statements, comments and function bodies left out. */
function statements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim());
}

/**
 * The tables people can write once the migrations have run: those with a
 * policy for insert, update, delete or all (none named means all) for a role
 * other than service_role, as pg_policies would list them.
 */
function writableTables() {
  const policies = new Map();
  const policy = (table) => {
    if (!policies.has(table)) policies.set(table, new Map());
    return policies.get(table);
  };
  for (const sql of migrations) {
    for (const statement of statements(sql)) {
      let m;
      if ((m = statement.match(/^create policy ("[^"]+"|\S+) on ([\w."]+)(.*)$/i))) {
        const rest = m[3];
        policy(name(m[2])).set(name(m[1]), {
          cmd: (
            rest.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? 'all'
          ).toLowerCase(),
          roles: roles(rest.match(/\bto ([\w", ]+?)(?: using| with check|$)/i)?.[1] ?? 'public'),
        });
      } else if ((m = statement.match(/^drop policy (?:if exists )?("[^"]+"|\S+) on ([\w."]+)/i))) {
        policies.get(name(m[2]))?.delete(name(m[1]));
      } else if ((m = statement.match(/^alter policy ("[^"]+"|\S+) on ([\w."]+) (.*)$/i))) {
        const kept = policies.get(name(m[2]));
        const found = kept?.get(name(m[1]));
        const to = m[3].match(/^to ([\w", ]+?)(?: using| with check|$)/i);
        const renamed = m[3].match(/^rename to ("[^"]+"|\S+)/i);
        if (found && to) found.roles = roles(to[1]);
        if (found && renamed) {
          kept.delete(name(m[1]));
          kept.set(name(renamed[1]), found);
        }
      } else if (
        (m = statement.match(/^drop table (?:if exists )?([\w.", ]+?)(?: cascade| restrict)?$/i))
      ) {
        for (const table of m[1].split(',')) policies.delete(name(table.trim()));
      } else if (
        (m = statement.match(
          /^alter table (?:if exists )?(?:only )?([\w."]+) rename to ([\w."]+)/i,
        ))
      ) {
        const kept = policies.get(name(m[1]));
        policies.delete(name(m[1]));
        if (kept) policies.set(name(m[2]), kept);
      }
    }
  }
  return new Set(
    [...policies]
      .filter(([, kept]) =>
        [...kept.values()].some(
          (p) => p.cmd !== 'select' && p.roles.some((role) => role !== 'service_role'),
        ),
      )
      .map(([table]) => table),
  );
}

/** Table → the trigger's arguments (the way to its brand; [] for its own brand_id). */
function guardedTables() {
  const guarded = new Map();
  for (const sql of migrations) {
    for (const statement of statements(sql)) {
      const m = statement.match(
        /^create (?:or replace )?trigger \w+ before insert or update or delete on ([\w."]+) for each row execute function public\.refuse_demo_brand_writes\(([^)]*)\)$/i,
      );
      if (m) {
        guarded.set(
          name(m[1]),
          m[2]
            .split(',')
            .map((arg) => arg.trim().replace(/^'|'$/g, ''))
            .filter(Boolean),
        );
      }
    }
  }
  return guarded;
}

const brandTables = brandScopedTables(migrations);
const writable = writableTables();
const guarded = guardedTables();

describe('people cannot write a demo brand’s rows', () => {
  it('finds the tables people can write', () => {
    expect(writable.size).toBeGreaterThan(30);
    for (const table of ['prompts', 'competitors', 'topics', 'content_drafts', 'brands']) {
      expect(writable.has(table), table).toBe(true);
    }
    // Written by the server only.
    for (const table of ['prompt_results', 'jobs', 'site_pages']) {
      expect(writable.has(table), table).toBe(false);
    }
  });

  it('guards every table with a brand_id that people can write, by its own brand_id', () => {
    const missing = [...writable].filter(
      (table) =>
        brandTables.has(table) &&
        guarded.get(table)?.length !== 0 &&
        !(table in OPEN_ON_A_DEMO_BRAND),
    );
    // A table here is new: attach refuse_demo_brand_writes() in its migration,
    // or name it in OPEN_ON_A_DEMO_BRAND with why.
    expect(missing).toEqual([]);
    for (const table of Object.keys(OPEN_ON_A_DEMO_BRAND)) {
      expect(writable.has(table), table).toBe(true);
      expect(brandTables.has(table), table).toBe(true);
      expect(guarded.has(table), table).toBe(false);
    }
  });

  it('guards every other table people can write, through its brand, unless it has none', () => {
    const missing = [...writable].filter(
      (table) => !brandTables.has(table) && !guarded.has(table) && !(table in NOT_A_BRAND_ROW),
    );
    // A table here belongs to a brand through another row: attach
    // refuse_demo_brand_writes('<column>', '<table>', …) leading to it. Or it
    // belongs to no brand: add it to NOT_A_BRAND_ROW with why.
    expect(missing).toEqual([]);
    for (const table of Object.keys(NOT_A_BRAND_ROW)) {
      expect(writable.has(table), table).toBe(true);
      expect(brandTables.has(table), table).toBe(false);
      expect(guarded.has(table), table).toBe(false);
    }
  });

  it('leads each table without a brand_id to a table with one', () => {
    for (const [table, path] of guarded) {
      if (path.length === 0) {
        expect(brandTables.has(table), table).toBe(true);
        continue;
      }
      expect(path.length % 2, table).toBe(0);
      const tables = path.filter((_, i) => i % 2 === 1);
      for (const step of tables.slice(0, -1)) expect(brandTables.has(step), step).toBe(false);
      expect(brandTables.has(tables.at(-1)), table).toBe(true);
    }
    expect(guarded.get('prompts')).toEqual(['prompt_set_id', 'prompt_sets']);
    expect(guarded.get('prompt_notes')).toEqual([
      'prompt_id',
      'prompts',
      'prompt_set_id',
      'prompt_sets',
    ]);
  });

  it('lets a role that bypasses RLS through first: the server, which writes the demo', () => {
    const migration = readFileSync(new URL('00381_demo_brand_writes.sql', dir), 'utf8');
    const body = migration.slice(migration.indexOf('as $$'), migration.indexOf('end;\n$$;'));
    const bypass = body.indexOf(
      'rolbypassrls from pg_catalog.pg_roles where rolname = current_user',
    );
    expect(bypass).toBeGreaterThan(0);
    expect(bypass).toBeLessThan(body.indexOf("raise exception 'demo_brand'"));
    // …but not the owner of a SECURITY DEFINER function a person called
    // straight (current_user is then its owner): the session's role decides,
    // unless the write comes from inside another trigger (a cascade).
    const check = body.slice(bypass, body.indexOf('\n  then\n', bypass));
    expect(check).toMatch(/and \(\s*pg_catalog\.pg_trigger_depth\(\) > 1\s*or /);
    expect(check).toMatch(
      /coalesce\(pg_catalog\.current_setting\('role', true\), 'none'\)\s*not in \('authenticated', 'anon'\)/,
    );
    expect(body).toMatch(/using errcode = '42501'/);
    // The demo generator (lib/demo) writes with the service role key.
    const client = readFileSync(new URL('../../config/supabase.js', import.meta.url), 'utf8');
    expect(client).toMatch(/createClient\(supabaseUrl, supabaseServiceRoleKey,/);
  });
});
