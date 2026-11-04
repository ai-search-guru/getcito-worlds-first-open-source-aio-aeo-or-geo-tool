-- citations_urls_daily returned no rows to signed-in users.
--
-- It joins citation_urls, which has no select policy for the authenticated
-- role (its rows are shared across brands; the raw citations_urls reads it as
-- security definer). As security invoker, 00118's version saw an empty
-- citation_urls and the Citations URL table came back empty.
--
-- Security definer like citations_urls, with the same organization check made
-- explicit, since RLS no longer scopes the rollup read.

create or replace function public.citations_urls_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000,
  p_domains text[] default null,
  p_exclude_domains text[] default null
) returns table(url text, domain text, title text, total_citations bigint,
                results_citing bigint, models text[], total_urls bigint)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return;
  end if;

  return query
  with agg as (
    select u.url_id as uid,
           sum(u.citations)::bigint as tc,
           sum(u.results)::bigint as rc,
           array_agg(distinct coalesce(u.model_used, u.platform)) as ms
    from public.citation_url_daily u
    where u.brand_id = p_brand_id
      and (p_day_from  is null or u.day >= p_day_from)
      and (p_day_to    is null or u.day <= p_day_to)
      and (p_models    is null or u.model_used = any(p_models))
      and (p_regions   is null or u.region = any(p_regions))
      and (p_topic_ids is null or u.topic_id = any(p_topic_ids))
    group by u.url_id
  ),
  include_ids as (
    select cu.id from public.citation_urls cu
    where p_domains is not null and cu.domain = any(p_domains)
  ),
  exclude_ids as (
    select cu.id from public.citation_urls cu
    where p_exclude_domains is not null and cu.domain = any(p_exclude_domains)
  ),
  scoped as materialized (
    select a.*
    from agg a
    where (p_domains is null
           or exists (select 1 from include_ids i where i.id = a.uid))
      and (p_exclude_domains is null
           or not exists (select 1 from exclude_ids e where e.id = a.uid))
  )
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from scoped)
  from (select * from scoped order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
end;
$$;

revoke execute on function public.citations_urls_daily(uuid, date, date, text[], text[], uuid[], integer, text[], text[])
  from public, anon;
grant execute on function public.citations_urls_daily(uuid, date, date, text[], text[], uuid[], integer, text[], text[])
  to authenticated, service_role;
