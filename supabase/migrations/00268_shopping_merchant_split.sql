-- Shopping: where AI sends shoppers, and resellers cheaper than the brand (#1277).
--
-- 00225 stores each card's destination (merchant_kind, marketplace,
-- listing_id). Two reads over the brand's own products (cards with
-- matched_brand_role = 'own') build on it, in the Overview tab's window and
-- filters (p_from, p_to, p_platforms, p_regions and ChatGPT Shopping's market,
-- p_chatgpt_regions, as in shopping_overview since 00267):
--
--   1. shopping_merchant_split: the cards per destination (your store,
--      Amazon, Walmart, eBay, other marketplaces, other resellers). Cards
--      with no merchant URL (merchant_kind null) are counted apart, never
--      spread over the segments, so the segments add up to the classified
--      cards.
--   2. shopping_own_product_offers: the lowest price per merchant, listing,
--      title and currency, with the link of the card that showed it. The web
--      app matches these offers to the brand's store and flags the cheaper
--      resellers (frontend/src/lib/shoppingResellerPriceAlert.ts).
--
-- Both are aggregated here, not read as rows: PostgREST caps rows at 1,000,
-- and the offers come back as one jsonb value for the same reason. On the
-- largest brands the own products are a few hundred cards a quarter, read
-- through the (brand_id, matched_brand_role) indexes.
--
-- Security definer behind the same membership check as
-- shopping_amazon_share_weekly (00225), its sibling over these columns: the
-- check runs once, a non-member gets no rows (or an empty list), and the
-- reads below use the indexes without the per-row RLS filter.
--
-- Apply after 00267 and before deploying the web: the web passes
-- p_chatgpt_regions to both, as it does to shopping_overview.

create or replace function public.shopping_merchant_split(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_platforms text[] default null,
  p_regions text[] default null,
  p_chatgpt_regions text[] default null
)
returns table (
  own_store_cards bigint,
  amazon_cards bigint,
  walmart_cards bigint,
  ebay_cards bigint,
  other_marketplace_cards bigint,
  reseller_cards bigint,
  unclassified_cards bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
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
  select
    count(*) filter (where c.merchant_kind = 'own'),
    count(*) filter (where c.merchant_kind = 'marketplace' and c.marketplace = 'amazon'),
    count(*) filter (where c.merchant_kind = 'marketplace' and c.marketplace = 'walmart'),
    count(*) filter (where c.merchant_kind = 'marketplace' and c.marketplace = 'ebay'),
    count(*) filter (where c.merchant_kind = 'marketplace'
                       and coalesce(c.marketplace, '') not in ('amazon', 'walmart', 'ebay')),
    count(*) filter (where c.merchant_kind = 'reseller'),
    count(*) filter (where c.merchant_kind is null)
  from public.prompt_result_shopping_cards c
  where c.brand_id = p_brand_id
    and c.matched_brand_role = 'own'
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at <= p_to)
    and (p_platforms is null or c.platform = any (p_platforms))
    and (p_regions is null or c.region = any (p_regions))
    and (p_chatgpt_regions is null or c.platform <> 'chatgpt-shopping'
         or c.region = any (p_chatgpt_regions));
end;
$$;

revoke all on function public.shopping_merchant_split(uuid, timestamptz, timestamptz, text[], text[], text[]) from public, anon;
grant execute on function public.shopping_merchant_split(uuid, timestamptz, timestamptz, text[], text[], text[]) to authenticated, service_role;

-- One entry per merchant offer of the brand's own products: the classified
-- cards with a price, grouped by destination, listing, title (case and outer
-- spaces aside) and currency. Repeat sightings of the same offer collapse to
-- its lowest price, all the price rule needs, so the list stays short.
create or replace function public.shopping_own_product_offers(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_platforms text[] default null,
  p_regions text[] default null,
  p_chatgpt_regions text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1
    from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id
      and pf.id = auth.uid()
  ) then
    return '[]'::jsonb;
  end if;

  return (
    with offers as (
      select
        c.merchant_kind,
        c.marketplace,
        c.merchant_domain,
        c.listing_id,
        min(c.product_title) as product_title,
        upper(btrim(c.price_currency)) as price_currency,
        min(c.price_amount) as price_amount,
        (array_agg(c.merchant_url order by c.price_amount, c.created_at desc))[1] as merchant_url
      from public.prompt_result_shopping_cards c
      where c.brand_id = p_brand_id
        and c.matched_brand_role = 'own'
        and c.merchant_kind is not null
        and c.merchant_url is not null
        and c.price_amount > 0
        and nullif(btrim(c.price_currency), '') is not null
        and (p_from is null or c.created_at >= p_from)
        and (p_to is null or c.created_at <= p_to)
        and (p_platforms is null or c.platform = any (p_platforms))
        and (p_regions is null or c.region = any (p_regions))
        and (p_chatgpt_regions is null or c.platform <> 'chatgpt-shopping'
             or c.region = any (p_chatgpt_regions))
      group by
        c.merchant_kind,
        c.marketplace,
        c.merchant_domain,
        c.listing_id,
        lower(btrim(c.product_title)),
        upper(btrim(c.price_currency))
    )
    -- Without both a store offer and another merchant's there is nothing to
    -- compare: return an empty list rather than every store offer.
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'merchant_kind',   o.merchant_kind,
        'marketplace',     o.marketplace,
        'merchant_domain', o.merchant_domain,
        'merchant_url',    o.merchant_url,
        'listing_id',      o.listing_id,
        'product_title',   o.product_title,
        'price_amount',    o.price_amount,
        'price_currency',  o.price_currency)),
      '[]'::jsonb)
    from offers o
    where exists (select 1 from offers x where x.merchant_kind = 'own')
      and exists (select 1 from offers x where x.merchant_kind <> 'own')
  );
end;
$$;

revoke all on function public.shopping_own_product_offers(uuid, timestamptz, timestamptz, text[], text[], text[]) from public, anon;
grant execute on function public.shopping_own_product_offers(uuid, timestamptz, timestamptz, text[], text[], text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
