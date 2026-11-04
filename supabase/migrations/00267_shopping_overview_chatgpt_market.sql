-- Shopping: keep ChatGPT Shopping to one market in the Overview (#1278).
--
-- ChatGPT Shopping picks products differently by market (the US from OpenAI's
-- product index, Europe from Google Shopping), so the Shopping page has a
-- US / Europe switch that keeps ChatGPT Shopping's cards to the market's
-- regions. The card reads apply it as a PostgREST filter; the Overview's KPIs
-- and charts come from this function, whose `p_regions` narrows every
-- platform. `p_chatgpt_regions` narrows ChatGPT Shopping's results and cards
-- only and lets every other platform through. Null, the default, changes
-- nothing: a call without it reads exactly what it did before.
--
-- APPLY BEFORE DEPLOYING THE WEB. The new web passes `p_chatgpt_regions`, which
-- the old function doesn't have; the old web's calls match the new function,
-- since the parameter has a default.
--
-- A new parameter makes a new overload under create or replace, and PostgREST
-- would then have two candidates for one call. So the 6-argument version is
-- dropped first, and the new one gets the grants it had. The body is 00115's,
-- with one condition added to the results, cards and trend.

drop function if exists public.shopping_overview(
  uuid, timestamptz, timestamptz, text[], text[], timestamptz
);

create or replace function public.shopping_overview(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_platforms text[] default null,
  p_regions text[] default null,
  p_trend_from timestamptz default null,
  p_chatgpt_regions text[] default null
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
        and (p_chatgpt_regions is null or r.platform <> 'chatgpt-shopping'
             or r.region = any (p_chatgpt_regions))
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
        and (p_chatgpt_regions is null or c.platform <> 'chatgpt-shopping'
             or c.region = any (p_chatgpt_regions))
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
        and (p_chatgpt_regions is null or c.platform <> 'chatgpt-shopping'
             or c.region = any (p_chatgpt_regions))
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

grant execute on function public.shopping_overview(
  uuid, timestamptz, timestamptz, text[], text[], timestamptz, text[]
) to public, anon, authenticated, service_role;
