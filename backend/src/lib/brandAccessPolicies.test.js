import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { brandScopedTables } from './demo/coverage.js';

/**
 * Brand access (00388) reaches every brand table through the brands table
 * (00389). A table's policy that reads its brand from public.brands follows
 * the brands policies, because PostgreSQL applies them inside that subquery
 * too; one that calls the access rule (can_access_brand, user_brand_ids)
 * applies it itself. A policy that looks only at the organization or the
 * person lets a Selected-brands person read every brand's rows.
 *
 * Read from the migrations:
 *   * a brand table (one with a brand_id) passes when every top-level OR
 *     branch of each client policy condition ties the row's own brand_id to
 *     brands (by the brand's id) or to the access rule. A row with no brand
 *     passes only for admins and All-brands people (`brand_id is null and
 *     (select public.user_has_all_brands())`), or for people who can access
 *     every brand it touched (`brand_id is null and touched_brand_ids <@
 *     array(select public.user_brand_ids())`, 00436), except on the person's
 *     own rows listed below;
 *   * a table without a brand_id passes when each branch reaches, by the row
 *     it names, a table that passes (a draft, a chat, a change that went
 *     live…), or by the rows of a passing table that name it (an Account's
 *     sign-in, by the brands that use it, 00470), or calls
 *     content_draft_member() or can_see_chat_agent() (an
 *     agent's brands are in its version's scope, 00436); otherwise it is on the list
 *     below of Account-level tables, with why, or on the list of tables a
 *     later PR takes, which must be empty before anyone can be narrowed.
 *   * a subquery with union, intersect or except doesn't count, nor an
 *     `exists` that ties brands to another table's brand_id.
 * Policies for the service role, policies that refuse everyone (`false`) and
 * restrictive ones (they only narrow) don't count.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const migrations = files.map((file) => readFileSync(new URL(file, dir), 'utf8'));

/**
 * Brand tables with no client policy: only the server (service role) reads and
 * writes them, and checks brand access itself (BRAND-ACCESS PR 7).
 */
const SERVER_ONLY = [
  'action_candidates',
  'action_task_runs',
  'brand_fact_pages',
  'chat_tool_cache',
  'citation_rollup_rebuilds',
  'cited_page_features',
  'cloro_pending_tasks',
  'competitor_timeline_scans',
  'insights_rollup_rebuilds',
  'jobs',
  'mentions_entities_daily',
  'mentions_perception_snapshots',
  'mentions_terms_daily',
  'prompt_improve_suggestions',
  'signal_runs',
  'suggestion_relevance_usage',
];

/**
 * Tables without a brand_id whose client policies don't reach a brand: the
 * Account's or the person's own.
 */
const NOT_BRAND_DATA = {
  add_on_purchases: "The Account's purchases, for its admins (BRAND-ACCESS D1).",
  agent_token_usage: "A person's own monthly token use with the old Agent.",
  ai_bot_usage: "The Account's AI bot event meter against the plan (D1).",
  api_keys: "A person's own API keys; a key carries its owner's brand access (PR 10).",
  chat_auto_choices: "A person's own Chat tool choices.",
  chat_settings: "The Account's Chat settings (D1).",
  chat_skills:
    "The Account's own Chat skills (00458): instructions for every brand, no brand's data.",
  chat_storage_usage: "The Account's Chat storage meter against the plan (D1).",
  chat_uploads:
    "A person's own uploads stay theirs; the others follow their chat (chat_conversations).",
  chat_user_prefs: "A person's own Chat preferences.",
  chat_whats_new_reads:
    "A person's own What's new read marks (00464): which product updates they read, no brand's data.",
  cloro_countries: 'The list of countries a prompt can track, the same for everyone.',
  content_authors: "The Account's authors for content (Settings › Authors).",
  content_rule_sets: "The Account's content rules.",
  integration_connections:
    "The Account's own Google connection (00045): connected or not, and Composio's ids, written by the server; which brands use it, and each brand's property, are brand_integrations' and the brand's (00470).",
  invitations: "The Account's invitations, for its admins (00390).",
  organization_menu_roles: "The Account's menu access by role (00374).",
  organizations: 'The Account itself: its plan, billing and members (D1).',
  profiles: "A person's own profile.",
  site_audit_auto_runs:
    "The Account's monthly auto-audit runs: slots and audit ids; each audit's rows are its brand's.",
  site_audit_settings: "The Account's auto-audit switch.",
  white_label_kits: "The Account's white-label kit, shared by its brands (00429).",
};

