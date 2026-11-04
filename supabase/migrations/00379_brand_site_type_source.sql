-- ============================================================================
-- 00379: where a brand's site type came from (action plan by business type,
--        Step 0)
-- ============================================================================
-- Setup now detects the kind of site from the brand's home page
-- (backend/src/lib/siteTypeDetect.js) instead of leaving it empty, where
-- the app guessed B2B for most brands, shops included.
--
--   * brands.site_type_source: 'auto' when a detection set the type (the
--     home page, Shopping mode, a catalog), 'manual' when a person chose it
--     (Brand settings, the Content Editor). Setup's detection only fills an
--     empty type; a catalog never writes over a manual one. Null while no
--     type is set.
--   * brands.site_type_detected_at: when a detection last set the type. A
--     change of site_type that doesn't set it too is a person's, and the
--     trigger below marks it manual: so every place a person picks a type
--     wins without knowing about detection.
--   * A catalog source added to a brand (a feed, an upload, a store) makes
--     it an online shop, unless a person chose its type.

alter table public.brands
  add column if not exists site_type_source text
    check (site_type_source in ('auto', 'manual')),
  add column if not exists site_type_detected_at timestamptz;

comment on column public.brands.site_type_source is
  'Step 0 (action plan by business type): auto = detected (home page, Shopping mode, a catalog); manual = a person chose it. Detection only fills an empty type; a catalog never overwrites manual. Null while site_type is null.';
comment on column public.brands.site_type_detected_at is
  'Step 0: when a detection last set site_type. A site_type change without it is a person''s (marked manual).';

-- A type set before today was a person's choice.
update public.brands
   set site_type_source = 'manual'
 where site_type is not null
   and site_type_source is null;

-- A brand in Shopping mode, or with a catalog, already sells online.
update public.brands b
   set site_type = 'ecommerce',
       site_type_source = 'auto',
       site_type_detected_at = now()
 where b.site_type is null
   and (
     b.shopping_mode_enabled
     or exists (select 1 from public.catalog_sources s where s.brand_id = b.id)
   );

create or replace function public.mark_brand_site_type_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.site_type is null then
    -- No type: nothing chosen or detected; the app guesses again.
    new.site_type_source := null;
  elsif tg_op = 'INSERT' then
    new.site_type_source :=
      case when new.site_type_detected_at is null then 'manual' else 'auto' end;
  elsif new.site_type is distinct from old.site_type then
    -- A detection stamps site_type_detected_at with the type; a person doesn't.
    new.site_type_source :=
      case
        when new.site_type_detected_at is distinct from old.site_type_detected_at then 'auto'
        else 'manual'
      end;
  end if;
  return new;
end;
$$;

drop trigger if exists brands_site_type_source on public.brands;
create trigger brands_site_type_source
  before insert or update of site_type, site_type_source, site_type_detected_at
  on public.brands
  for each row execute function public.mark_brand_site_type_source();

-- A catalog source makes the brand a shop, unless a person chose its type.
-- As the person who adds it: admins and managers may add a source (00279)
-- and update the brand alike; the server adds stores as the service role.
create or replace function public.catalog_source_marks_ecommerce()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.brands
     set site_type = 'ecommerce',
         site_type_detected_at = now()
   where id = new.brand_id
     and site_type_source is distinct from 'manual'
     and site_type is distinct from 'ecommerce';
  return new;
end;
$$;

drop trigger if exists catalog_sources_mark_ecommerce on public.catalog_sources;
create trigger catalog_sources_mark_ecommerce
  after insert on public.catalog_sources
  for each row execute function public.catalog_source_marks_ecommerce();
