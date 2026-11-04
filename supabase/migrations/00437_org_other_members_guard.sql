-- ============================================================================
-- 00437: organization_has_other_members answers only its trigger and the server
-- ============================================================================
-- 00228 added it for the profile guard: a person may set their first
-- organization only while nobody else belongs to it. It reads every
-- organization's members (security definer), and signed-in people can execute
-- it because the guard runs as them. So anyone signed in could also call it
-- directly and ask "does this organization have other members?" about any
-- organization.
--
-- It now answers only inside a trigger (the guard, which passes the updated
-- row's own organization and id) or for the service role; a direct call from
-- a signed-in person gets false. Execute stays with authenticated so the guard
-- keeps working. Same definition as 00228 otherwise.

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
  )
  and (pg_catalog.pg_trigger_depth() > 0 or (select auth.role()) = 'service_role');
$$;
revoke all on function public.organization_has_other_members(uuid, uuid) from public, anon;
grant execute on function public.organization_has_other_members(uuid, uuid) to authenticated, service_role;
