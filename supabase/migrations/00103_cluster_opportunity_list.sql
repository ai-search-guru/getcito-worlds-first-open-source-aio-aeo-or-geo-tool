-- The Content page reads opportunities through their clusters (#857).
--
-- 1. Archive the per-prompt backlog. Before 00102, opportunities were
--    generated per prompt and piled up: thousands of open ones across brands,
--    up to ~760 on one brand, almost none ever worked on. Cluster
--    opportunities would be lost among them. Untouched ones (status 'new', no
--    brief) move to 'archived', which the list and its summary hide unless
--    asked for. Nothing is deleted: setting one back to 'new' restores it.
--    Ones with a brief, or that moved past 'new', are left alone.
--
-- 2. content_opportunity_aggregates takes the list's new filters. A prompt
--    matches the opportunities of its cluster, not only the ones whose
--    prompt_id it is; a topic matches opportunities whose own or merged
--    clusters are in it. It also counts the brand's signals: the prompts
--    and fan-out queries its clusters were built from.

update public.content_opportunities
   set status = 'archived', updated_at = now()
 where cluster_id is null
   and status = 'new'
   and brief is null;

drop function if exists public.content_opportunity_aggregates(uuid, text, text, text, text, uuid);

create or replace function public.content_opportunity_aggregates(
  p_brand_id uuid,
  p_status text default null,
  p_impact text default null,
  p_type text default null,
  p_q text default null,
  p_prompt_id uuid default null,
  p_topic_id uuid default null
)
returns table (
  avg_score numeric,
  high_impact_count bigint,
  sent_count bigint,
  signal_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(avg(co.opportunity_score), 0) as avg_score,
    count(*) filter (
      where co.impact = 'high'
    ) as high_impact_count,
    count(*) filter (
      where co.status in ('sent', 'in_progress', 'done')
    ) as sent_count,
    (
      select count(*)
      from prompt_cluster_members m
      join prompt_clusters pc on pc.id = m.cluster_id
      where pc.brand_id = p_brand_id
    ) + (
      select count(*)
      from prompt_cluster_queries q
      join prompt_clusters pc on pc.id = q.cluster_id
      where pc.brand_id = p_brand_id
    ) as signal_count
  from public.content_opportunities co
  where co.brand_id = p_brand_id
    and (
      (p_status is null and co.status <> 'archived')
      or co.status = p_status
    )
    and (p_impact is null or co.impact = p_impact)
    and (p_type is null or co.type = p_type)
    and (
      p_prompt_id is null
      or co.prompt_id = p_prompt_id
      or exists (
        select 1
        from prompt_cluster_members m
        where m.prompt_id = p_prompt_id
          and (m.cluster_id = co.cluster_id or m.cluster_id = any(co.related_cluster_ids))
      )
    )
    and (
      p_topic_id is null
      or exists (
        select 1
        from prompt_clusters pc
        where pc.topic_id = p_topic_id
          and (pc.id = co.cluster_id or pc.id = any(co.related_cluster_ids))
      )
    )
    and (
      p_q is null
      or co.title ilike '%' || p_q || '%'
      or co.description ilike '%' || p_q || '%'
    );
$$;

grant execute on function public.content_opportunity_aggregates(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid
) to authenticated;