/**
 * Tables without a brand_id that hold a brand's data but don't reach it yet,
 * and the BRAND-ACCESS PR that takes them. Nobody can be narrowed while this
 * list has a table (the last test below). PR 14 took the last one: Google is
 * per brand (00470, brand_integrations), and integration_connections is the
 * Account's own connection.
 */
const DEFERRED = {};

/**
 * A person's own rows, read by them (and admins, who have All brands), where a
 * row with no brand stays readable whatever brands they see: what they wrote
 * or did themselves, and the workspace's memory, which is every member's.
 * Keys: `table: policy`.
 */
const OWN_ROWS_WITHOUT_BRAND = {
  'agent_conversations: users read own conversations':
    'The old Agent: only the person who wrote the chat reads it.',
  'agent_conversations: users write own conversations':
    'The old Agent: only the person who wrote the chat changes it.',
  'chat_conversations: chat_conversations: author select':
    'The author’s own chat with no brand stays theirs (BRAND-ACCESS §9 Q4 hides chats about a brand).',
  'chat_activity_log: chat_activity_log: own or admin select':
    'Chat’s change log: the person who acted, or an admin.',
  'chat_access_requests: chat_access_requests: own or admin select':
    'A request to the admins: the person who asked, or an admin.',
  'chat_notices: chat_notices: own select':
    "A person's own notes from the system (00446): one about a brand only where they reach it; one about the workspace's AI key has none.",
  'chat_notices: chat_notices: own read':
    "A person marks their own notice read or closes it (00441, 00446): it changes no one else's, and they read only those about brands they reach.",
  'chat_schedules: chat_schedules: own or admin select':
    'A scheduled job about the whole workspace: the person who made it (its runs act as them), or an admin.',
  'chat_memory_items: chat_memory_items: own select':
    'A person’s own Me memory (00459): only they read it, and it never has a brand.',
  'chat_memory_items: chat_memory_items: workspace select':
    'The workspace’s memory (00459): its rules for every brand and member, no brand’s data; a brand’s facts are its own lines.',
};

/** Roles that bypass RLS: a policy for them only is the server's. */
const SERVER_ROLES = new Set(['service_role', 'postgres', 'supabase_admin']);

