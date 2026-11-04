// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * PostgREST refuses an embed it can't tell apart: profiles → organizations(…)
 * once two foreign keys join the tables (profiles.organization_id, and
 * organizations.anthropic_api_key_set_by back to profiles). The plan check
 * before every write read the organization that way, so every write failed
 * for every workspace (62eb7b76).
 *
 * This reads the foreign keys from supabase/schema.sql and every
 * .from(…).select(…) in the web app and the API server, and fails on an
 * embed between two tables joined more than once that doesn't name its
 * foreign key, as in organizations!profiles_organization_id_fkey(…).
 * `!inner` and `!left` only pick the join: they don't name one.
 */

const ROOT = join(__dirname, '../../../..');
const SCHEMA = join(ROOT, 'supabase/schema.sql');
const SOURCES = [join(ROOT, 'frontend/src'), join(ROOT, 'backend/src')];

interface ForeignKey {
  table: string;
  name: string;
  columns: string[];
  references: string;
}

const NAME = String.raw`"?(\w+)"?`;
const TABLE = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;

/** The statements of the schema, without comments and function bodies. */
function statements(sql: string): string[] {
  return sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** A list split on its top-level commas: a column list, or an ALTER TABLE's actions. */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

const columnsOf = (list: string) => list.split(',').map((c) => c.trim().replace(/"/g, ''));

/**
 * The foreign keys between public tables once every migration has run:
 * schema.sql is the migrations in order, so a dropped column, constraint or
 * table takes its keys with it.
 */
function foreignKeys(sql: string): Map<string, ForeignKey> {
  const keys = new Map<string, ForeignKey>();
  const add = (
    table: string,
    name: string | undefined,
    columns: string[],
    schema: string | undefined,
    references: string,
  ) => {
    if (schema && schema !== 'public') return;
    const key = { table, columns, references, name: name ?? `${table}_${columns.join('_')}_fkey` };
    keys.set(`${table}:${key.name}`, key);
  };
  // A column or a table constraint that references another table.
  const definition = (table: string, item: string) => {
    const constraint = item.match(
      new RegExp(
        String.raw`^(?:add )?(?:constraint ${NAME} )?foreign key \(([^)]*)\) references ${TABLE}`,
        'i',
      ),
    );
    if (constraint)
      return add(table, constraint[1], columnsOf(constraint[2]), constraint[3], constraint[4]);
    const column = item.match(
      new RegExp(
        String.raw`^(?:add (?:column )?(?:if not exists )?)?${NAME} [^,]*?\breferences ${TABLE}`,
        'i',
      ),
    );
    if (column && !/^(constraint|primary|unique|check|exclude)$/i.test(column[1])) {
      add(table, undefined, [column[1]], column[2], column[3]);
    }
  };

  for (const statement of statements(sql)) {
    const create = statement.match(
      new RegExp(
        String.raw`^create table (?:if not exists )?(?:"?public"?\.)?${NAME} \((.*)\)`,
        'i',
      ),
    );
    if (create) {
      for (const item of topLevel(create[2])) definition(create[1], item);
      continue;
    }
    const drop = statement.match(
      new RegExp(String.raw`^drop table (?:if exists )?(?:"?public"?\.)?${NAME}`, 'i'),
    );
    if (drop) {
      for (const [id, key] of keys)
        if (key.table === drop[1] || key.references === drop[1]) keys.delete(id);
      continue;
    }
    const alter = statement.match(
      new RegExp(
        String.raw`^alter table (?:if exists )?(?:only )?(?:"?public"?\.)?${NAME} (.*)`,
        'i',
      ),
    );
    if (!alter) continue;
    const table = alter[1];
    for (const action of topLevel(alter[2])) {
      const dropColumn = action.match(
        new RegExp(String.raw`^drop (?:column )?(?:if exists )?${NAME}`, 'i'),
      );
      const dropConstraint = action.match(
        new RegExp(String.raw`^drop constraint (?:if exists )?${NAME}`, 'i'),
      );
      if (dropConstraint) keys.delete(`${table}:${dropConstraint[1]}`);
      else if (dropColumn) {
        for (const [id, key] of keys)
          if (key.table === table && key.columns.includes(dropColumn[1])) keys.delete(id);
      } else if (/^add /i.test(action)) definition(table, action);
    }
  }
  return keys;
}

/** The pairs of tables joined by more than one foreign key, either way: "a|b" sorted. */
function ambiguousPairs(keys: Map<string, ForeignKey>): Set<string> {
  const counts = new Map<string, number>();
  for (const key of keys.values()) {
    if (key.table === key.references) continue;
    const pair = [key.table, key.references].sort().join('|');
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([pair]) => pair));
}

interface Embed {
  parent: string;
  table: string;
  named: boolean;
}

/** The embeds of a select, each under the table it hangs from. */
function embedsOf(select: string, base: string): Embed[] {
  const found: Embed[] = [];
  const stack = [base];
  const token = /(?:\.\.\.)?(?:"?[\w ]+"?:)?(\w+)((?:!\w+)*)\s*\(|\)/g;
  for (const match of select.matchAll(token)) {
    if (match[0] === ')') {
      stack.pop();
      continue;
    }
    const hints = match[2].split('!').filter(Boolean);
    found.push({
      parent: stack[stack.length - 1],
      table: match[1],
      named: hints.some((hint) => hint !== 'inner' && hint !== 'left'),
    });
    stack.push(match[1]);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry) && !/\.test\.\w+$/.test(entry) ? [path] : [];
  });
}

