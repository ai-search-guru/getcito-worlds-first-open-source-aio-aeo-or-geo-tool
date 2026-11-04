import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * Brand access (00388) as the migrations leave it: which brands a person sees
 * is stored by the server, one rule answers "may this person see this
 * brand?", and everyone starts with All brands, so nothing changes yet. Read
 * from the SQL, as the other migration tests here do: the repository has no
 * database tests.
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

const MIGRATION = '00388_brand_access.sql';
const sql = read(MIGRATION);

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

/** A statement of 00388 matching `pattern`, up to its semicolon. */
function statement(pattern) {
  const found = sql.split(';').find((text) => pattern.test(text));
  if (!found) throw new Error(`No statement ${pattern}`);
  return found.trim();
}

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

/** The access rule inside a helper's body: admin, All brands, the demo brand, or shared. */
const RULE =
  /\( p\.role = 'admin' or p\.brand_scope = 'all' or b\.is_demo or exists \( select 1 from public\.member_brands mb where mb\.user_id = p\.id and mb\.brand_id = b\.id \) \)/;

describe('profiles.brand_scope', () => {
  it('is All brands for everyone unless the server narrows it', () => {
    expect(sql).toMatch(
      /alter table public\.profiles add column if not exists brand_scope text not null default 'all'/,
    );
    expect(sql).toMatch(
      /add constraint profiles_brand_scope_check check \(brand_scope in \('all', 'selected'\)\)/,
    );
  });

  it('is always All brands for an admin', () => {
    expect(sql).toMatch(
      /alter table public\.profiles add constraint profiles_admin_all_brands_check check \(role <> 'admin' or brand_scope = 'all'\)/,
    );
  });

  it('is managed server-side: the latest guard refuses a person’s own change, and keeps its other checks', () => {
    const guard = lastFunction('guard_profile_server_columns');
    expect(guard.body).toMatch(
      /if new\.brand_scope is distinct from old\.brand_scope then raise exception 'profile brand access is managed server-side' using errcode = '42501'/,
    );
    expect(guard.body).toMatch(/if new\.role is distinct from old\.role then raise exception/);
    expect(guard.body).toMatch(/new\.organization_id is distinct from old\.organization_id/);
    expect(guard.body).toMatch(/new\.can_manage_menus is distinct from old\.can_manage_menus/);
    // A role that bypasses RLS (the server) still changes it.
    expect(guard.body).toMatch(/^ ?begin if \(select rolbypassrls from pg_catalog\.pg_roles/);
  });

  it('goes back to All brands for a new admin and for someone who left, after the guard', () => {
    const reset = lastFunction('reset_profile_brand_scope');
    expect(reset.body).toMatch(
      /if new\.role = 'admin' or new\.organization_id is null then new\.brand_scope := 'all'; end if; return new;/,
    );
    const trigger = statement(
      /create trigger \w+ before update of organization_id, role on public\.profiles for each row execute function public\.reset_profile_brand_scope\(\)/,
    );
    const name = trigger.match(/create trigger (\w+)/)[1];
    // Triggers fire in name order: the guard sees what the person asked for.
    expect(name > 'profiles_guard_server_columns').toBe(true);
  });

  it('drops the shared brands when the person moves, leaves or gets All brands', () => {
    const forget = lastFunction('forget_profile_member_brands');
    expect(forget.header).toMatch(/security definer/);
    expect(forget.header).toMatch(/set search_path = ''/);
    expect(forget.body).toMatch(
      /delete from public\.member_brands mb where mb\.user_id = new\.id and \(new\.brand_scope = 'all' or mb\.organization_id is distinct from new\.organization_id\)/,
    );
    expect(statement(/create trigger profiles_forget_member_brands/)).toMatch(
      /after update of organization_id, role, brand_scope on public\.profiles for each row when \( old\.organization_id is distinct from new\.organization_id or \(new\.brand_scope = 'all' and old\.brand_scope = 'selected'\) \) execute function public\.forget_profile_member_brands\(\)/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.forget_profile_member_brands\(\) from public, anon, authenticated/,
    );
  });
});

describe('member_brands', () => {
  const table = statement(/create table if not exists public\.member_brands/);

  it('keeps one row per person and brand, gone with the brand, the person or the organization', () => {
    expect(table).toMatch(
      /organization_id uuid not null references public\.organizations\(id\) on delete cascade/,
    );
    expect(table).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(table).toMatch(
      /brand_id uuid not null references public\.brands\(id\) on delete cascade/,
    );
    expect(table).toMatch(/granted_by uuid references auth\.users\(id\) on delete set null/);
    expect(table).toMatch(/granted_at timestamptz not null default now\(\)/);
    expect(table).toMatch(/primary key \(user_id, brand_id\)/);
  });

  it('only joins a brand and a person of the row’s organization', () => {
    expect(sql).toMatch(
      /create trigger member_brands_check_organization before insert or update on public\.member_brands for each row execute function public\.check_member_brand_organization\(\)/,
    );
    const check = lastFunction('check_member_brand_organization');
    expect(check.body).toMatch(
      /from public\.brands b where b\.id = new\.brand_id and b\.organization_id = new\.organization_id/,
    );
    expect(check.body).toMatch(
      /from public\.profiles p where p\.id = new\.user_id and p\.organization_id = new\.organization_id/,
    );
  });

  it('is read by the person and their admins, and written by the server only', () => {
    expect(sql).toMatch(/alter table public\.member_brands enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.member_brands from anon, authenticated/);
    expect(sql).toMatch(/grant select on table public\.member_brands to authenticated/);
    expect(sql).toMatch(/grant all on table public\.member_brands to service_role/);

    const policies = [...policiesOf('member_brands').values()];
    expect(policies).toHaveLength(1);
    const [read] = policies;
    expect(read).toMatch(/ for select to authenticated using /);
    expect(read).toMatch(/brand_id in \(select public\.user_brand_ids\(\)\)/);
    expect(read).toMatch(/user_id = auth\.uid\(\)/);
    expect(read).toMatch(/where p\.id = auth\.uid\(\) and p\.role = 'admin'/);
  });
});

describe('invitations', () => {
  it('keep the brand choice, All brands by default', () => {
    expect(sql).toMatch(
      /alter table public\.invitations add column if not exists brand_scope text not null default 'all', add column if not exists brand_ids uuid\[\] not null default '\{\}'/,
    );
    expect(sql).toMatch(
      /add constraint invitations_brand_scope_check check \(brand_scope in \('all', 'selected'\)\)/,
    );
    expect(sql).toMatch(
      /add constraint invitations_brand_ids_check check \(brand_scope = 'selected' or cardinality\(brand_ids\) = 0\)/,
    );
    expect(sql).toMatch(
      /add constraint invitations_admin_all_brands_check check \(role <> 'admin' or brand_scope = 'all'\)/,
    );
  });

  it('name only brands of their organization, checked when the brands are set', () => {
    expect(sql).toMatch(
      /create trigger invitations_check_brands before insert or update of organization_id, brand_ids on public\.invitations for each row execute function public\.check_invitation_brands\(\)/,
    );
    expect(lastFunction('check_invitation_brands').body).toMatch(
      /from unnest\(new\.brand_ids\) as ids\(brand_id\) where not exists \( select 1 from public\.brands b where b\.id = ids\.brand_id and b\.organization_id = new\.organization_id \)/,
    );
  });
});

describe('the access rule', () => {
  const canAccess = lastFunction('can_access_brand');
  const brandIds = lastFunction('user_brand_ids');

  it('has the signatures the policies, functions and server call', () => {
    expect(canAccess.header).toMatch(
      /^ ?p_brand_id uuid, p_user_id uuid default auth\.uid\(\) \) returns boolean /,
    );
    expect(brandIds.header).toMatch(/^\) returns setof uuid /);
  });

  it('is stable, security definer, with an empty search path', () => {
    for (const helper of [canAccess, brandIds]) {
      expect(helper.header).toMatch(/ stable /);
      expect(helper.header).toMatch(/ security definer /);
      expect(helper.header).toMatch(/ set search_path = '' /);
      expect(helper.header).not.toMatch(/volatile|security invoker/);
    }
  });

  it('runs for signed-in people and the server, never anon', () => {
    for (const signature of ['can_access_brand\\(uuid, uuid\\)', 'user_brand_ids\\(\\)']) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${signature} from public, anon`),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${signature} to authenticated, service_role`,
        ),
      );
    }
  });

  it('lets in an admin, All brands, a shared brand and the demo brand, in the person’s organization', () => {
    for (const helper of [canAccess, brandIds]) {
      expect(helper.body).toMatch(RULE);
      expect(helper.body).toMatch(
        /join public\.(brands b on b\.organization_id = p\.organization_id|profiles p on p\.organization_id = b\.organization_id)/,
      );
    }
    expect(brandIds.body).toMatch(/where p\.id = auth\.uid\(\)/);
  });

  it('answers about someone else only for the service role', () => {
    expect(canAccess.body).toMatch(
      /when p_brand_id is null or p_user_id is null then false when p_user_id is distinct from auth\.uid\(\) and coalesce\(auth\.role\(\), ''\) <> 'service_role' then false else exists/,
    );
    expect(canAccess.body).toMatch(/where b\.id = p_brand_id and p\.id = p_user_id/);
  });
});

