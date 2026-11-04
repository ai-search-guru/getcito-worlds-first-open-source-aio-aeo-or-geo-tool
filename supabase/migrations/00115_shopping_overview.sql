-- Shopping: compute the Overview tab in the database (#922).
--
-- The Overview KPIs, the per-platform card rate and the 30-day trend were
-- aggregated in JavaScript from rows fetched without paging, so PostgREST's
-- 1,000-row cap silently truncated them: the largest brand's 30-day window has
-- ~5.8k cards and ~117k results. The card-bearing count also filtered on the
-- wide `shopping_cards` jsonb column, an 11 s heap scan on that brand, past the
-- 8 s statement timeout. Here a result "has cards" when it has a row in
-- prompt_result_shopping_cards, read from that table's unique index, and the
-- results themselves come from the covering (brand_id, created_at) index:
-- ~0.5 s on the same window.
--
-- Security invoker: the caller's RLS on prompt_results and
-- prompt_result_shopping_cards still applies.

create or replace function public.shopping_overview(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_platforms text[] default null,
  p_regions text[] default null,
  p_trend_from timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  return (
    with results as materialized (
      select r.id, r.platform
      from public.prompt_results r
      where r.brand_id = p_brand_id
        and (p_from is null or r.created_at >= p_from)
        and (p_to is null or r.created_at <= p_to)
        and (p_platforms is null or r.platform = any (p_platforms))
        and (p_regions is null or r.region = any (p_regions))
    ),
    by_platform as (
      select res.platform,
             count(*) as total_results,
             count(*) filter (where exists (
               select 1 from public.prompt_result_shopping_cards c
               where c.prompt_result_id = res.id
             )) as results_with_cards
      from results res
      group by res.platform
    ),
    cards as materialized (
      select c.matched_brand_role, c.merchant_domain
      from public.prompt_result_shopping_cards c
      where c.brand_id = p_brand_id
        and (p_from is null or c.created_at >= p_from)
        and (p_to is null or c.created_at <= p_to)
        and (p_platforms is null or c.platform = any (p_platforms))
        and (p_regions is null or c.region = any (p_regions))
    ),
    top_merchant as (
      select merchant_domain, count(*) as card_count
      from cards
      where matched_brand_role = 'own' and merchant_domain is not null
      group by merchant_domain
      order by count(*) desc, merchant_domain
      limit 1
    ),
    trend as (
      select (c.created_at at time zone 'UTC')::date as day,
             count(*) filter (where c.matched_brand_role = 'own') as own_cards,
             count(*) as total_cards
      from public.prompt_result_shopping_cards c
      where c.brand_id = p_brand_id
        and p_trend_from is not null
        and c.created_at >= p_trend_from
        and (p_platforms is null or c.platform = any (p_platforms))
        and (p_regions is null or c.region = any (p_regions))
      group by 1
    )
    select jsonb_build_object(
      'total_results',       coalesce((select sum(total_results) from by_platform), 0),
      'results_with_cards',  coalesce((select sum(results_with_cards) from by_platform), 0),
      'total_cards',         (select count(*) from cards),
      'own_cards',           (select count(*) from cards where matched_brand_role = 'own'),
      'top_merchant',        (select jsonb_build_object('domain', merchant_domain,
                                                        'card_count', card_count)
                              from top_merchant),
      'by_platform', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'platform',           platform,
                  'total_results',      total_results,
                  'results_with_cards', results_with_cards)
                order by platform)
         from by_platform),
        '[]'::jsonb),
      'trend', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'day',         day,
                  'own_cards',   own_cards,
                  'total_cards', total_cards)
                order by day)
         from trend),
        '[]'::jsonb)
    )
  );
end;
$$;

-- The Shopping filter bar's platform and region options, from every result the
-- brand has: the previous read took the first 1,000 results only.
create or replace function public.shopping_filter_options(p_brand_id uuid)
returns table(platforms text[], regions text[])
language sql
stable
set search_path to 'public'
as $$
  select
    coalesce((
      select array_agg(distinct r.platform order by r.platform)
      from public.prompt_results r
      where r.brand_id = p_brand_id
        and r.platform is not null and r.platform <> ''
    ), '{}') as platforms,
    coalesce((
      select array_agg(distinct r.region order by r.region)
      from public.prompt_results r
      where r.brand_id = p_brand_id
        and r.region is not null and r.region <> ''
    ), '{}') as regions
$$;
