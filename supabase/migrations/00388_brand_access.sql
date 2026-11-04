-- ============================================================================
-- 00388: brand access — which of the organization's brands a person sees
-- ============================================================================
-- One Account (organization) holds several brands, and different teams or
-- agencies work on different ones (BRAND-ACCESS). A person joins with one
-- role and either All brands or Selected brands. Admins always have All
-- brands, and so does everyone here before this migration: nothing anyone
-- sees changes until the Team screen lets an admin narrow someone.
--
-- This migration only stores the choice and answers "may this person see
-- this brand?". The rules that apply it come after it: the brands policies
-- (00389), the brand tables whose policies skip brands, the functions that
-- check the organization themselves, and the server, MCP and Chat paths.
--
--   * profiles.brand_scope: 'all' or 'selected'. Set by the server (the
--     00228/00374 guard below), like role. An admin is always 'all' (a
--     check, and the reset below on promotion). Leaving the organization
--     resets it to 'all', so whoever creates or joins one next starts from
--     the default; a move straight into another organization keeps the scope
--     the update gives but never the brands shared in the old one, so a move
--     can't widen anyone's access by itself.
--   * member_brands: the brands shared with a Selected-brands person, in the
--     person's own organization (a trigger checks both). A person reads their
--     own rows and an admin reads the organization's; only the server writes
--     them. Deleting the brand, the person or the organization deletes them.
--   * invitations.brand_scope / brand_ids: the choice the invitation keeps
--     until it is accepted. Ids of a brand deleted since then stay in the
--     array: whoever accepts it shares only the brands still there.
--   * can_access_brand(brand, person) and user_brand_ids(): the rule, in one
--     place. A brand of the person's organization, and the person is an
--     admin, has All brands, has it shared, or it is the demo brand (00380,
--     sample data everyone in the organization reads). Both bypass RLS
--     (security definer), so the brands policies can call them without
--     recursing. Only the service role may ask about someone else.
--   * A new brand is shared with whoever added it when they have Selected
--     brands (a Selected-brands manager may add brands).
--
-- A profile without an organization sees no brand here, as under today's
-- policies (brands.organization_id is never null). The API server compares
-- organizations itself with a plain !== for self-hosted installs
-- (backend/src/lib/access.js); it applies the scope on top of that, so this
-- rule doesn't change who a self-hosted install lets in.

-- ── profiles.brand_scope ────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists brand_scope text not null default 'all';

alter table public.profiles
  drop constraint if exists profiles_brand_scope_check;
alter table public.profiles
  add constraint profiles_brand_scope_check
  check (brand_scope in ('all', 'selected'));

-- Admins always have All brands.
alter table public.profiles
  drop constraint if exists profiles_admin_all_brands_check;
alter table public.profiles
  add constraint profiles_admin_all_brands_check
  check (role <> 'admin' or brand_scope = 'all');

comment on column public.profiles.brand_scope is
  'Brand access (00388): ''all'' = every brand of the organization, ''selected'' = the brands in member_brands (and the demo brand). Admins are always ''all''. Set by the server.';

-- 00374's guard, plus brand_scope: a person's own update can't widen (or
-- narrow) the brands they see.
create or replace function public.guard_profile_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'profile role is managed server-side' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id
     and (
       old.organization_id is not null
       or new.organization_id is null
       or public.organization_has_other_members(new.organization_id, new.id)
     )
  then
    raise exception 'profile organization is managed server-side' using errcode = '42501';
  end if;
  if new.menu_shown is distinct from old.menu_shown
     or new.menu_hidden is distinct from old.menu_hidden
     or new.can_manage_menus is distinct from old.can_manage_menus
  then
    raise exception 'profile menu access is managed server-side' using errcode = '42501';
  end if;
  if new.brand_scope is distinct from old.brand_scope then
    raise exception 'profile brand access is managed server-side' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Whoever makes the change: a new admin has All brands, and so does a person
-- who left the organization (no brand to see; the next organization starts
-- from the default). A move straight into another organization keeps the
-- scope the update gives: a removed-and-invited person is reset on the way
-- out, and an update can't tell "set to Selected again" from "not set", so
-- resetting there could hand All brands to someone invited with Selected.
-- The brands shared in the old organization go either way (the trigger after
-- the update). Fires after the guard (triggers run in name order), so the
-- guard checks what the person asked for, not this reset.
create or replace function public.reset_profile_brand_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'admin' or new.organization_id is null then
    new.brand_scope := 'all';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reset_brand_scope on public.profiles;
