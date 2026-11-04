-- ============================================================================
-- 00350: each catalog category's page on the brand's site (shopping path, 1)
-- ============================================================================
-- A brand's catalog names its categories (00278, from the products'
-- product_type: "Shoes > Hiking Boots"), but not where each one lives on the
-- site. The shopping path links a buying guide or a comparison to that page
-- (/collections/hiking-boots), so the API matches each category to one of
-- the brand's own pages that reads as a category (site_pages, 00104), every
-- time it's asked: nothing here keeps those matches.
--
--   * `catalog_category_pages` keeps what a person decided instead: the
--     page for a category (`url`), or that it has none (`url` null). A
--     category with no row is matched automatically. Keyed by the
--     category's name, as the catalog keeps it, so a decision outlives a
--     sync that writes the category again.
--   * Members read their brands' rows; the API writes them, for admins
--     and managers, after checking the page is on the brand's domains.
--   * `catalog_category_counts`: each category's live products and how
--     many of them have a variant in stock, for the Settings table and the
--     shopping path. In stock as the editor's feed match reads a variant
--     (frontend/src/lib/content/feedMatch.ts, feedStock): in_stock, instock,
--     available or limited_availability, whatever its case, spaces or
--     hyphens. The service role calls it.

create table if not exists public.catalog_category_pages (
  brand_id uuid not null references public.brands(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 750),
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (brand_id, category)
);

alter table public.catalog_category_pages enable row level security;
revoke all on table public.catalog_category_pages from anon, authenticated;
grant select on table public.catalog_category_pages to authenticated;
grant all on table public.catalog_category_pages to service_role;

drop policy if exists "catalog_category_pages: member select" on public.catalog_category_pages;
create policy "catalog_category_pages: member select"
  on public.catalog_category_pages
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.catalog_category_pages is
  'Shopping path (00350): the page a person set for a catalog category (url), or that it has none (url null). Categories with no row are matched to the brand''s site pages by the API on each read. Server writes, members read.';

create or replace function public.catalog_category_counts(p_brand_id uuid)
returns table (category text, products integer, in_stock integer)
language sql
stable
set search_path = public
as $$
  select c.name,
         count(distinct p.id)::integer,
         count(distinct p.id) filter (where exists (
           select 1 from public.catalog_variants v
           where v.product_id = p.id
             and v.removed_at is null
             and lower(regexp_replace(v.availability, '[\s-]+', '_', 'g'))
               in ('in_stock', 'instock', 'available', 'limited_availability')
         ))::integer
  from public.catalog_categories c
  join public.catalog_product_categories pc on pc.category_id = c.id
  join public.catalog_products p on p.id = pc.product_id and p.removed_at is null
  where c.brand_id = p_brand_id
  group by c.name
$$;

revoke all on function public.catalog_category_counts(uuid) from public, anon, authenticated;
grant execute on function public.catalog_category_counts(uuid) to service_role;

comment on function public.catalog_category_counts(uuid) is
  'Shopping path (00350): each catalog category of a brand with its live products and how many have a variant in stock (in_stock, instock, available or limited_availability, as feedMatch.ts reads it). Service role only.';

notify pgrst, 'reload schema';
