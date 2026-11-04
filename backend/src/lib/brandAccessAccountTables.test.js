import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * Brand access on the brand tables whose policies looked only at the
 * organization or the person (00390 for the Account's, 00424 for Chat's), on
 * content_draft_member(), the plan's quotas and invitations. Read from the
 * SQL, as the other migration tests here do: the repository has no database
 * tests. brandAccessPolicies.test.js checks that every brand table reaches
 * the brand; this one that nothing else in those policies changed, so people
 * with All brands (everyone, until the Team screen) see what they saw.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const ACCOUNT = '00390_brand_access_account_tables.sql';
const CHAT = '00424_brand_access_chat_tables.sql';
const TOUCHED = '00436_chat_touched_brands.sql';

/** A migration's SQL without its comments, on one line. */
const read = (file) =>
  readFileSync(new URL(file, dir), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A migration's statements, function bodies left out. */
const statements = (file) =>
  read(file)
    .replace(/\$(\w*)\$.*?\$\1\$/g, "''")
    .split(';')
    .map((text) => text.trim());

/** The last definition of a function, across every migration: its file, header and body. */
function lastFunction(name) {
  let last = null;
  const definition = new RegExp(
    `create (?:or replace )?function "?public"?\\."?${name}"?\\s*\\(([^$]*?)\\$\\$(.*?)\\$\\$`,
    'gi',
  );
  for (const file of files) {
    for (const m of read(file).matchAll(definition)) {
      last = { file, header: m[1].toLowerCase(), body: m[2] };
    }
  }
  if (!last) throw new Error(`No function ${name}`);
  return last;
}

/** A `create policy` statement's name, command, roles and conditions. */
function parsePolicy(file, policyName, rest) {
  const text = rest.replace(/"/g, '');
  const head = text.split(/\b(?:using|with check)\b/i)[0];
  return {
    file,
    name: policyName,
    command: (head.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? 'all').toLowerCase(),
    roles: head.match(/\bto ([\w, ]+?)\s*$/i)?.[1] ?? 'public',
    body: text.slice(head.length).trim(),
  };
}

/**
 * A table's policy statements in migration order: every `create policy`
 * (history) and the policies left once every migration has run (now).
 */
function policiesOf(table) {
  const on = `on (?:"?public"?\\.)?"?${table}"?`;
  const create = new RegExp(`^create policy "([^"]+)" ${on} (.*)$`, 'i');
  const drop = new RegExp(`^drop policy (?:if exists )?"([^"]+)" ${on}$`, 'i');
  const history = [];
  const now = new Map();
  for (const file of files) {
    for (const text of statements(file)) {
      let m;
      if ((m = text.match(create))) {
        const policy = parsePolicy(file, m[1], m[2]);
        history.push(policy);
        now.set(policy.name, policy);
      } else if ((m = text.match(drop))) {
        now.delete(m[1]);
      }
    }
  }
  return { history, now };
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

/** A policy body's `using (…)` and `with check (…)` conditions, without spaces, case or outer parentheses. */
function conditions(body) {
  const found = [];
  const start = /\b(using|with check) \(/gi;
  let m;
  while ((m = start.exec(body))) {
    const open = m.index + m[0].length - 1;
    const end = closing(body, open);
    let text = body.slice(open + 1, end).trim();
    while (text.startsWith('(') && closing(text, 0) === text.length - 1) {
      text = text.slice(1, -1).trim();
    }
    found.push(`${m[1].toLowerCase()}:${text.replace(/\s+/g, '').toLowerCase()}`);
    start.lastIndex = end + 1;
  }
  return found;
}

/** The brand condition the two migrations add, as `and …`. */
const BRAND_CONDITION =
  /\s*and \( ?brand_id in \(select public\.user_brand_ids\(\)\) or \(brand_id is null and \(select public\.user_has_all_brands\(\)\)\) ?\)|\s*and \( ?brand_id is null or brand_id in \(select public\.user_brand_ids\(\)\) ?\)|\s*and brand_id in \(select public\.user_brand_ids\(\)\)/g;

/** The policies a migration (re)creates: [table, name] pairs. */
function created(file) {
  return statements(file)
    .map((text) => text.match(/^create policy "([^"]+)" on public\.(\w+)/i))
    .filter(Boolean)
    .map((m) => [m[2], m[1]]);
}

describe('the brand tables 00390 and 00424 take', () => {
  const taken = [...created(ACCOUNT), ...created(CHAT)].filter(
    ([table]) => table !== 'invitations',
  );

  it('are the ones whose policies looked only at the organization or the person', () => {
    expect([...new Set(taken.map(([table]) => table))].sort()).toEqual([
      'agent_conversations',
      'chat_access_requests',
      'chat_activity_log',
      'chat_agent_runs',
      'chat_conversations',
      'chat_files',
      'chat_suggestion_feeds',
      'chat_suggestions',
      'chat_why_analyses',
      'content_draft_deliveries',
      'prompt_usage_counters',
      'ship_events',
    ]);
  });

  it.each(taken)(
    '%s "%s": the same rule as before, for signed-in people, within brand access',
    (table, name) => {
      const history = policiesOf(table).history.filter((p) => p.name === name);
      // As 00390 or 00424 made it (00436 widens two of them for touched brands, below).
      const now = history.findLast((p) => [ACCOUNT, CHAT].includes(p.file));
      const before = history[history.indexOf(now) - 1];
      expect(history.at(-1).file === now.file || history.at(-1).file === TOUCHED).toBe(true);
      expect(before.file < now.file).toBe(true);

      expect(now.roles).toBe('authenticated');
      expect(now.command).toBe(before.command);
      // Every condition gains the brand condition…
      for (const condition of conditions(now.body)) {
        expect(condition).toMatch(
          /brand_idin\(selectpublic\.user_brand_ids\(\)\)\)?$|brand_idisnulland\(selectpublic\.user_has_all_brands\(\)\)\)\)$/,
        );
      }
      // …and keeps everything it had.
      expect(conditions(now.body.replace(BRAND_CONDITION, ''))).toEqual(conditions(before.body));
    },
  );

  it('shows a row with no brand to admins and All-brands people, or to its own person', () => {
    const withoutBrand = (rule) =>
      taken
        .filter(([table, name]) => policiesOf(table).now.get(name).body.includes(rule))
        .map(([table, name]) => `${table}: ${name}`)
        .sort();
    // Someone else's row with no brand (a shared chat, a filed file, an agent
    // run) may hold any brand's data: admins and All-brands people only.
    expect(withoutBrand('brand_id is null and (select public.user_has_all_brands())')).toEqual([
      'chat_agent_runs: chat_agent_runs: agent select',
      'chat_conversations: chat_conversations: agent run select',
      'chat_conversations: chat_conversations: shared select',
      'chat_files: chat_files: member select',
    ]);
    // …or to people who can access every brand it touched (00436): a shared chat, a file.
    expect(
      withoutBrand(
        'brand_id is null and touched_brand_ids <@ array(select public.user_brand_ids())',
      ),
    ).toEqual([
      'chat_conversations: chat_conversations: shared select',
      'chat_files: chat_files: member select',
    ]);
    // The person's own (and admins'): what they wrote, did or asked.
    expect(withoutBrand('brand_id is null or brand_id in')).toEqual([
      'agent_conversations: Users read own conversations',
      'agent_conversations: Users write own conversations',
      'chat_access_requests: chat_access_requests: own or admin select',
      'chat_activity_log: chat_activity_log: own or admin select',
      'chat_conversations: chat_conversations: author select',
    ]);
  });

  it('come after the migration that creates each table, as a fresh install runs them in order', () => {
    for (const [table] of taken) {
      const creates = new RegExp(
        `create table (?:if not exists )?(?:"?public"?\\.)?"?${table}"? \\(`,
        'i',
      );
      const maker = files.find((file) => creates.test(read(file)));
      const changer = created(ACCOUNT).some(([t]) => t === table) ? ACCOUNT : CHAT;
      expect(maker < changer, table).toBe(true);
    }
  });
});

describe('the brands a chat touched (00436)', () => {
  /** Without spaces or case, as conditions() compares them. */
  const squash = (text) => text.replace(/\s+/g, '').toLowerCase();
  const BRANDED = squash('brand_id in (select public.user_brand_ids())');
  // A row of one of the person's brands: for Selected brands, every brand it touched theirs too.
  const BRANDED_TOUCHED = squash(`(
    brand_id in (select public.user_brand_ids())
    and ((select public.user_has_all_brands()) or touched_brand_ids <@ array(select public.user_brand_ids()))
  )`);
  // A row with no brand, on the same terms.
  const NO_BRAND_TOUCHED = squash(
    'or (brand_id is null and touched_brand_ids <@ array(select public.user_brand_ids()))',
  );
  const touched = [
    ['chat_conversations', 'chat_conversations: shared select', true],
    ['chat_files', 'chat_files: member select', true],
    ['chat_conversations', 'chat_conversations: agent run select', false],
  ];

  it.each(touched)(
    '%s "%s": 00424\'s rule, and for Selected brands every brand it touched theirs',
    (table, name, noBrand) => {
      const history = policiesOf(table).history.filter((p) => p.name === name);
      const now = history.at(-1);
      const before = history.at(-2);
      expect([now.file, before.file]).toEqual([TOUCHED, CHAT]);
      expect(now.roles).toBe('authenticated');
      expect(now.command).toBe(before.command);
      const [condition] = conditions(now.body);
      expect(condition).toContain(BRANDED_TOUCHED);
      expect(condition.includes(NO_BRAND_TOUCHED)).toBe(noBrand);
      // Everything else is 00424's.
      expect(condition.replace(BRANDED_TOUCHED, BRANDED).replace(NO_BRAND_TOUCHED, '')).toBe(
        conditions(before.body)[0],
      );
    },
  );

  it("keeps the set only for the server, and copies a chat's onto its files", () => {
    const sql = read(TOUCHED);
    for (const fn of [
      'chat_start_touched_brands(uuid)',
      'chat_note_touched_brands(uuid, uuid[], boolean)',
    ]) {
      const name = fn.replace(/[()[\]]/g, '\\$&');
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name} from public, anon, authenticated`),
      );
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name} to service_role`));
    }
    // Not known (null) for every chat there is, and every file a chat made: only new chats
    // start a set; a file no chat made holds its own brand's data.
    expect(sql).toMatch(/add column if not exists touched_brand_ids uuid\[\];/);
    expect(sql).toMatch(
      /update public\.chat_files f set touched_brand_ids = array\[f\.brand_id\] where f\.touched_brand_ids is null and f\.brand_id is not null and f\.conversation_id is null and f\.origin <> 'chat'/,
    );
    expect(sql).not.toMatch(/touched_brand_ids uuid\[\] (?:not null|default)/);
    expect(sql).toMatch(
      /create trigger chat_files_touched_brands before insert on public\.chat_files for each row/,
    );
  });

  it("takes Chat's agents by can_see_chat_agent, for signed-in people", () => {
    const agents = policiesOf('chat_agents');
    const now = agents.now.get('chat_agents: member select');
    expect(now).toMatchObject({ file: TOUCHED, roles: 'authenticated', command: 'select' });
    // The caller's own organization first, so the function runs on their agents only.
    expect(conditions(now.body)).toEqual([
      'using:organization_idin(selectp.organization_idfrompublic.profilespwherep.id=auth.uid())andpublic.can_see_chat_agent(id)',
    ]);
    const fn = lastFunction('can_see_chat_agent');
    expect(fn.file).toBe(TOUCHED);
    expect(fn.header).toMatch(/stable security definer set search_path = ''/);
    // 00419's rule stays: the organization, and an admin, a workspace agent or one's own.
    expect(fn.body).toMatch(
      /p\.role = 'admin' or a\.visibility = 'workspace' or a\.owner_id = p\.id/,
    );
    expect(fn.body).toMatch(/p\.role = 'admin' or p\.brand_scope = 'all'/);
  });
});

