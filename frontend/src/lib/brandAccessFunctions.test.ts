// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brand access (00388) in the security definer functions a signed-in person
 * can call. They read past RLS, so the brands policies (00389) don't narrow
 * them: each has to ask can_access_brand itself. One that still asks only
 * whether the brand belongs to the caller's organization (brands joined to the
 * caller's profile on organization_id) lets a Selected-brands person read any
 * brand of the Account.
 *
 * Read from supabase/schema.sql, every migration in order: each function's
 * last definition (by name and argument types), `alter function … security
 * …`, `drop function`, and the grants and revokes that decide whether
 * authenticated may run it. Supabase grants execute on a new function to
 * anon, authenticated and service_role (schema.sql's default privileges), so
 * only a revoke from authenticated takes it away.
 *
 * A function fails when it checks only the organization: the organization
 * check above, or, with no call to an access helper (can_access_brand,
 * user_brand_ids, user_has_all_brands, content_draft_member), a p_brand_id
 * argument or a look at the caller's organization (auth.uid() and
 * organization_id). Those not converted yet are listed below with the
 * BRAND-ACCESS PR that takes them, and nobody can be narrowed to Selected
 * brands until that list is empty (PR 12), as
 * backend/src/lib/brandAccessPolicies.test.js says of the tables; those that
 * hold no brand's data are listed with why.
 *
 * It lives in the web, not next to the server's brand-access tests, so the
 * web's checks run it where the server's packages aren't installed.
 */

const ROOT = join(__dirname, '../../..');
const SCHEMA = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');

/** BRAND-ACCESS PR 4: the citation and report functions. */
const CITATIONS = '00426_brand_access_citation_functions.sql';
const CONVERTED_IN_CITATIONS = [
  'citations_window_stats',
  'citation_url_candidates',
  'citation_url_occurrences',
  'citations_domains',
  'citations_urls',
  'citation_gap_domains',
  'citation_competitor_sources',
  'citations_urls_daily',
  'citation_gap_domains_daily',
  'citation_competitor_sources_daily',
  'report_citation_evidence',
];

/**
 * BRAND-ACCESS PR 5: the Insights, Mentions and Topics functions. Unlike the
 * citation functions they let the service role through, as before.
 */
const INSIGHTS = '00434_brand_access_insights_functions.sql';
const CONVERTED_IN_INSIGHTS = [
  'insights_same_prompt_compare',
  'insights_same_prompt_compare_daily',
  'insights_change_drivers',
  'insights_change_drivers_daily',
  'insights_topic_competitors_daily',
  'head_to_head_daily',
  'prompt_visibility_summaries',
  'prompt_position_summaries_json',
  'topics_overview_window',
  'mentions_overview',
  'mentions_list',
  'mentions_perception',
];

/**
 * BRAND-ACCESS PR 6: the AI traffic, content and shopping functions. Their
 * reads let the service role through, as before; the writes act for the
 * person the service role names (p_user_id), or for the caller.
 */
const TRAFFIC_CONTENT_SHOPPING = '00435_brand_access_traffic_content_shopping_functions.sql';
/**
 * Writes with their own organization and role check (admins and managers),
 * the brand read from the row they change: 00435 adds brand access beside it.
 */
const WRITES_IN_TRAFFIC_CONTENT_SHOPPING = [
  'approve_action_task_review',
  'override_mention_sentiment',
  'seed_kpi_presets',
];
const CONVERTED_IN_TRAFFIC_CONTENT_SHOPPING = [
  // AI traffic.
  'ai_bot_report',
  'ai_traffic_broken_links',
  'ai_traffic_conversions',
  'ai_traffic_google_pages',
  'ai_traffic_page_citations',
  'ai_traffic_pages',
  'brand_ai_conversions',
  // Content: a page's or plan's brand, or a draft's (the two with p_draft_id).
  'content_draft_cited_answers',
  'content_draft_sources',
  'content_page_conversions',
  'content_page_impact',
  'content_page_overlap',
  'content_page_results',
  'content_plan_insights',
  'content_plan_pages',
  'content_start_prompts',
  // Shopping and the catalog.
  'catalog_product_ai_stats',
  'shopping_amazon_share_weekly',
  'shopping_merchant_split',
  'shopping_own_product_offers',
  ...WRITES_IN_TRAFFIC_CONTENT_SHOPPING,
];