/** Functions that apply brand access, which anon may not run. */
const ACCESS_CALL =
  /\b(?:public\.)?(?:can_access_brand|user_brand_ids|user_has_all_brands|content_draft_member|can_see_chat_agent)\s*\(/i;

/** Rows from more than one query: what they bind to can't be read from the first. */
const SET_OPERATION = /\b(?:union|intersect|except)\b/i;

/**
 * The conditions that tie a table's own brand_id to brand access: the access
 * rule, the brand's own id from brands (whose policies apply inside), or
 * false. An `exists` names the table's brand_id with the table, so it can't
 * be another table's.
 */
function brandBindings(table) {
  const column = String.raw`(?:${table}\.)?brand_id`;
  return [
    new RegExp(String.raw`^${column} in \( ?select (?:public\.)?user_brand_ids\(\) ?\)$`, 'i'),
    new RegExp(
      String.raw`^(?:select )?(?:public\.)?can_access_brand\( ?${column} ?(?:, ?auth\.uid\(\) ?)?\)$`,
      'i',
    ),
    new RegExp(
      String.raw`^${column} in \( ?select (?:distinct )?(\w+)\.id from \(* ?(?:public\.)?brands (?:as )?\1\b`,
      'i',
    ),
    new RegExp(
      String.raw`^exists \( ?select 1 from \(* ?(?:public\.)?brands (?:as )?(\w+)\b.*\b\1\.id = \(*${table}\.brand_id\b`,
      'i',
    ),
    /^false$/i,
  ];
}

/** `brand_id is null`: on its own only for OWN_ROWS_WITHOUT_BRAND. */
const noBrand = (table) => new RegExp(String.raw`^(?:${table}\.)?brand_id is null$`, 'i');

/** `(select public.user_has_all_brands())`: with no brand, admins and All-brands people. */
const ALL_BRANDS = /^(?:select )?(?:public\.)?user_has_all_brands\(\)$/i;

/**
 * `touched_brand_ids <@ array(select public.user_brand_ids())`: with no brand,
 * people who can access every brand it touched (00436).
 */
const TOUCHED = (table) =>
  new RegExp(
    String.raw`^(?:${table}\.)?touched_brand_ids <@ array ?\( ?select (?:public\.)?user_brand_ids\(\) ?\)$`,
    'i',
  );

/** content_draft_member(draft): the draft's brand, by can_access_brand (00390). */
const DRAFT_MEMBER = /^(?:public\.)?content_draft_member\( ?\w+ ?\)$/i;

/** can_see_chat_agent(agent): its version's scope's brands, by user_brand_ids (00436). */
const AGENT_MEMBER = /^(?:public\.)?can_see_chat_agent\( ?(?:chat_agents\.)?id ?\)$/i;

/** `<column> in (select <a>.id from <table> <a> …)`: the row of `table` the column names. */
const PARENT_ROW =
  /^\w+ in \( ?select (?:(\w+)\.)?id from \(* ?(?:public\.)?(\w+)(?: (?:as )?(\w+))?/i;

/**
 * `id in (select <a>.<column> from <table> <a> …)`: a row that rows of `table`
 * name, read through that table's policies (00470: an Account's sign-in, by
 * the brands that use it).
 */
const NAMED_BY_ROW = /^id in \( ?select (\w+)\.\w+ from \(* ?(?:public\.)?(\w+) (?:as )?\1\b/i;

const name = (raw) =>
  raw
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();

const roleList = (raw) =>
  raw
    .replace(/"/g, '')
    .toLowerCase()
    .split(',')
    .map((role) => role.trim());

/** Comments out of a migration. */
const uncommented = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * A DO block that runs the same statements for a list of tables (00278's
 * catalog policies), written out as the statements it runs.
 */
function expandLoops(sql) {
  return sql.replace(/\bdo \$(\w*)\$([\s\S]*?)\$\1\$/gi, (block, _tag, body) => {
    const loop = body.match(/foreach (\w+) in array array\[([^\]]*)\]/i);
    if (!loop) return block;
    const tables = [...loop[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const formats = [
      ...body.matchAll(/execute format\(\s*'((?:[^']|'')*)'((?:\s*,[^,;)]+)*)\s*\)/gi),
    ];
    const value = (arg, table) =>
      arg
        .split('||')
        .map((part) => part.trim())
        .map((part) => (part === loop[1] ? table : part.replace(/^'|'$/g, '')))
        .join('');
    const out = [];
    for (const table of tables) {
      for (const [, template, args] of formats) {
        const values = args
          .split(',')
          .slice(1)
          .map((arg) => value(arg, table));
        let i = 0;
        out.push(template.replace(/''/g, "'").replace(/%I/g, () => `"${values[i++]}"`));
      }
    }
    return `${out.join(';\n')};`;
  });
}

/** A migration's statements on one line each: comments and function bodies left out. */
function statements(sql) {
  return expandLoops(uncommented(sql))
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim());
}

/**
 * The policies and the tables with RLS on, once every migration has run, as
 * pg_policies and pg_class would show them; and the policy statements that
 * name a table no earlier migration created (a fresh install, which runs the
 * migrations in order, would fail on them).
 */
function policyState() {
  const policies = new Map();
  const rls = new Set();
  const created = new Set();
  const early = [];
  const of = (table) => {
    if (!policies.has(table)) policies.set(table, new Map());
    return policies.get(table);
  };
  migrations.forEach((sql, i) => {
    for (const text of statements(sql)) {
      let m;
      const target = text.match(
        /^(?:create|alter|drop) policy (?:if exists )?(?:"[^"]+"|\S+) on ([\w."]+)/i,
      );
      if (target && !name(target[1]).includes('.') && !created.has(name(target[1]))) {
        early.push(`${files[i]}: ${name(target[1])}`);
      }
      if ((m = text.match(/^create table (?:if not exists )?([\w."]+)/i))) {
        created.add(name(m[1]));
      } else if ((m = text.match(/^create policy ("[^"]+"|\S+) on ([\w."]+) ?(.*)$/i))) {
        const rest = m[3].replace(/"/g, '');
        const head = rest.split(/\b(?:using|with check)\b/i)[0];
        of(name(m[2])).set(name(m[1]), {
          command: (
            head.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? 'all'
          ).toLowerCase(),
          restrictive: /\bas restrictive\b/i.test(head),
          roles: roleList(head.match(/\bto ([\w, ]+?)\s*$/i)?.[1] ?? 'public'),
          body: rest.slice(head.length),
        });
      } else if ((m = text.match(/^drop policy (?:if exists )?("[^"]+"|\S+) on ([\w."]+)/i))) {
        policies.get(name(m[2]))?.delete(name(m[1]));
      } else if ((m = text.match(/^alter policy ("[^"]+"|\S+) on ([\w."]+) (.*)$/i))) {
        const kept = policies.get(name(m[2]));
        const found = kept?.get(name(m[1]));
        const to = m[3].match(/^to ([\w", ]+?)(?: using| with check|$)/i);
        const body = m[3].match(/\b(using|with check)\b.*$/i);
        const renamed = m[3].match(/^rename to ("[^"]+"|\S+)/i);
        if (found && to) found.roles = roleList(to[1]);
        if (found && body) found.body = body[0].replace(/"/g, '');
        if (found && renamed) {
          kept.delete(name(m[1]));
          kept.set(name(renamed[1]), found);
        }
      } else if (
        (m = text.match(/^drop table (?:if exists )?([\w.", ]+?)(?: cascade| restrict)?$/i))
      ) {
        for (const table of m[1].split(',')) {
          policies.delete(name(table.trim()));
          rls.delete(name(table.trim()));
          created.delete(name(table.trim()));
        }
      } else if (
        (m = text.match(/^alter table (?:if exists )?(?:only )?([\w."]+) rename to ([\w."]+)$/i))
      ) {
        const kept = policies.get(name(m[1]));
        policies.delete(name(m[1]));
        if (kept) policies.set(name(m[2]), kept);
        if (rls.delete(name(m[1]))) rls.add(name(m[2]));
        if (created.delete(name(m[1]))) created.add(name(m[2]));
      } else if (
        (m = text.match(
          /^alter table (?:if exists )?(?:only )?([\w."]+) (enable|disable) row level security$/i,
        ))
      ) {
        if (m[2].toLowerCase() === 'enable') rls.add(name(m[1]));
        else rls.delete(name(m[1]));
      }
    }
  });
  return { policies, rls, early };
}

/**
 * Policy statements a migration runs from inside a function or DO body that
 * expandLoops doesn't write out: this test can't read them.
 */
function hiddenPolicyStatements() {
  const hidden = [];
  migrations.forEach((sql, i) => {
    for (const [, , body] of expandLoops(uncommented(sql)).matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)) {
      if (/\b(?:create|alter)\s+policy\b/i.test(body)) hidden.push(files[i]);
    }
  });
  return hidden;
}

const { policies, rls, early } = policyState();
const brandTables = brandScopedTables(migrations);

/** The policies that let a signed-in person (or anon) in: permissive, for a client role, not `false`. */
function clientPolicies(table) {
  return [...(policies.get(table)?.entries() ?? [])]
    .map(([policyName, p]) => ({
      name: policyName,
      ...p,
    }))
    .filter(
      (p) =>
        !p.restrictive &&
        p.roles.some((role) => !SERVER_ROLES.has(role)) &&
        !/^(?:using \(\s*false\s*\)\s*)?(?:with check \(\s*false\s*\)\s*)?$/i.test(p.body.trim()),
    );
}

/** The index of the parenthesis that closes the one at `open`. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** A policy's `using (…)` and `with check (…)` conditions. */
function conditions(body) {
  const found = [];
  const start = /\b(using|with check) \(/gi;
  let m;
  while ((m = start.exec(body))) {
    const open = m.index + m[0].length - 1;
    const end = closing(body, open);
    found.push(body.slice(open + 1, end));
    start.lastIndex = end + 1;
  }
  return found;
}

/** Without the parentheses around the whole of it. */
function unwrap(expr) {
  let text = expr.trim();
  while (text.startsWith('(') && closing(text, 0) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** The parts of `expr` between its top-level `and`s or `or`s. */
function split(expr, word) {
  const parts = [];
  const at = new RegExp(`^${word}\\b`, 'i');
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
    else if (depth === 0 && expr[i] === ' ' && at.test(expr.slice(i + 1))) {
      parts.push(expr.slice(start, i));
      start = i + 1 + word.length;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Whether every row the condition lets in passes `rule`: each top-level OR
 * branch has a conjunct `rule.binds` accepts, a parenthesized conjunct that
 * is bound itself, or `brand_id is null` together with user_has_all_brands()
 * or with every touched brand the person's (`rule.touched`), or alone on the
 * person's own rows (`rule.ownRows`). A conjunct with a set
 * operation never binds. String literals are left out first, so their words
 * don't count.
 */
function bound(condition, rule) {
  const text = unwrap(condition.replace(/'(?:[^']|'')*'/g, "''"));
  const branches = split(text, 'or');
  if (branches.length > 1) return branches.every((branch) => bound(branch, rule));
  const parts = split(text, 'and').map((part) => [part, unwrap(part)]);
  if (
    rule.noBrand &&
    parts.some(([, inner]) => rule.noBrand.test(inner)) &&
    (rule.ownRows || parts.some(([, inner]) => ALL_BRANDS.test(inner) || rule.touched?.test(inner)))
  ) {
    return true;
  }
  return parts.some(
    ([part, inner]) =>
      !SET_OPERATION.test(inner) && (rule.binds(inner) || (inner !== part && bound(inner, rule))),
  );
}

/** Every condition of every client policy of the table is bound by `ruleFor(policy)`. */
function allBound(table, ruleFor) {
  return clientPolicies(table).every((p) => {
    const found = conditions(p.body);
    const rule = ruleFor(p.name);
    return found.length > 0 && found.every((condition) => bound(condition, rule));
  });
}

/** A brand table's rule: its own brand_id, tied to brand access. */
const brandRule = (table) => {
  const bindings = brandBindings(table);
  return (policy) => ({
    binds: (part) => bindings.some((binding) => binding.test(part)),
    noBrand: noBrand(table),
    touched: TOUCHED(table),
    ownRows: `${table}: ${policy}` in OWN_ROWS_WITHOUT_BRAND,
  });
};

const reaching = [];
const notReaching = [];
const serverOnly = [];
for (const table of brandTables) {
  if (clientPolicies(table).length === 0) serverOnly.push(table);
  else if (allBound(table, brandRule(table))) reaching.push(table);
  else notReaching.push(table);
}

/**
 * Tables without a brand_id, with client policies: each passes through the row
 * it names when that row's table passes, until no more do.
 */
const children = [...policies.keys()].filter(
  (table) => !brandTables.has(table) && table !== 'brands' && clientPolicies(table).length > 0,
);
const reached = new Set(reaching);
const childRule = () => ({
  binds: (part) => {
    if (DRAFT_MEMBER.test(part) || AGENT_MEMBER.test(part)) return true;
    const named = part.match(NAMED_BY_ROW);
    if (named && reached.has(named[2].toLowerCase())) return true;
    const m = part.match(PARENT_ROW);
    return !!m && (!m[1] || m[1] === m[3]) && reached.has(m[2].toLowerCase());
  },
});
for (let grew = true; grew;) {
  grew = false;
  for (const table of children) {
    if (!reached.has(table) && allBound(table, childRule)) {
      reached.add(table);
      grew = true;
    }
  }
}
const childrenReaching = children.filter((table) => reached.has(table));
const childrenNotReaching = children.filter((table) => !reached.has(table));

/**
 * Code that narrows someone to Selected brands: writes member_brands or sets
 * brand_scope (the Team screen, BRAND-ACCESS PR 12), in the web, the server or
 * a migration after 00388 (whose own grant only follows a Selected person).
 */
function narrowingCode() {
  const found = [];
  const writes =
    /\bfrom\(\s*['"]member_brands['"]\s*\)\s*\.\s*(?:insert|upsert|update)\b|\bbrand_scope['"]?\s*:\s*['"]selected['"]|\b(?:insert into|update)\s+(?:public\.)?(?:member_brands|profiles\s+set\s+brand_scope)\b/i;
  for (const root of ['../../../frontend/src/', '../../src/']) {
    const base = new URL(root, import.meta.url);
    for (const file of readdirSync(base, { recursive: true })) {
      if (!/\.(?:ts|tsx|js)$/.test(file) || /\.test\.|types\/supabase\.ts$/.test(file)) continue;
      if (writes.test(readFileSync(new URL(file, base), 'utf8'))) found.push(`${root}${file}`);
    }
  }
  files.forEach((file, i) => {
    if (file >= '00389' && writes.test(migrations[i].replace(/--[^\n]*/g, ''))) found.push(file);
  });
  return found;
}

describe('the brands policies (00389)', () => {
  const brands = policies.get('brands');
  const byCommand = (command) => [...brands.values()].filter((p) => p.command === command);

  it('keep one policy per command', () => {
    expect([...brands.values()].map((p) => p.command).sort()).toEqual([
      'delete',
      'insert',
      'select',
      'update',
    ]);
  });

  it('let a person read only the brands they can access', () => {
    const [read] = byCommand('select');
    expect(read.roles).toEqual(['authenticated']);
    // All brands: the row's own organization, so a brand being added reads back.
    expect(read.body).toMatch(
      /organization_id in \( select p\.organization_id from public\.profiles p where p\.id = auth\.uid\(\) and \(p\.role = 'admin' or p\.brand_scope = 'all'\) \)/,
    );
    // Selected brands: the access rule, once per query.
    expect(read.body).toMatch(/ or id in \(select public\.user_brand_ids\(\)\)/);
    // Looking the brand up by id would refuse a brand being added (insert … returning).
    expect(read.body).not.toMatch(/can_access_brand/);
  });

  it('let a person change or delete only the brands they can access, with the roles as before', () => {
    const [update] = byCommand('update');
    const [remove] = byCommand('delete');
    for (const write of [update, remove]) {
      expect(write.roles).toEqual(['authenticated']);
      expect(write.body).toMatch(/not is_demo/);
      expect(write.body).toMatch(/and id in \(select public\.user_brand_ids\(\)\)/);
    }
    const managers =
      /profiles\.role = any \(array\['admin'::public\.user_role, 'manager'::public\.user_role\]\)/;
    expect(update.body).toMatch(/^using \(.*\) with check \(.*\)$/);
    expect(update.body.match(new RegExp(managers.source, 'g'))).toHaveLength(2);
    expect(update.body.match(/user_brand_ids/g)).toHaveLength(2);
    expect(remove.body).toMatch(/profiles\.role = 'admin'::public\.user_role/);
  });

  it('leave adding a brand to admins and managers of the organization, as before', () => {
    const [add] = byCommand('insert');
    expect(add.body).toMatch(/^with check \( not is_demo and organization_id in \(/);
    expect(add.body).toMatch(
      /profiles\.role = any \(array\['admin'::public\.user_role, 'manager'::public\.user_role\]\)/,
    );
    expect(add.body).not.toMatch(/user_brand_ids|can_access_brand/);
  });
});

describe('every brand table answers to the brand’s access', () => {
  it('finds the brand tables and their policies', () => {
    expect(brandTables.size).toBeGreaterThan(90);
    expect(reaching.length).toBeGreaterThan(80);
    // Through brands: rows, rollups, the catalog's loop-made policies (00278), 00388's own;
    // through the access rule: 00390's and 00424's.
    for (const table of [
      'prompt_results',
      'insights_brand_daily',
      'competitors',
      'catalog_products',
      'catalog_variants',
      'member_brands',
      'prompt_usage_counters',
      'chat_conversations',
      'ship_events',
      'chat_schedules',
      'chat_memory_items',
      'brand_integrations',
    ]) {
      expect(reaching, table).toContain(table);
    }
  });

  it('keeps RLS on for every brand table', () => {
    expect([...brandTables].filter((table) => !rls.has(table))).toEqual([]);
  });

  it('ties every top-level branch of every client policy to the row’s brand', () => {
    // A table here is new or changed: tie each `or` branch of its policies to
    // brand_id, with `brand_id in (select public.user_brand_ids())` or a
    // subquery that selects the brand's own id from public.brands. A branch
    // through the organization (`organization_id in (…)`) lets a
    // Selected-brands person read every brand's rows. A row with no brand:
    // `brand_id is null and (select public.user_has_all_brands())`.
    expect(notReaching.sort()).toEqual([]);
  });

  it('lets a row with no brand stay open only on the person’s own rows, each with why', () => {
    for (const [key, why] of Object.entries(OWN_ROWS_WITHOUT_BRAND)) {
      const at = key.indexOf(': ');
      const [table, policy] = [key.slice(0, at), key.slice(at + 2)];
      // A key here no longer names a policy: take it off the list.
      expect(policies.get(table)?.has(policy), key).toBe(true);
      expect(policies.get(table).get(policy).body, key).toMatch(/brand_id is null or/);
      expect(why.length, key).toBeGreaterThan(20);
    }
  });

  it('lists the brand tables only the server reads and writes', () => {
    // A table here gained a client policy (it must reach the brand), or is a
    // new server-only one: say so in SERVER_ONLY.
    expect(serverOnly.sort()).toEqual([...SERVER_ONLY].sort());
  });
});

describe('every table without a brand_id', () => {
  it('reaches a brand through the row it belongs to', () => {
    for (const table of [
      'prompts',
      'prompt_notes',
      'action_tasks',
      'audit_signal_results',
      'content_draft_versions',
      'content_draft_inputs',
      'chat_messages',
      'chat_run_steps',
      'chat_asks',
      'chat_file_task_links',
      'impact_measurements',
      'impact_control_sets',
      'agent_messages',
      'chat_agents',
      'chat_agent_versions',
      'chat_agent_triggers',
      'chat_agent_go_live',
      'chat_schedule_runs',
      'chat_outbound_emails',
      'integration_accounts',
    ]) {
      expect(childrenReaching, table).toContain(table);
    }
  });

  it('reaches a brand, or is on the Account-level or the deferred list', () => {
    // A table here is new, or its policy changed: reach its brand through the
    // row it belongs to (`parent_id in (select p.id from public.<parent> p)`),
    // or, if it holds no brand's data, add it to NOT_BRAND_DATA with why.
    // A table on a list that now reaches a brand: take it off.
    expect(childrenNotReaching.sort()).toEqual(
      [...Object.keys(NOT_BRAND_DATA), ...Object.keys(DEFERRED)].sort(),
    );
  });

  it('defers tables only to a later BRAND-ACCESS PR', () => {
    for (const [table, pr] of Object.entries(DEFERRED)) expect(pr, table).toMatch(/^PR \d+$/);
  });

  it('leaves no table deferred once someone can be narrowed to Selected brands (PR 12)', () => {
    // Writing member_brands or brand_scope turns the feature on: before that,
    // PR 14 (Google per brand) takes its table, and this list is empty.
    const narrowing = narrowingCode();
    if (narrowing.length > 0) {
      expect(Object.keys(DEFERRED), `narrowed by ${narrowing.join(', ')}`).toEqual([]);
    }
  });

  it('says why each Account-level table holds no brand’s data', () => {
    for (const [table, why] of Object.entries(NOT_BRAND_DATA)) {
      expect(why.length, table).toBeGreaterThan(20);
    }
  });
});

describe('how the migrations write policies', () => {
  it('runs every policy statement where this test reads it', () => {
    // A policy made inside a function or DO block is invisible here: write
    // it as a statement, or as 00278's loop over a table list.
    expect(hiddenPolicyStatements()).toEqual([]);
  });

  it('gives policies that apply brand access to signed-in people (or the server) only', () => {
    // anon may not run the access functions (00388, 00215).
    const wrong = [];
    for (const [table, kept] of policies) {
      for (const [policy, p] of kept) {
        const roles = new Set(p.roles);
        roles.delete('authenticated');
        roles.delete('service_role');
        if (ACCESS_CALL.test(p.body) && roles.size > 0) wrong.push(`${table}: ${policy}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('makes no policy before its table, as a fresh install runs the migrations in order', () => {
    expect(early).toEqual([]);
  });
});
