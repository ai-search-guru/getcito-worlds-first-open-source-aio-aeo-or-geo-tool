-- ============================================================================
-- 00374: menu access — which left-menu sections each role and person sees
-- ============================================================================
-- Admins pick which sections of the left menu each role sees, and can let
-- chosen managers do it too (Settings › Menu access). People pick what they
-- work on or lead, which narrows their own menu (the "What do you work on?"
-- step and Settings › Account). Hide only: a hidden section is off the menu,
-- its pages still open from a link, and roles and data access don't change.
-- Nobody takes a section off an admin's menu (only their own work areas
-- narrow it), and Action Center is on everyone's menu (the app applies both).
--
-- Sections are named by their route under /dashboard ('content', 'audit',
-- 'insights'…), so a section added later is on everyone's menu until someone
-- hides it.
--
--   * organization_menu_roles: per organization and role (not admin), the
--     sections that role doesn't see. No row = the role sees every section.
--     Members of the organization read it (their menu needs their role's
--     row); the server writes it (service role), for an admin or a manager
--     who can change menus.
--   * profiles.menu_shown / menu_hidden: a person's exception to their role:
--     a section shown that the role hides, or hidden that it shows.
--     profiles.can_manage_menus: a manager an admin let change menus. All
--     three are set by the server (the guard below), like role, and belong
--     to the organization and role they were given for: moving organization
--     (removed, then invited elsewhere) clears all three, and a new role
--     clears can_manage_menus (the reset below).
--   * profiles.work_areas: what the person works on or leads, theirs to set.
--     work_areas_asked_at: when they answered (or skipped) the step, so it
--     is asked once.

create table if not exists public.organization_menu_roles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.user_role not null check (role <> 'admin'),
  hidden_sections text[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, role)
);

-- Read by members of the organization (the policy below); written by the server.
alter table public.organization_menu_roles enable row level security;
revoke all on table public.organization_menu_roles from anon, authenticated;
grant select on table public.organization_menu_roles to authenticated;
grant all on table public.organization_menu_roles to service_role;

drop policy if exists "organization_menu_roles: member select" on public.organization_menu_roles;
create policy "organization_menu_roles: member select"
  on public.organization_menu_roles
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

drop trigger if exists trg_organization_menu_roles_updated_at on public.organization_menu_roles;
create trigger trg_organization_menu_roles_updated_at
  before update on public.organization_menu_roles
  for each row execute function public.handle_updated_at();

comment on table public.organization_menu_roles is
  'Menu access: the left-menu sections (routes under /dashboard) a role of the organization doesn''t see. Hide only: the pages still open. No row = every section. Never for admins; the server writes it.';

alter table public.profiles
  add column if not exists work_areas text[] not null default '{}'
    check (
      work_areas <@ array[
        'leaders', 'aeo', 'content', 'brand', 'growth',
        'product', 'bizdev', 'developers', 'analytics'
      ]::text[]
    ),
  add column if not exists work_areas_asked_at timestamptz,
  add column if not exists menu_shown text[] not null default '{}',
  add column if not exists menu_hidden text[] not null default '{}',
  add column if not exists can_manage_menus boolean not null default false;

comment on column public.profiles.work_areas is
  'Menu access: what the person works on or leads; narrows their left menu to those areas'' sections. Empty = every section.';
comment on column public.profiles.work_areas_asked_at is
  'Menu access: when the person answered or skipped "What do you work on?"; null = not asked yet.';
comment on column public.profiles.menu_shown is
  'Menu access: sections shown for this person although their role hides them. Set by the server.';
comment on column public.profiles.menu_hidden is
  'Menu access: sections hidden for this person although their role shows them. Set by the server.';
comment on column public.profiles.can_manage_menus is
  'Menu access: a manager an admin let change menus (the role table and every non-admin''s exceptions). Set by the server.';

-- 00228's guard, plus the menu columns: a person's own update can't give
-- them a menu exception or the right to change menus.
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
  return new;
end;
$$;

-- A removed member keeps their profile (organization_id goes null) and an
-- invitation moves it to the next organization, so a menu manager of one
-- organization would arrive in another still able to change its menus.
-- Whoever makes the change, a new organization clears the menu columns and
-- a new role clears the right to change menus (an admin gives it again);
-- a value the same update sets stays, only one carried over goes. Fires
-- after the guard (triggers run in name order), so the guard checks what
-- the person asked for, not this reset.
create or replace function public.reset_profile_menu_access()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.organization_id is distinct from old.organization_id
      or new.role is distinct from old.role)
     and new.can_manage_menus is not distinct from old.can_manage_menus
  then
    new.can_manage_menus := false;
  end if;
  if new.organization_id is distinct from old.organization_id then
    if new.menu_shown is not distinct from old.menu_shown then
      new.menu_shown := '{}';
    end if;
    if new.menu_hidden is not distinct from old.menu_hidden then
      new.menu_hidden := '{}';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reset_menu_access on public.profiles;
create trigger profiles_reset_menu_access
  before update of organization_id, role on public.profiles
  for each row execute function public.reset_profile_menu_access();

-- Everyone here before menu access counts as asked: "What do you work on?"
-- is for new sign-ups and people joining from an invite, once. Existing
-- people pick their work areas in Settings › Account if they want to.
update public.profiles set work_areas_asked_at = now() where work_areas_asked_at is null;

notify pgrst, 'reload schema';