/**
 * Functions a signed-in person can call that still check only the
 * organization, and the BRAND-ACCESS PR that takes them. A function here that
 * now checks brand access: take it off.
 */
const TO_CONVERT: Record<string, string> = {};

/**
 * Functions a signed-in person can call that look at the caller's organization
 * (auth.uid() and organization_id) without an access helper, and need no brand
 * check: why.
 */
const NO_BRAND_CHECK: Record<string, string> = {
  can_access_brand: 'The access rule itself (00388): whether the caller may see one brand.',
  org_brand_count:
    "The plan's brand count (maxBrands, 00390): the Account's total, no brand's name or figure (BRAND-ACCESS §9 Q3).",
  user_brand_ids: 'The access rule as a list (00388): the ids of the brands the caller may see.',
  user_has_all_brands:
    'Whether the caller is an admin or has All brands (00390), for rows with no brand.',
};

/** The organization check: brands joined to the caller's profile on organization_id. */
const ORGANIZATION_CHECK =
  /\bfrom (?:public\.)?brands (\w+) join (?:public\.)?profiles (\w+) on \2\.organization_id = \1\.organization_id where \1\.id = \w+ and \2\.id = auth\.uid\(\)/;

/** A call to a function that applies brand access (00388, 00390; content_draft_member asks can_access_brand). */
const ACCESS_HELPER =
  /\b(?:can_access_brand|user_brand_ids|user_has_all_brands|content_draft_member)\s*\(/;

interface Statement {
  text: string;
  migration: string;
}

interface Definition {
  migration: string;
  header: string;
  body: string;
}

interface Fn {
  name: string;
  args: string;
  definitions: Definition[];
  securityDefiner: boolean;
  authenticated: boolean;
}

/** Where a string literal that opens at `open` ends; E'…' strings escape with a backslash. */
function stringEnd(sql: string, open: number): number {
  const escapes = /[eE]/.test(sql[open - 1] ?? '') && !/\w/.test(sql[open - 2] ?? '');
  let i = open + 1;
  while (i < sql.length) {
    if (escapes && sql[i] === '\\') i += 2;
    else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
    else if (sql[i] === "'") return i + 1;
    else i++;
  }
  return i;
}

/** The `$tag$` that opens a dollar-quoted body at `i`, if one does. */
function dollarTag(sql: string, i: number): string | null {
  if (sql[i] !== '$' || /\w/.test(sql[i - 1] ?? '')) return null;
  return /^\$\w*\$/.exec(sql.slice(i, i + 64))?.[0] ?? null;
}

/** Where the code after `from` starts: past whitespace and comments. */
function codeStart(sql: string, from: number): number {
  let i = from;
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else {
      return i;
    }
  }
}

/** schema.sql's statements, each with the migration it comes from (build-schema.sh's markers). */
function statements(sql: string): Statement[] {
  const markers = [...sql.matchAll(/^-- migrations\/(\S+\.sql)$/gm)].map((m) => ({
    at: m.index ?? 0,
    file: m[1],
  }));
  const migrationAt = (at: number) => markers.filter((m) => m.at <= at).pop()?.file ?? '';
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'") {
      i = stringEnd(sql, i);
      continue;
    }
    const tag = dollarTag(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
      continue;
    }
    if (sql[i] === ';') {
      const at = codeStart(sql, start);
      if (at < i) out.push({ text: sql.slice(at, i), migration: migrationAt(at) });
      start = i + 1;
    }
    i++;
  }
  return out;
}

/** The index of the parenthesis that closes the one at `open`; strings and comments skipped. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'") i = stringEnd(text, i) - 1;
    else if (text.startsWith('--', i))
      i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** A list split on its top-level commas. */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "'") i = stringEnd(list, i) - 1;
    else if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Words a type starts with that are followed by more of it (timestamp with time zone…). */
const TYPE_STARTS = new Set(['timestamp', 'time', 'double', 'character', 'bit', 'interval']);

const TYPE_NAMES: Record<string, string> = {
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  float8: 'double precision',
  'character varying': 'varchar',
};

