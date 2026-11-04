-- ============================================================================
-- 00371: catalog categories for shopping suggestions, counted in the database
-- ============================================================================
-- Shopping prompt suggestions (ECOM-003, 00362) offer the model a brand's
-- biggest catalog categories, each with its price band. The server read the
-- whole live catalog for that, a page at a time (every product, category
-- link and variant), to keep 8 categories, and cut the categories at an
-- arbitrary 1,000. `catalog_suggestion_categories` counts here instead and
-- returns only the categories offered:
--
--   * a category's live products (removed_at null), p_min_products at least;
--   * a product's price: its lowest live variant's, on sale or not, above
--     zero, in that variant's currency;
--   * when every priced product of the category shares one currency: the
--     lowest and the highest price, and the price three quarters of them
--     sell at or under (price_p75; the server rounds it to one a shopper
--     would name);
--   * the most products first, then by name, p_limit of them.
--
-- Products and variants are read by brand, live only, so their brand
-- indexes (00278, 00281) serve the read, not every brand's rows.
--
-- The service role calls it, as 00350's catalog_category_counts.

create or replace function public.catalog_suggestion_categories(
  p_brand_id uuid,
  p_limit integer default 8,
  p_min_products integer default 2
)
returns table (
  category text,
  products integer,
  price_low numeric,
  price_high numeric,
  price_p75 numeric,
  currency text
)
language sql
stable
set search_path = public
as $$
  with live as (
    select pc.category_id, pc.product_id
    from public.catalog_product_categories pc
    join public.catalog_products p
      on p.id = pc.product_id and p.brand_id = p_brand_id and p.removed_at is null
    where pc.brand_id = p_brand_id
  ),
  priced as (
    select distinct on (v.product_id)
           v.product_id,
           coalesce(v.sale_price, v.price) as amount,
           v.currency
    from public.catalog_variants v
    where v.brand_id = p_brand_id
      and v.removed_at is null
      and v.product_id in (select l.product_id from live l)
      and coalesce(v.sale_price, v.price) > 0
    order by v.product_id, coalesce(v.sale_price, v.price), v.id
  ),
  counted as (
    select c.name as name,
           count(*)::integer as product_count,
           count(distinct coalesce(pr.currency, '')) filter (where pr.product_id is not null)
             as currencies,
           max(pr.currency) as one_currency,
           min(pr.amount) as low,
           max(pr.amount) as high,
           percentile_disc(0.75) within group (order by pr.amount) as p75
    from public.catalog_categories c
    join live l on l.category_id = c.id
    left join priced pr on pr.product_id = l.product_id
    where c.brand_id = p_brand_id
    group by c.id, c.name
    having count(*) >= p_min_products
  )
  select k.name,
         k.product_count,
         case when k.currencies = 1 and k.one_currency is not null then k.low end,
         case when k.currencies = 1 and k.one_currency is not null then k.high end,
         case when k.currencies = 1 and k.one_currency is not null then k.p75 end,
         case when k.currencies = 1 then k.one_currency end
  from counted k
  order by k.product_count desc, k.name
  limit greatest(p_limit, 0)
$$;

revoke all on function public.catalog_suggestion_categories(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.catalog_suggestion_categories(uuid, integer, integer)
  to service_role;

comment on function public.catalog_suggestion_categories(uuid, integer, integer) is
  'Shopping prompt suggestions (ECOM-003, 00371): a brand''s catalog categories with the most live products (p_min_products at least, p_limit of them), each with the lowest, highest and 75th-percentile price of its products (a product''s lowest live variant price, sale price first) when they share one currency. Service role only.';

notify pgrst, 'reload schema';