describe('a new brand', () => {
  it('is shared with the Selected-brands person who added it', () => {
    expect(sql).toMatch(
      /create trigger brands_grant_creator after insert on public\.brands for each row execute function public\.grant_brand_to_creator\(\)/,
    );
    const grant = lastFunction('grant_brand_to_creator');
    expect(grant.header).toMatch(/security definer/);
    expect(grant.header).toMatch(/set search_path = ''/);
    expect(grant.body).toMatch(/if new\.is_demo then return null; end if;/);
    expect(grant.body).toMatch(
      /insert into public\.member_brands \(organization_id, user_id, brand_id, granted_by\) select new\.organization_id, p\.id, new\.id, p\.id from public\.profiles p where p\.id = auth\.uid\(\) and p\.organization_id = new\.organization_id and p\.brand_scope = 'selected' on conflict \(user_id, brand_id\) do nothing/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.grant_brand_to_creator\(\) from public, anon, authenticated/,
    );
  });
});

describe('00388', () => {
  it('sets an empty search path on every function it adds', () => {
    const headers = [
      ...sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(([^$]*?)\$\$/g),
    ];
    expect(headers.length).toBe(8);
    for (const [, name, header] of headers) {
      expect(header, name).toMatch(/set search_path = ''/);
    }
  });

  it('changes no policy outside member_brands', () => {
    const policies = [...sql.matchAll(/create policy "[^"]+" on public\.(\w+)/g)].map((m) => m[1]);
    expect(policies).toEqual(['member_brands']);
  });
});