/** The table a query chain reads from: the .from('…') it starts with. */
function tableOf(chain: ts.Expression): string | null {
  let node: ts.Expression = chain;
  while (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      return node.arguments[0].text;
    }
    node = node.expression;
  }
  return null;
}

/** Every .from(…).select('…') in a file: its table, select and line. */
function selects(path: string): { table: string; select: string; line: number }[] {
  const text = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: { table: string; select: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'select' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const table = tableOf(node.expression.expression);
      if (table) {
        found.push({
          table,
          select: node.arguments[0].text,
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('embeds between tables joined more than once', () => {
  const pairs = ambiguousPairs(foreignKeys(readFileSync(SCHEMA, 'utf8')));

  it('reads the foreign keys from the schema, dropped ones gone', () => {
    expect(pairs.has('organizations|profiles')).toBe(true);
    const keys = foreignKeys(
      'create table public.a (id uuid primary key, b_id uuid references public.b(id));' +
        'alter table public.b add column a_id uuid references public.a(id);' +
        'alter table public.b drop column a_id;' +
        'alter table public.c add constraint c_one foreign key (x) references public.d(id), add column y uuid references public.d(id);',
    );
    expect(ambiguousPairs(keys)).toEqual(new Set(['c|d']));
  });

  it('reads the embeds of a select under the table each hangs from', () => {
    expect(
      embedsOf(
        'id, org:organizations!profiles_organization_id_fkey(name, brands!inner(id))',
        'profiles',
      ),
    ).toEqual([
      { parent: 'profiles', table: 'organizations', named: true },
      { parent: 'organizations', table: 'brands', named: false },
    ]);
  });

  // Reads every source file of both packages: seconds on a loaded machine.
  it('name the foreign key in the web app and the API server', () => {
    const unnamed = SOURCES.flatMap(sourceFiles).flatMap((path) =>
      selects(path).flatMap(({ table, select, line }) =>
        embedsOf(select, table)
          .filter(
            (embed) => !embed.named && pairs.has([embed.parent, embed.table].sort().join('|')),
          )
          .map((embed) => `${relative(ROOT, path)}:${line} ${embed.parent} → ${embed.table}`),
      ),
    );
    expect(unnamed).toEqual([]);
  }, 30_000);
});
