-- ============================================================================
-- 00228: a profile's role and organization are set by the server
-- ============================================================================
-- Roles change through team management, and a person joins an organization
-- through an invitation; both run with the service role. A member's own
-- update of their profile is for their name, avatar and onboarding state.
--
-- The one organization a person sets for themselves is the first, in
-- onboarding: right after creating it, while it has no other member. This
-- trigger keeps a profile's own update to that:
--   - `role` only changes with the service role;
--   - `organization_id` only changes with the service role, or from null to
--     an organization nobody else belongs to yet.

create or replace function public.organization_has_other_members(p_org uuid, p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.organization_id = p_org and p.id <> p_except
  );
$$;
revoke all on function public.organization_has_other_members(uuid, uuid) from public, anon;
grant execute on function public.organization_has_other_members(uuid, uuid) to authenticated, service_role;

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
  return new;
end;
$$;

drop trigger if exists profiles_guard_server_columns on public.profiles;
create trigger profiles_guard_server_columns
  before update on public.profiles
  for each row execute function public.guard_profile_server_columns();
