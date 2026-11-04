-- ============================================================================
-- 00361: AI visits and orders per catalog product (product visibility, part 4)
-- ============================================================================
-- Product Visibility's Products table (ECOM-007) shows, for each product in
-- the brand's catalog (00278), the AI-referred visits its page got and the
-- orders those visits led to, beside where it stands on the AI shelf. No
-- source carries an order's line items yet (Shopify order sync, #1267), so an
-- order is credited to the product whose page the AI visitor landed on first:
-- ai_traffic_events.first_url (CE-017, 00286).
--
--   * ai_visits: AI-referred page views on the product's page (the tracking
--     snippet, ai_traffic_logs: a visit's first view, from an AI source);
--   * orders, revenue: order conversions whose AI visit started on it, the
--     revenue in its main currency;
--   * a product's page is its link, else its first variant's, matched as
--     page paths are everywhere (normalize_page_path, lowercased);
--   * only the products with an AI visit or an order: a big catalog's other
--     products would only add zero rows, past PostgREST's 1000-row page;
--   * p_product_id: that one product's row (its page), none for all.
--
-- Members of the brand's organization only, as the Shopping reads.

create or replace function public.catalog_product_ai_stats(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz default null,
  p_product_id uuid default null
)
returns table (
  product_id uuid,
  ai_visits bigint,
  orders bigint,
  revenue numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1
    from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id
      and pf.id = auth.uid()
  ) then
    return;
  end if;

  return query
  with pages as (
    select
      p.id as product_id,
      lower(public.normalize_page_path(coalesce(p.url, (
        select v.url
        from public.catalog_variants v
        where v.product_id = p.id and v.removed_at is null and v.url is not null
        order by v.external_id
        limit 1
      )))) as page
    from public.catalog_products p
    where p.brand_id = p_brand_id
      and p.removed_at is null
      and (p_product_id is null or p.id = p_product_id)
  ),
  keyed as (
    select pages.product_id, pages.page
    from pages
    where pages.page is not null and pages.page <> '/'
  ),
  visits as (
    select lower(public.normalize_page_path(l.url)) as page, count(*) as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.created_at >= p_from
      and (p_to is null or l.created_at < p_to)
      and l.visit_of is null
      and l.source_platform is not null
    group by 1
  ),
  sales as (
    select e.first_key as page, e.currency, count(*) as n, coalesce(sum(e.value), 0) as value
    from public.ai_traffic_events e
    where e.brand_id = p_brand_id
      and e.kind = 'conversion'
      and e.goal = 'order'
      and e.occurred_at >= p_from
      and (p_to is null or e.occurred_at < p_to)
    group by 1, 2
  ),
  -- A page's orders in its main currency: the one most of them are in.
  main_sales as (
    select distinct on (s.page) s.page, s.currency, s.value
    from sales s
    order by s.page, s.n desc, s.currency
  ),
  all_sales as (
    select s.page, sum(s.n) as n
    from sales s
    group by 1
  )
  select
    k.product_id,
    coalesce(v.n, 0)::bigint,
    coalesce(a.n, 0)::bigint,
    m.value,
    m.currency
  from keyed k
  left join visits v on v.page = k.page
  left join all_sales a on a.page = k.page
  left join main_sales m on m.page = k.page
  where v.n is not null or a.n is not null;
end;
$$;

revoke all on function public.catalog_product_ai_stats(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.catalog_product_ai_stats(uuid, timestamptz, timestamptz, uuid)
  to authenticated, service_role;

comment on function public.catalog_product_ai_stats(uuid, timestamptz, timestamptz, uuid) is
  'Product visibility, part 4 (00361): per live catalog product of a brand with an AI visit or an order (or the one p_product_id names), the AI-referred visits to its page and the orders whose AI visit started there (first_url), with their revenue in the main currency. A product''s page is its link, else its first variant''s. Security definer with an organization check.';

notify pgrst, 'reload schema';