describe('user_has_all_brands (00390)', () => {
  it('answers whether the caller is an admin or has All brands, in an organization', () => {
    const all = lastFunction('user_has_all_brands');
    expect(all.file).toBe(ACCOUNT);
    expect(all.header).toMatch(
      /^\) returns boolean language sql stable security definer set search_path = '' /,
    );
    expect(all.body).toMatch(
      /from public\.profiles p where p\.id = auth\.uid\(\) and p\.organization_id is not null and \(p\.role = 'admin' or p\.brand_scope = 'all'\)/,
    );
    const sql = read(ACCOUNT);
    expect(sql).toMatch(/revoke all on function public\.user_has_all_brands\(\) from public, anon/);
    expect(sql).toMatch(
      /grant execute on function public\.user_has_all_brands\(\) to authenticated, service_role/,
    );
  });
});

describe('content_draft_member (00390)', () => {
  const member = lastFunction('content_draft_member');

  it('lets in the server, or a person who can access the draft’s brand', () => {
    expect(member.file).toBe(ACCOUNT);
    expect(member.header).toMatch(/ stable security definer set search_path = '' /);
    expect(member.body).toMatch(
      /select auth\.role\(\) = 'service_role' or exists \( select 1 from public\.content_drafts d where d\.id = p_draft_id and public\.can_access_brand\(d\.brand_id\) \);/,
    );
    // The organization alone no longer lets anyone in.
    expect(member.body).not.toMatch(/profiles/);
  });

  it('backs its policies for signed-in people only', () => {
    const policies = read(ACCOUNT).match(
      /alter policy "content_draft_\w+: member \w+" on public\.content_draft_\w+ to authenticated/g,
    );
    expect(policies).toHaveLength(10);
  });
});

