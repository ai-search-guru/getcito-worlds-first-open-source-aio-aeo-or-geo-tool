import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * Integrations per brand (BRAND-ACCESS PR 14, 00470) as the migrations leave
 * them: the Account's sign-ins in one pool, the one each brand uses per
 * provider, a copy of what there was (the Account's Google rows for every
 * brand, each CMS site for its brand), and the old tables kept in step while
 * Settings › Integrations and the CMS cards still write them. Nothing anyone
 * sees changes. Read from the SQL, as the other migration tests here do: the
 * repository has no database tests.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

/** A migration's SQL without its comments, on one line. */
const read = (file) =>
  readFileSync(new URL(file, dir), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const MIGRATION = '00470_brand_integrations.sql';
const sql = read(MIGRATION);
const later = files.filter((file) => file > MIGRATION).map(read);

/** The last definition of a function, across every migration: its header and body. */
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

/** A statement of 00470 matching `pattern`, up to its semicolon (function bodies left out). */
function statement(pattern) {
  const found = sql
    .replace(/\$\$.*?\$\$/g, "''")
    .split(';')
    .map((text) => text.trim())
    .find((text) => pattern.test(text));
  if (!found) throw new Error(`No statement ${pattern}`);
  return found;
}

/** Where `pattern` first matches in 00470, for the order statements run in. */
const at = (pattern) => {
  const index = sql.search(pattern);
  if (index < 0) throw new Error(`Not in ${MIGRATION}: ${pattern}`);
  return index;
};

/** The policies on a table as every migration leaves them: name → text. */
function policiesOf(table) {
  const policies = new Map();
  const on = `on (?:"?public"?\\.)?"?${table}"?(?: |$)`;
  for (const file of files) {
    for (const text of read(file)
      .split(';')
      .map((s) => s.trim())) {
      const drop = text.match(new RegExp(`^drop policy (?:if exists )?"([^"]+)" ${on}`, 'i'));
      if (drop) policies.delete(drop[1]);
      const create = text.match(new RegExp(`^create policy "([^"]+)" ${on}`, 'i'));
      if (create) policies.set(create[1], text);
    }
  }
  return policies;
}

describe('integration_accounts: the Account’s sign-ins', () => {
  const table = statement(/^create table if not exists public\.integration_accounts/);

  it('keeps Composio’s ids, a label and a status, never a token, gone with the organization', () => {
    expect(table).toMatch(
      /organization_id uuid not null constraint integration_accounts_organization_id_fkey references public\.organizations\(id\) on delete cascade/,
    );
    expect(table).toMatch(/provider text not null/);
    expect(table).toMatch(/composio_entity_id text,/);
    expect(table).toMatch(/composio_account_id text,/);
    expect(table).toMatch(/label text check \(label is null or char_length\(label\) <= 300\)/);
    expect(table).toMatch(/status text not null default 'pending'/);
    expect(table).toMatch(
      /connected_by uuid constraint integration_accounts_connected_by_fkey references public\.profiles\(id\) on delete set null/,
    );
    expect(table).not.toMatch(/token|secret|password/i);
  });

  it('follows one old row at most, and goes with it', () => {
    expect(table).toMatch(
      /integration_connection_id uuid unique constraint integration_accounts_integration_connection_id_fkey references public\.integration_connections\(id\) on delete cascade/,
    );
    expect(table).toMatch(
      /cms_connection_id uuid unique constraint integration_accounts_cms_connection_id_fkey references public\.brand_cms_connections\(id\) on delete cascade/,
    );
    expect(table).toMatch(
      /constraint integration_accounts_one_source check \(num_nonnulls\(integration_connection_id, cms_connection_id\) <= 1\)/,
    );
  });

  it('has no status list a write to the old tables could fail on', () => {
    // The old tables are the ones written until PR 15; a status they take
    // that this table refused would fail their write through the trigger.
    expect(table).toMatch(
      /status text not null default 'pending' check \(char_length\(status\) between 1 and 40\)/,
    );
    expect(table).not.toMatch(/status in \(/);
  });
});

describe('brand_integrations: the sign-in each brand uses', () => {
  const table = statement(/^create table if not exists public\.brand_integrations/);

  it('keeps one per brand and provider, gone with the brand or the sign-in', () => {
    expect(table).toMatch(
      /brand_id uuid not null constraint brand_integrations_brand_id_fkey references public\.brands\(id\) on delete cascade/,
    );
    expect(table).toMatch(
      /account_id uuid not null constraint brand_integrations_account_id_fkey references public\.integration_accounts\(id\) on delete cascade/,
    );
    expect(table).toMatch(/primary key \(brand_id, provider\)/);
    expect(sql).toMatch(
      /create index if not exists brand_integrations_account_id_idx on public\.brand_integrations \(account_id\)/,
    );
  });

  it('has room for the brand’s own choices, an object, and nothing in it yet', () => {
    expect(table).toMatch(
      /settings jsonb not null default '\{\}'::jsonb check \( jsonb_typeof\(settings\) = 'object' and octet_length\(settings::text\) <= 8192 \)/,
    );
    expect(sql).not.toMatch(/insert into public\.brand_integrations \([^)]*settings/);
  });

  it('uses a sign-in of the brand’s own organization, for the provider it names', () => {
    expect(sql).toMatch(
      /create trigger brand_integrations_check_account before insert or update on public\.brand_integrations for each row execute function public\.check_brand_integration_account\(\)/,
    );
    const check = lastFunction('check_brand_integration_account');
    expect(check.body).toMatch(
      /from public\.integration_accounts a join public\.brands b on b\.organization_id = a\.organization_id where a\.id = new\.account_id and a\.provider = new\.provider and b\.id = new\.brand_id/,
    );
    expect(check.body).toMatch(/using errcode = '23514'/);
  });
});

describe('who reads them', () => {
  it('lets signed-in people read, and only the server write', () => {
    for (const table of ['integration_accounts', 'brand_integrations']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${table} from anon, authenticated`),
      );
      expect(sql).toMatch(new RegExp(`grant select on table public\\.${table} to authenticated`));
      expect(sql).toMatch(new RegExp(`grant all on table public\\.${table} to service_role`));
      for (const text of later) {
        expect(text).not.toMatch(
          new RegExp(
            `grant (?:all|insert|update|delete)[^;]* on (?:table )?public\\.${table} to (?:anon|authenticated)`,
          ),
        );
      }
    }
  });

  it('shows a brand’s integrations to the people who can access the brand', () => {
    const policies = [...policiesOf('brand_integrations').values()];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(
      / on public\.brand_integrations for select to authenticated using \(brand_id in \(select public\.user_brand_ids\(\)\)\)$/,
    );
  });

  it('shows a sign-in to the people who can access a brand that uses it', () => {
    const policies = [...policiesOf('integration_accounts').values()];
    expect(policies).toHaveLength(1);
    // brand_integrations' own policy applies inside the subquery.
    expect(policies[0]).toMatch(
      / on public\.integration_accounts for select to authenticated using \(id in \(select bi\.account_id from public\.brand_integrations bi\)\)$/,
    );
  });

  it('leaves the Account’s Google row to the server to write, as the pool follows it', () => {
    expect(sql).toMatch(
      /drop policy if exists "integration_connections: admin write" on public\.integration_connections/,
    );
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate on table public\.integration_connections from anon, authenticated/,
    );
    const policies = policiesOf('integration_connections');
    expect([...policies.keys()]).toEqual(['integration_connections: member select']);
    expect(policies.get('integration_connections: member select')).toMatch(/ for select using /i);
  });
});

describe('the pool keeps in step with the old tables', () => {
  const definers = [
    'sync_integration_connection_account',
    'sync_cms_connection_account',
    'use_account_integrations_on_new_brand',
  ];

  it('runs its triggers as their owner, with no search path, and lets no one call them', () => {
    for (const name of definers) {
      const fn = lastFunction(name);
      expect(fn.file, name).toBe(MIGRATION);
      expect(fn.header, name).toMatch(
        /returns trigger language plpgsql security definer set search_path = ''/,
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\(\\) from public, anon, authenticated`,
        ),
      );
    }
  });

  it('copies the Account’s Google row to its sign-in, and a new one to every brand of the Account', () => {
    expect(sql).toMatch(
      /create trigger integration_connections_sync_account after insert or update on public\.integration_connections for each row execute function public\.sync_integration_connection_account\(\)/,
    );
    const fn = lastFunction('sync_integration_connection_account').body;
    expect(fn).toMatch(
      /values \( new\.organization_id, new\.provider, new\.composio_entity_id, new\.composio_account_id, new\.status, new\.connected_by, new\.id, new\.created_at, new\.updated_at \) on conflict \(integration_connection_id\) do update set composio_entity_id = excluded\.composio_entity_id, composio_account_id = excluded\.composio_account_id, status = excluded\.status, connected_by = excluded\.connected_by, updated_at = excluded\.updated_at returning a\.id into v_account_id;/,
    );
    // Only a new row is given to the brands; one a brand already has for that
    // product stays.
    expect(fn).toMatch(
      /if tg_op = 'INSERT' then insert into public\.brand_integrations \(brand_id, provider, account_id\) select b\.id, new\.provider, v_account_id from public\.brands b where b\.organization_id = new\.organization_id on conflict \(brand_id, provider\) do nothing; end if;/,
    );
  });

  it('copies a brand’s CMS connection to its sign-in, used by that brand', () => {
    expect(sql).toMatch(
      /create trigger brand_cms_connections_sync_account after insert or update on public\.brand_cms_connections for each row execute function public\.sync_cms_connection_account\(\)/,
    );
    const fn = lastFunction('sync_cms_connection_account').body;
    expect(fn).toMatch(
      /left\(coalesce\(nullif\(new\.site_name, ''\), new\.site_url, new\.site_id\), 300\)/,
    );
    expect(fn).toMatch(
      /from public\.brands b where b\.id = new\.brand_id on conflict \(cms_connection_id\) do update set/,
    );
    expect(fn).toMatch(
      /insert into public\.brand_integrations \(brand_id, provider, account_id\) values \(new\.brand_id, new\.provider, v_account_id\)/,
    );
  });

  it('gives a new brand the Account’s Google sign-ins, as every brand had them', () => {
    expect(sql).toMatch(
      /create trigger brands_use_account_integrations after insert on public\.brands for each row execute function public\.use_account_integrations_on_new_brand\(\)/,
    );
    expect(lastFunction('use_account_integrations_on_new_brand').body).toMatch(
      /select new\.id, a\.provider, a\.id from public\.integration_accounts a where a\.organization_id = new\.organization_id and a\.integration_connection_id is not null on conflict \(brand_id, provider\) do nothing/,
    );
  });
});