/** The argument types that identify a function: `p_x uuid default null, p_y text` → uuid, text. */
function argumentTypes(args: string): string[] {
  return topLevel(args.replace(/--[^\n]*/g, '')).flatMap((arg) => {
    let text = arg
      .replace(/"/g, '')
      .replace(/\s+(?:default\b|=)[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const mode = text.match(/^(in|out|inout|variadic) /);
    if (mode) text = text.slice(mode[0].length);
    if (mode?.[1] === 'out') return [];
    const words = text.split(' ');
    if (words.length > 1 && !TYPE_STARTS.has(words[0])) text = words.slice(1).join(' ');
    const array = text.endsWith('[]') ? '[]' : '';
    const base = text.replace(/\[\]$/, '').replace(/^public\./, '');
    return [`${TYPE_NAMES[base] ?? base}${array}`];
  });
}

/** `public.f(uuid, text), g` → the functions named, with their argument types when given. */
function functionRefs(list: string): { name: string; types: string[] | null }[] {
  const refs: { name: string; types: string[] | null }[] = [];
  let rest = list.trim();
  while (rest) {
    const m = rest.match(/^(?:"?public"?\s*\.\s*)?"?(\w+)"?\s*/i);
    if (!m) break;
    rest = rest.slice(m[0].length);
    let types: string[] | null = null;
    if (rest.startsWith('(')) {
      const end = closing(rest, 0);
      types = argumentTypes(rest.slice(1, end));
      rest = rest.slice(end + 1).trim();
    }
    refs.push({ name: m[1].toLowerCase(), types });
    rest = rest.replace(/^,\s*/, '');
  }
  return refs;
}

const uncommented = (text: string) =>
  text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const roles = (list: string) =>
  list
    .replace(/"/g, '')
    .toLowerCase()
    .split(/\s*,\s*/);

/** Every public function once every migration has run, keyed by name and argument types. */
function functionState(all: Statement[]): Map<string, Fn> {
  const fns = new Map<string, Fn>();
  const matching = (name: string, types: string[] | null) =>
    [...fns.entries()].filter(
      ([key, fn]) => fn.name === name && (types === null || key === `${name}(${types.join(', ')})`),
    );
  for (const { text, migration } of all) {
    const create = text.match(
      /^create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?(\w+)"?\s*\(/i,
    );
    if (create) {
      const name = create[1].toLowerCase();
      const open = create[0].length - 1;
      const end = closing(text, open);
      const args = uncommented(text.slice(open + 1, end));
      let header = text;
      let body = '';
      for (let i = end; i < text.length; i++) {
        if (text[i] === "'") i = stringEnd(text, i) - 1;
        const tag = dollarTag(text, i);
        if (tag) {
          const close = text.indexOf(tag, i + tag.length);
          body = text.slice(i + tag.length, close);
          header = `${text.slice(0, i)} $$ ${text.slice(close + tag.length)}`;
          break;
        }
      }
      header = oneLine(uncommented(header)).toLowerCase();
      const key = `${name}(${argumentTypes(args).join(', ')})`;
      const fn = fns.get(key) ?? {
        name,
        args,
        definitions: [],
        securityDefiner: false,
        authenticated: true,
      };
      fn.args = args;
      fn.securityDefiner = /\bsecurity definer\b/.test(header);
      fn.definitions.push({ migration, header, body });
      fns.set(key, fn);
      continue;
    }
    const line = oneLine(uncommented(text));
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^drop function (?:if exists )?(.+?)(?: cascade| restrict)?$/i))) {
      for (const ref of functionRefs(m[1])) {
        for (const [key] of matching(ref.name, ref.types)) fns.delete(key);
      }
    } else if ((m = line.match(/^alter function (.+?\)|[\w."]+) security (definer|invoker)$/i))) {
      for (const ref of functionRefs(m[1])) {
        for (const [, fn] of matching(ref.name, ref.types)) {
          fn.securityDefiner = m[2].toLowerCase() === 'definer';
        }
      }
    } else if (
      (m = line.match(
        /^(grant|revoke) (?:grant option for )?[\w, ]+? on function (.+) (?:to|from) ([\w", ]+?)(?: cascade| restrict| with grant option)?$/i,
      ))
    ) {
      if (!roles(m[3]).includes('authenticated')) continue;
      for (const ref of functionRefs(m[2])) {
        for (const [, fn] of matching(ref.name, ref.types)) {
          fn.authenticated = m[1].toLowerCase() === 'grant';
        }
      }
    }
  }
  return fns;
}

/** A function body on one line, its comments left out, for the checks above. */
const code = (body: string) => oneLine(uncommented(body)).toLowerCase().replace(/"/g, '');

const hasBrandArgument = (fn: Fn) => /(?:^|,)\s*(?:in\s+)?"?p_brand_id"?\s/i.test(fn.args);

const all = statements(SCHEMA);
const fns = functionState(all);

const last = (fn: Fn) => fn.definitions[fn.definitions.length - 1];

/** What a signed-in person can call: security definer, execute for authenticated, not a trigger. */
const callable = [...fns.values()].filter(
  (fn) =>
    fn.securityDefiner &&
    fn.authenticated &&
    !/\breturns "?(?:event_)?trigger\b/.test(last(fn).header),
);

/**
 * Checks only the organization: the organization check; or no access helper,
 * and a brand argument or a look at the caller's organization (auth.uid() and
 * organization_id).
 */
const organizationOnly = (fn: Fn) => {
  const body = code(last(fn).body);
  if (ORGANIZATION_CHECK.test(body)) return true;
  if (ACCESS_HELPER.test(body)) return false;
  return hasBrandArgument(fn) || (/\bauth\.uid\(\)/.test(body) && /\borganization_id\b/.test(body));
};

const byName = (name: string) => callable.filter((fn) => fn.name === name);

/** The migrations after 00388 in schema.sql, by file. */
function migrationsAfter(file: string): Map<string, string> {
  const texts = new Map<string, string>();
  const parts = SCHEMA.split(/^-- migrations\/(\S+\.sql)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] > file) texts.set(parts[i], parts[i + 1]);
  }
  return texts;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx|js)$/.test(entry) && !/\.test\.\w+$/.test(entry) ? [path] : [];
  });
}

/**
 * Code that narrows someone to Selected brands: writes member_brands or
 * brand_scope, whatever the value (the Team screen, BRAND-ACCESS PR 12), in the
 * web, the server or a migration after 00388 (whose own grant only follows a
 * Selected person). A brand_scope key in an object counts (an insert or update
 * payload); Chat's `case 'brand_scope':` denial code doesn't, and nor does a
 * key set to the literal 'all' (the server's All-brands default for a profile
 * read before 00388): it can only widen, never narrow.
 */
function narrowingCode(): string[] {
  const writes = new RegExp(
    [
      String.raw`\bfrom\(\s*['"]member_brands['"]\s*\)\s*\.\s*(?:insert|upsert|update)\b`,
      String.raw`(?<!\bcase\s+['"])\bbrand_scope['"]?\s*:(?!:)(?!\s*['"]all['"])`,
      String.raw`\binsert\s+into\s+(?:public\.)?(?:member_brands\b|profiles\s*\([^)]*\bbrand_scope\b)`,
      String.raw`\bupdate\s+(?:public\.)?profiles\s+set\b[^;]*?\bbrand_scope\s*=`,
    ].join('|'),
    'i',
  );
  const found = [join(ROOT, 'frontend/src'), join(ROOT, 'backend/src')]
    .flatMap(sourceFiles)
    .filter((path) => !path.endsWith('types/supabase.ts'))
    .filter((path) => writes.test(readFileSync(path, 'utf8')));
  for (const [file, text] of migrationsAfter('00388_brand_access.sql')) {
    if (writes.test(text.replace(/--[^\n]*/g, ''))) found.push(file);
  }
  return found;
}

/**
 * A body with its brand check, old or new, written as `<check p_brand_id>`:
 * the brand argument's, or `<check v_brand_id>` for a draft's brand.
 */
function withoutCheck(body: string): string {
  return oneLine(body)
    .replace(
      /select 1 from (?:public\.)?brands b join (?:public\.)?profiles pf on pf\.organization_id = b\.organization_id where b\.id = ([pv]_brand_id) and pf\.id = auth\.uid\(\)/gi,
      '<check $1>',
    )
    .replace(/select 1 where public\.can_access_brand\(p_brand_id\)/gi, '<check p_brand_id>')
    .replace(/\bnot exists \( (<check [pv]_brand_id>) \)/gi, 'not $1')
    .replace(/\bnot public\.can_access_brand\(([pv]_brand_id)\)/gi, 'not <check $1>');
}

/** A write's body without the brand access 00435 adds beside its organization and role check. */
const withoutAccess = (body: string) =>
  code(body).replace(/ and public\.can_access_brand\([\w.]+(?:, [\w.]+)?\)/g, '');

/**
 * A header read without "or replace": a function first made by `create
 * function` (after a drop) is replaced with `create or replace`.
 */
const replaced = (header: string) =>
  header.replace(/^create (?:or replace )?function\b/, 'create function');

describe('the security definer functions a signed-in person can call', () => {
  it('finds them, with their brand arguments and checks', () => {
    const withBrand = callable.filter(hasBrandArgument).map((fn) => fn.name);
    expect(withBrand.length).toBeGreaterThan(40);
    for (const name of ['citations_domains', 'mentions_perception', 'prompt_usage_summary']) {
      expect(withBrand, name).toContain(name);
    }
    // Revoked from authenticated: the server's only.
    for (const name of ['mentions_perception_live', 'competitor_cited_urls', 'reserve_ai_usage']) {
      expect(byName(name), name).toEqual([]);
      expect([...fns.values()].some((fn) => fn.name === name)).toBe(true);
    }
    // Turned security invoker (00014): RLS applies.
    expect(byName('share_of_voice_aggregates')).toEqual([]);
    // The organization check in its sql, plpgsql and draft shapes.
    for (const name of ['citations_window_stats', 'mentions_perception', 'content_draft_sources']) {
      const fn = [...fns.values()].find((found) => found.name === name);
      const checks = fn?.definitions.map((d) => ORGANIZATION_CHECK.test(code(d.body)));
      expect(checks, name).toContain(true);
    }
  });

  it('check brand access, or are listed to convert or as needing no brand check', () => {
    // A function here is new or changed: ask public.can_access_brand(p_brand_id)
    // (or user_brand_ids()) instead of the caller's organization. One that
    // holds no brand's data: add it to NO_BRAND_CHECK with why.
    const unlisted = callable
      .filter(organizationOnly)
      .map((fn) => fn.name)
      .filter((name) => !(name in TO_CONVERT) && !(name in NO_BRAND_CHECK));
    expect([...new Set(unlisted)].sort()).toEqual([]);
  });

  it('list only functions that still check the organization only', () => {
    // A function here now checks brand access, or is gone: take it off.
    const caught = new Set(callable.filter(organizationOnly).map((fn) => fn.name));
    const stale = [...Object.keys(TO_CONVERT), ...Object.keys(NO_BRAND_CHECK)].filter(
      (name) => !caught.has(name),
    );
    expect(stale).toEqual([]);
  });

  it('leave each function to a later BRAND-ACCESS PR, or say why it needs no brand check', () => {
    for (const [name, pr] of Object.entries(TO_CONVERT)) expect(pr, name).toMatch(/^PR \d+$/);
    for (const [name, why] of Object.entries(NO_BRAND_CHECK)) {
      expect(why.length, name).toBeGreaterThan(20);
      expect(TO_CONVERT, name).not.toHaveProperty(name);
    }
  });

  it('leave no function to convert once someone can be narrowed to Selected brands (PR 12)', () => {
    const narrowing = narrowingCode();
    if (narrowing.length > 0) {
      expect(Object.keys(TO_CONVERT), `narrowed by ${narrowing.join(', ')}`).toEqual([]);
    }
  });
});

/**
 * A wave of BRAND-ACCESS PR 4–6: each function's last definition asks
 * can_access_brand instead of the organization, keeps the rest of the one it
 * replaces and its grants, and says brand access in its comment. The service
 * role stays as it was: the citation functions never let it through, the
 * Insights, Mentions and Topics ones and the AI traffic, content and shopping
 * reads do (their callers check the brand). The writes (00435) keep their
 * organization and role check and ask brand access beside it, for the person
 * they act for.
 */
function describeWave(
  title: string,
  migration: string,
  names: string[],
  { serviceRoleThrough, writes = [] }: { serviceRoleThrough: boolean; writes?: string[] },
) {
  describe(title, () => {
    const converted = names.flatMap(byName);
    const reads = converted.filter((fn) => !writes.includes(fn.name));
    const written = converted.filter((fn) => writes.includes(fn.name));
    /** The wave's definition and the one it replaced; later migrations may redefine them again. */
    const pair = (fn: Fn) => {
      const at = fn.definitions.findIndex((d) => d.migration === migration);
      return { before: fn.definitions[at - 1], after: fn.definitions[at], at };
    };

    it('ask can_access_brand in their last definition, not the organization', () => {
      for (const name of names) expect(byName(name), name).toHaveLength(1);
      for (const name of writes) expect(names, name).toContain(name);
      for (const fn of converted) {
        expect(organizationOnly(fn), fn.name).toBe(false);
        expect(TO_CONVERT, fn.name).not.toHaveProperty(fn.name);
      }
      // The brand argument's, or a draft's brand (v_brand_id).
      for (const fn of reads) {
        expect(code(last(fn).body), fn.name).toMatch(/\bpublic\.can_access_brand\([pv]_brand_id\)/);
      }
      // The person a write acts for: the caller, or p_user_id under the service role.
      for (const fn of written) {
        expect(code(last(fn).body), fn.name).toMatch(
          /\bpublic\.can_access_brand\((?:p_brand_id|[\w.]+, p\.id)\)/,
        );
      }
    });

    it('keep the rest of the definition they replace, word for word', () => {
      // create or replace resets what a definition doesn't repeat: the
      // arguments, result, language, volatility, security definer and every
      // setting (search_path, work_mem, plan_cache_mode) stay as they were.
      for (const fn of converted) {
        const { before, after, at } = pair(fn);
        expect(at, fn.name).toBeGreaterThan(0);
        expect(replaced(after.header), fn.name).toBe(replaced(before.header));
        expect(after.header, fn.name).toMatch(/\bsecurity definer\b/);
      }
      // A read: only the check changes.
      for (const fn of reads) {
        const { before, after } = pair(fn);
        expect(withoutCheck(before.body), fn.name).toMatch(/<check [pv]_brand_id>/);
        expect(withoutCheck(after.body), fn.name).toBe(withoutCheck(before.body));
      }
      // A write: one condition more, beside its organization and role check.
      for (const fn of written) {
        const { before, after } = pair(fn);
        expect(withoutAccess(after.body), fn.name).toBe(code(before.body));
        expect(code(after.body), fn.name).toMatch(/\borganization_id\b/);
        expect(code(after.body), fn.name).toMatch(/'admin', 'manager'/);
      }
    });

    it(`${serviceRoleThrough ? 'still let' : "still don't let"} the service role through`, () => {
      // Before the brand check or after it, as the replaced definition had it.
      const through =
        /\bauth\.role\(\) is distinct from 'service_role' and not public\.can_access_brand\([pv]_brand_id\)|\bnot public\.can_access_brand\([pv]_brand_id\) and auth\.role\(\) is distinct from 'service_role'/;
      for (const fn of reads) {
        const body = code(pair(fn).after.body);
        if (serviceRoleThrough) expect(body, fn.name).toMatch(through);
        else expect(body, fn.name).not.toMatch(/service_role/);
      }
    });

    it(`keep their grants: ${migration.slice(0, 5)} grants and revokes nothing`, () => {
      const own = all.filter((statement) => statement.migration === migration);
      expect(own.length).toBeGreaterThan(names.length);
      expect(own.filter((s) => /^(?:grant|revoke)\b/i.test(s.text))).toEqual([]);
      for (const fn of converted) expect(fn.authenticated, fn.name).toBe(true);
    });

    it('say brand access in their comments', () => {
      const comments = all
        .filter((statement) => statement.migration === migration)
        .map((statement) => oneLine(statement.text))
        .filter((text) => /^comment on function/i.test(text));
      for (const name of names) {
        const own = comments.filter((text) =>
          text.startsWith(`comment on function public.${name}(`),
        );
        expect(own, name).toHaveLength(1);
        expect(own[0], name).toMatch(/can_access_brand/);
        expect(own[0], name).not.toMatch(
          /organization only|organization check|org-membership|member of the brand/i,
        );
        if (writes.includes(name)) continue;
        expect(own[0], name).toMatch(
          serviceRoleThrough ? /\bfor the service role\b/ : /\bthe service role included\b/,
        );
      }
    });
  });
}

describeWave('the citation and report functions (00426)', CITATIONS, CONVERTED_IN_CITATIONS, {
  serviceRoleThrough: false,
});

describeWave(
  'the Insights, Mentions and Topics functions (00434)',
  INSIGHTS,
  CONVERTED_IN_INSIGHTS,
  {
    serviceRoleThrough: true,
  },
);

describeWave(
  'the AI traffic, content and shopping functions (00435)',
  TRAFFIC_CONTENT_SHOPPING,
  CONVERTED_IN_TRAFFIC_CONTENT_SHOPPING,
  {
    serviceRoleThrough: true,
    writes: WRITES_IN_TRAFFIC_CONTENT_SHOPPING,
  },
);
