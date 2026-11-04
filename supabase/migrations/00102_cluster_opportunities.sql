-- Content opportunities per prompt cluster (#857).
--
-- An opportunity now belongs to a prompt cluster (00101) instead of a single
-- prompt. cluster_id is the cluster it was generated for. related_cluster_ids
-- holds clusters in other topics found to need the same content: they are
-- merged into the existing opportunity instead of getting a near-copy of it.
-- prompt_id stays, set to the cluster's highest-volume prompt, so the prompt
-- filter, webhooks and briefs keep working until they move to clusters.
--
-- Rows from before this change keep cluster_id null.

alter table public.content_opportunities
  add column cluster_id uuid references public.prompt_clusters(id) on delete set null,
  add column related_cluster_ids uuid[] not null default '{}';

create index idx_co_cluster_id on public.content_opportunities (cluster_id);

-- Per-prompt visibility for ranking clusters, read from the Insights rollups
-- (00066) rather than prompt_results: on the largest brand the same figures
-- from raw answers take about 50 s, from the rollups under one second.
--
-- Both rates are shares of the prompt's engine-days in the window: the
-- brand's is the share where it was mentioned or cited, a competitor's the
-- share where it was visible. top_competitor_visibility is the strongest
-- live competitor's rate, and competitors lists up to five, strongest first.
create or replace function public.brand_prompt_opportunity_metrics(
  p_brand_id uuid,
  p_since date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with cells as (
    select prompt_id,
           count(*) as cells,
           count(*) filter (where has_mention or has_citation) as visible
    from insights_prompt_daily
    where brand_id = p_brand_id and day >= p_since
    group by prompt_id
  ),
  comp as (
    select d.prompt_id, c.name, count(*) as visible
    from insights_competitor_prompt_daily d
    join competitors c on c.id::text = d.competitor_id and c.brand_id = p_brand_id
    where d.brand_id = p_brand_id and d.day >= p_since
    group by d.prompt_id, c.name
  ),
  top as (
    select prompt_id,
           max(visible) as visible,
           (array_agg(name order by visible desc, name))[1:5] as names
    from comp
    group by prompt_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'prompt_id', c.prompt_id,
    'cells', c.cells,
    'visibility', round(100.0 * c.visible / c.cells, 1),
    'top_competitor_visibility', round(100.0 * coalesce(t.visible, 0) / c.cells, 1),
    'competitors', coalesce(to_jsonb(t.names), '[]'::jsonb)
  )), '[]'::jsonb)
  from cells c
  left join top t on t.prompt_id = c.prompt_id;
$$;

revoke all on function public.brand_prompt_opportunity_metrics(uuid, date) from public, anon, authenticated;
grant execute on function public.brand_prompt_opportunity_metrics(uuid, date) to service_role;