describe('the plan’s quotas (00390)', () => {
  const MEMBER =
    /coalesce\(auth\.role\(\), ''\) = 'service_role' or exists \( select 1 from public\.profiles pf where pf\.id = auth\.uid\(\) and pf\.organization_id = p_organization_id \)/;

  it('count every location of the organization for its members, the hidden brands in one row', () => {
    const usage = lastFunction('org_prompt_location_usage');
    expect(usage.file).toBe(ACCOUNT);
    expect(usage.header).toMatch(
      /returns table \(brand_id uuid, locations bigint\) language sql stable security definer set search_path = '' /,
    );
    expect(usage.body).toMatch(
      /where b\.organization_id = p_organization_id and not b\.is_demo and p\.is_active/,
    );
    expect(usage.body).toMatch(MEMBER);
    expect(usage.body).toMatch(
      /case when coalesce\(auth\.role\(\), ''\) = 'service_role' or u\.id in \(select public\.user_brand_ids\(\)\) then u\.id end as brand_id/,
    );
    expect(usage.body).toMatch(
      /select s\.brand_id, sum\(s\.locations\)::bigint from shown s group by s\.brand_id;/,
    );
  });

  it('total the Account on the usage cards for anyone who can access the brand', () => {
    const summary = lastFunction('prompt_usage_summary');
    expect(summary.file).toBe(ACCOUNT);
    expect(summary.header).toMatch(/ stable security definer set search_path = '' /);
    expect(summary.body).toMatch(
      /where b\.id = p_brand_id and \(coalesce\(auth\.role\(\), ''\) = 'service_role' or public\.can_access_brand\(b\.id\)\);/,
    );
    // The totals read the organization, not the person's brands.
    expect(summary.body).toMatch(
      /where b2\.organization_id = b\.organization_id and not b2\.is_demo/,
    );
    expect(summary.body).toMatch(
      /where c\.organization_id = b\.organization_id and not cb\.is_demo/,
    );
    expect(summary.body).not.toMatch(/user_brand_ids/);
  });

  it('count every brand of the organization for maxBrands, the demo brand left out', () => {
    const count = lastFunction('org_brand_count');
    expect(count.file).toBe(ACCOUNT);
    expect(count.header).toMatch(
      /returns integer language sql stable security definer set search_path = '' /,
    );
    expect(count.body).toMatch(/where b\.organization_id = p_organization_id and not b\.is_demo/);
    expect(count.body).toMatch(MEMBER);
  });

  it('run for signed-in people and the server, never anon', () => {
    const sql = read(ACCOUNT);
    for (const name of ['org_prompt_location_usage', 'prompt_usage_summary', 'org_brand_count']) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\(uuid\\) from public, anon`),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\(uuid\\) to authenticated, service_role`,
        ),
      );
    }
  });
});

describe('invitations (00390)', () => {
  it('are read by the organization’s admins only, and managed by them as before', () => {
    const policies = policiesOf('invitations').now;
    const reads = [...policies.values()].filter((p) => p.command === 'select');
    expect(reads.map((p) => p.name)).toEqual(['Admins can view org invitations']);
    expect(reads[0].roles).toBe('authenticated');
    expect(reads[0].body).toMatch(/where p\.id = auth\.uid\(\) and p\.role = 'admin'/);
    expect([...policies.values()].map((p) => p.command).sort()).toEqual([
      'delete',
      'insert',
      'select',
      'update',
    ]);
  });
});

describe('member_brands (00390)', () => {
  it('locks the person’s profile while it checks their organization', () => {
    const check = lastFunction('check_member_brand_organization');
    expect(check.file).toBe(ACCOUNT);
    expect(check.body).toMatch(
      /perform 1 from public\.profiles p where p\.id = new\.user_id and p\.organization_id = new\.organization_id for share; if not found then raise exception/,
    );
  });
});
