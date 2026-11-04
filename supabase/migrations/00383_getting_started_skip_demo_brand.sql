-- ============================================================================
-- 00383: the demo brand doesn't make a real brand "a later brand"
-- ============================================================================
-- 00197 runs Getting started at once for an organization's first brand and
-- asks first for a later one. Since the demo brand (00380), a person who
-- starts without a card has the demo brand first, so the brand they set up
-- after adding a card counted as a later brand: its Getting started waited
-- for an answer and the Actions page said "No actions yet" instead of the
-- 17 steps.
--
--   * start_brand_getting_started: only the organization's other real brands
--     (is_demo false) make a new brand ask first.
--   * Brands already caught by it: a real brand whose Getting started still
--     waits for an answer (confirmed_at and dismissed_at null), that has no
--     real brand before it in its organization, in an organization with a
--     demo brand, runs it now, as it would have. A second brand whose first
--     was deleted, with no demo brand, still asks: the demo brand didn't
--     cause it.

create or replace function public.start_brand_getting_started()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.getting_started (brand_id, confirmed_at)
  values (
    new.id,
    -- The organization's first real brand runs it; a later one asks first.
    -- The demo brand doesn't count (00380).
    case
      when exists (
        select 1 from public.brands b
        where b.organization_id = new.organization_id
          and b.id <> new.id
          and not b.is_demo
      ) then null
      else now()
    end
  )
  on conflict (brand_id) do nothing;
  return new;
end;
$$;

revoke all on function public.start_brand_getting_started() from public, anon, authenticated;

update public.getting_started gs
   set confirmed_at = now()
  from public.brands b
 where b.id = gs.brand_id
   and not b.is_demo
   and gs.confirmed_at is null
   and gs.dismissed_at is null
   and not exists (
     select 1 from public.brands earlier
     where earlier.organization_id = b.organization_id
       and earlier.id <> b.id
       and not earlier.is_demo
       and earlier.created_at <= b.created_at
   )
   -- Only where a demo brand is what made it "a later brand". Its own
   -- created_at is counted back from each rebuild (backend/src/lib/demo/
   -- core.js), so it can't be compared.
   and exists (
     select 1 from public.brands demo
     where demo.organization_id = b.organization_id
       and demo.is_demo
   );