describe('the switch-over (D7)', () => {
  it('copies the Account’s Google rows, used by every brand of the Account, the demo brand too', () => {
    expect(sql).toMatch(
      /select ic\.organization_id, ic\.provider, ic\.composio_entity_id, ic\.composio_account_id, ic\.status, ic\.connected_by, ic\.id, ic\.created_at, ic\.updated_at from public\.integration_connections ic on conflict \(integration_connection_id\) do nothing/,
    );
    const given = statement(
      /^insert into public\.brand_integrations \(brand_id, provider, account_id\) select b\.id, a\.provider, a\.id/,
    );
    expect(given).toMatch(
      /from public\.integration_accounts a join public\.brands b on b\.organization_id = a\.organization_id where a\.integration_connection_id is not null on conflict \(brand_id, provider\) do nothing$/,
    );
    // Every brand used the Account's connection: none is left out.
    expect(given).not.toMatch(/is_demo|is_active/);
  });

  it('copies each CMS connection, used by its brand', () => {
    expect(sql).toMatch(
      /c\.connected_by, c\.id, c\.created_at, c\.updated_at from public\.brand_cms_connections c join public\.brands b on b\.id = c\.brand_id on conflict \(cms_connection_id\) do nothing/,
    );
    expect(sql).toMatch(
      /insert into public\.brand_integrations \(brand_id, provider, account_id\) select c\.brand_id, c\.provider, a\.id from public\.brand_cms_connections c join public\.integration_accounts a on a\.cms_connection_id = c\.id on conflict \(brand_id, provider\) do nothing/,
    );
  });

  it('keeps the pool in step before it copies, so a connection made meanwhile is not missed', () => {
    const firstCopy = at(
      /insert into public\.integration_accounts \( organization_id, provider, composio_entity_id, composio_account_id, status, connected_by, integration_connection_id, created_at, updated_at \) select/,
    );
    for (const trigger of [
      'integration_connections_sync_account',
      'brand_cms_connections_sync_account',
      'brands_use_account_integrations',
    ]) {
      expect(at(new RegExp(`create trigger ${trigger}`)), trigger).toBeLessThan(firstCopy);
    }
  });

  it('can run again without copying twice', () => {
    const copies = sql.match(/on conflict \([a-z_, ]+\) do nothing/g) ?? [];
    expect(copies.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/create table public\./);
  });

  it('leaves the brands’ Google properties where everything reads them', () => {
    expect(sql).not.toMatch(/alter table public\.brands/);
    expect(sql).not.toMatch(/gsc_property|ga_property_id/);
  });
});

describe('later migrations', () => {
  it('don’t give the Account’s Google row back to people to write', () => {
    for (const text of later) {
      expect(text).not.toMatch(
        /create policy "[^"]*" on public\.integration_connections for (?:all|insert|update|delete)/i,
      );
    }
  });
});