create trigger profiles_reset_brand_scope
  before update of organization_id, role on public.profiles
  for each row execute function public.reset_profile_brand_scope();

-- ── member_brands ───────────────────────────────────────────────────────────

create table if not exists public.member_brands (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);

-- The primary key serves the helpers' (user_id, brand_id) look-ups; these
-- serve a brand's people (Brand settings) and an organization's list (Team).
create index if not exists member_brands_brand_id_idx on public.member_brands (brand_id);
create index if not exists member_brands_organization_id_idx on public.member_brands (organization_id);

comment on table public.member_brands is
  'Brand access (00388): the brands shared with a Selected-brands person, in their own organization. Rows mean nothing for All-brands people and go when the person leaves, moves organization, becomes an admin or gets All brands. Read by the person (own rows) and admins; written by the server.';

-- The brand and the person both belong to the row's organization.
create or replace function public.check_member_brand_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.brands b
    where b.id = new.brand_id and b.organization_id = new.organization_id
  ) then
    raise exception 'member_brands: brand % is not in organization %', new.brand_id, new.organization_id
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.organization_id = new.organization_id
  ) then
    raise exception 'member_brands: person % is not in organization %', new.user_id, new.organization_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists member_brands_check_organization on public.member_brands;
create trigger member_brands_check_organization
  before insert or update on public.member_brands
  for each row execute function public.check_member_brand_organization();

-- The shared brands go when the person moves or leaves the organization
-- (their rows name the old one) and when they end up with All brands (a new
-- admin, or the server widening them). Security definer: a person's own
-- update (joining the organization they just created, in onboarding) fires
-- it, and people can't write member_brands.
create or replace function public.forget_profile_member_brands()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.member_brands mb
  where mb.user_id = new.id
    and (new.brand_scope = 'all' or mb.organization_id is distinct from new.organization_id);
  return null;
end;
$$;

revoke all on function public.forget_profile_member_brands() from public, anon, authenticated;

drop trigger if exists profiles_forget_member_brands on public.profiles;
create trigger profiles_forget_member_brands
  after update of organization_id, role, brand_scope on public.profiles
  for each row
  when (
    old.organization_id is distinct from new.organization_id
    or (new.brand_scope = 'all' and old.brand_scope = 'selected')
  )
  execute function public.forget_profile_member_brands();

-- ── The rule ────────────────────────────────────────────────────────────────

