-- Where an opportunity came from (CONTENT-003): the nightly run (system),
-- the "+ New" button (manual), or a prompt's "Suggest Content" (prompt,
-- PROMPT-006). The list shows it as a badge and can filter by it, so the
-- summary figures above the list take the same filter.
--
-- Existing rows were all made by the nightly run, hence the default.
alter table public.content_opportunities
  add column if not exists source text not null default 'system';

alter table public.content_opportunities
  drop constraint if exists content_opportunities_source_check;
alter table public.content_opportunities
  add constraint content_opportunities_source_check
  check (source in ('system', 'manual', 'prompt'));

-- content_opportunity_aggregates (00103) with the source filter.
drop function if exists public.content_opportunity_aggregates(uuid, text, text, text, text, uuid, uuid);

create or replace function public.content_opportunity_aggregates(
  p_brand_id uuid,
  p_status text default null,
  p_impact text default null,
  p_type text default null,
  p_q text default null,
  p_prompt_id uuid default null,
  p_topic_id uuid default null,
  p_source text default null
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
    and (p_source is null or co.source = p_source)
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
  uuid,
  text
) to authenticated;
