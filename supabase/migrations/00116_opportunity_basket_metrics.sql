-- What an action sent from a content opportunity is measured on (#857,
-- Phase 4): the opportunity's own basket, not the whole brand.
--
-- The Action Center measures an action's KPIs over a window before it was
-- raised and one after it closed. For signal-driven actions that reads the
-- whole brand, which is right for them. For a piece of content answering 20
-- of a brand's 700 prompts, the brand-wide numbers bury its effect, so these
-- actions read the same windows over just their prompts and pages.
--
-- One call returns the raw figures for one window; the server turns them
-- into metrics. Prompt figures come from the Insights rollups (00066), page
-- citations from the citation tables, page traffic from GA's AI traffic.
--
-- p_page_keys are page URLs lower-cased without scheme, www., query,
-- fragment or trailing slash; p_page_domains their hosts without www., which
-- narrows citation_urls through its domain index before the key match.
-- p_page_paths are the same pages as GA landing-page paths.

create or replace function public.opportunity_basket_metrics(
  p_brand_id uuid,
  p_prompt_ids uuid[],
  p_page_keys text[],
  p_page_domains text[],
  p_page_paths text[],
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with cells as (
    select count(*) as cells,
           count(*) filter (where has_mention or has_citation) as visible,
           coalesce(sum(answer_count) filter (where has_mention), 0) as mention_answers
    from insights_prompt_daily
    where brand_id = p_brand_id
      and day between p_from and p_to
      and prompt_id = any(p_prompt_ids)
  ),
  comp as (
    select d.competitor_id, count(*) as visible
    from insights_competitor_prompt_daily d
    join competitors c on c.id::text = d.competitor_id and c.brand_id = p_brand_id
    where d.brand_id = p_brand_id
      and d.day between p_from and p_to
      and d.prompt_id = any(p_prompt_ids)
    group by d.competitor_id
  ),
  urls as (
    select id
    from citation_urls
    where domain = any(p_page_domains)
      and rtrim(
            regexp_replace(split_part(split_part(lower(url), '#', 1), '?', 1), '^https?://(www\.)?', ''),
            '/'
          ) = any(p_page_keys)
  )
  select jsonb_build_object(
    'cells', (select cells from cells),
    'visible', (select visible from cells),
    'mention_answers', (select mention_answers from cells),
    'competitor_visible_total', (select coalesce(sum(visible), 0) from comp),
    'top_competitor_visible', (select coalesce(max(visible), 0) from comp),
    'page_citations', (
      select count(*)
      from prompt_result_citations
      where brand_id = p_brand_id
        and created_at >= p_from
        and created_at < p_to + 1
        and url_id in (select id from urls)
    ),
    'ga_connected', exists (
      select 1 from ga_ai_traffic_stats
      where brand_id = p_brand_id and date between p_from and p_to
    ),
    'page_ai_sessions', (
      select coalesce(sum(sessions), 0)
      from ga_ai_traffic_stats
      where brand_id = p_brand_id
        and date between p_from and p_to
        and coalesce(nullif(rtrim(split_part(landing_page, '?', 1), '/'), ''), '/') = any(p_page_paths)
    )
  );
$$;

revoke all on function public.opportunity_basket_metrics(uuid, uuid[], text[], text[], text[], date, date)
  from public, anon, authenticated;
grant execute on function public.opportunity_basket_metrics(uuid, uuid[], text[], text[], text[], date, date)
  to service_role;