-- May the person see the brand? Their organization's brand, and they are an
-- admin, have All brands, have it shared, or it is the demo brand. Asking
-- about someone else needs the service role (the API server, MCP, Chat);
-- anyone else gets false. Call it with a brand argument (functions that take
-- p_brand_id); in a policy over many rows prefer user_brand_ids(), which runs
-- once per query.
create or replace function public.can_access_brand(
  p_brand_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_brand_id is null or p_user_id is null then false
    when p_user_id is distinct from auth.uid()
      and coalesce(auth.role(), '') <> 'service_role' then false
    else exists (
      select 1
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where b.id = p_brand_id
        and p.id = p_user_id
        and (
          p.role = 'admin'
          or p.brand_scope = 'all'
          or b.is_demo
          or exists (
            select 1 from public.member_brands mb
            where mb.user_id = p.id and mb.brand_id = b.id
          )
        )
    )
  end;
$$;

revoke all on function public.can_access_brand(uuid, uuid) from public, anon;
grant execute on function public.can_access_brand(uuid, uuid) to authenticated, service_role;

comment on function public.can_access_brand(uuid, uuid) is
  'Brand access (00388): whether the person (default: the caller) may see the brand: their organization''s, and they are an admin, have All brands, have it shared (member_brands) or it is the demo brand. Another person''s id only with the service role; false otherwise.';

-- The ids of the brands the caller may see, by the same rule. In a policy,
-- `brand_id in (select public.user_brand_ids())` runs it once per query.
create or replace function public.user_brand_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 20
as $$
  select b.id
  from public.profiles p
  join public.brands b on b.organization_id = p.organization_id
  where p.id = auth.uid()
    and (
      p.role = 'admin'
      or p.brand_scope = 'all'
      or b.is_demo
      or exists (
        select 1 from public.member_brands mb
        where mb.user_id = p.id and mb.brand_id = b.id
      )
    );
$$;

revoke all on function public.user_brand_ids() from public, anon;
grant execute on function public.user_brand_ids() to authenticated, service_role;

comment on function public.user_brand_ids() is
  'Brand access (00388): the ids of the brands the caller (auth.uid()) may see, by can_access_brand''s rule. For policies: brand_id in (select public.user_brand_ids()).';

-- ── member_brands policies ──────────────────────────────────────────────────
-- A person reads the brands shared with them, an admin those of everyone in
-- the organization; the server writes them (service role).

alter table public.member_brands enable row level security;
revoke all on table public.member_brands from anon, authenticated;
grant select on table public.member_brands to authenticated;
grant all on table public.member_brands to service_role;

drop policy if exists "member_brands: own or admin select" on public.member_brands;
create policy "member_brands: own or admin select" on public.member_brands
  for select
  to authenticated
  using (
    brand_id in (select public.user_brand_ids())
    and (
      user_id = auth.uid()
      or organization_id in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    )
  );

-- ── A new brand is shared with whoever added it ─────────────────────────────
-- A Selected-brands manager may add brands and sees the ones they add. The
-- server's own inserts (service role, no person) and the demo brand (every
-- member's) add nothing; a server path that adds a brand for a person shares
-- it itself.
--
-- It runs after the row is stored, so it can't help the insert read its own
-- row back: PostgreSQL checks `insert … returning` against the select policy
-- before storing the row and before this trigger. Under 00389 a
-- Selected-brands person therefore adds a brand without asking for it back
-- (web createBrand: its own id, then a read) — see 00389.
create or replace function public.grant_brand_to_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_demo then
    return null;
  end if;
  insert into public.member_brands (organization_id, user_id, brand_id, granted_by)
  select new.organization_id, p.id, new.id, p.id
  from public.profiles p
  where p.id = auth.uid()
    and p.organization_id = new.organization_id
    and p.brand_scope = 'selected'
  on conflict (user_id, brand_id) do nothing;
  return null;
end;
$$;

revoke all on function public.grant_brand_to_creator() from public, anon, authenticated;

drop trigger if exists brands_grant_creator on public.brands;
create trigger brands_grant_creator
  after insert on public.brands
  for each row execute function public.grant_brand_to_creator();

-- ── invitations ─────────────────────────────────────────────────────────────

alter table public.invitations
  add column if not exists brand_scope text not null default 'all',
  add column if not exists brand_ids uuid[] not null default '{}';

alter table public.invitations
  drop constraint if exists invitations_brand_scope_check;
alter table public.invitations
  add constraint invitations_brand_scope_check
  check (brand_scope in ('all', 'selected'));

-- Brand ids only for Selected brands, and never for an admin.
alter table public.invitations
  drop constraint if exists invitations_brand_ids_check;
alter table public.invitations
  add constraint invitations_brand_ids_check
  check (brand_scope = 'selected' or cardinality(brand_ids) = 0);

alter table public.invitations
  drop constraint if exists invitations_admin_all_brands_check;
alter table public.invitations
  add constraint invitations_admin_all_brands_check
  check (role <> 'admin' or brand_scope = 'all');

comment on column public.invitations.brand_scope is
  'Brand access (00388): ''all'' or ''selected'', given to the person when they accept. Admins: always ''all''.';
comment on column public.invitations.brand_ids is
  'Brand access (00388): the brands shared on acceptance when brand_scope = ''selected''. Checked against the organization when set; a brand deleted since stays here and is skipped on acceptance.';

-- The brands named belong to the invitation's organization, when they are
-- set (an invitation accepted after one of them was deleted still updates).
create or replace function public.check_invitation_brands()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.brand_ids) as ids(brand_id)
    where not exists (
      select 1 from public.brands b
      where b.id = ids.brand_id and b.organization_id = new.organization_id
    )
  ) then
    raise exception 'invitation brands must belong to its organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_check_brands on public.invitations;
create trigger invitations_check_brands
  before insert or update of organization_id, brand_ids on public.invitations
  for each row execute function public.check_invitation_brands();

notify pgrst, 'reload schema';
