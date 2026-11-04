-- ============================================================================
-- 00473: a brand's Google properties are set by the server
-- ============================================================================
-- A brand's Search Console site (gsc_property) and Analytics property
-- (ga_property_id) are picked from the list of the Google sign-in the brand
-- uses, and the server checks the pick is on that list and that the person
-- reaches every brand on the sign-in (PUT
-- /api/integrations/{google-search-console,google-analytics}/brands/:id/property).
-- The syncs then read the property through that sign-in. This trigger keeps
-- the two columns to the server: a member's own insert or update of a brand
-- leaves them as they are.

create or replace function public.guard_brand_google_properties()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.gsc_property is not null or new.ga_property_id is not null then
      raise exception 'a brand''s Google properties are set server-side' using errcode = '42501';
    end if;
  elsif new.gsc_property is distinct from old.gsc_property
     or new.ga_property_id is distinct from old.ga_property_id
  then
    raise exception 'a brand''s Google properties are set server-side' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists brands_guard_google_properties on public.brands;
create trigger brands_guard_google_properties
  before insert or update on public.brands
  for each row execute function public.guard_brand_google_properties();
