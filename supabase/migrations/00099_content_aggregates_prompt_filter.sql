-- Content opportunities can be filtered by prompt (#836).
--
-- The list query takes the new filter directly; the summary cards above it
-- come from this aggregate, which has to take the same filter or it would
-- keep describing the whole brand while the list shows one prompt.
--
-- The old five-argument version is dropped rather than overloaded: PostgREST
-- resolves RPCs by argument names, and two candidates that both accept the
-- same five names would be ambiguous.

drop function if exists public.content_opportunity_aggregates(uuid, text, text, text, text);

create or replace function public.content_opportunity_aggregates(
  p_brand_id uuid,
  p_status text default null,
  p_impact text default null,
  p_type text default null,
  p_q text default null,
  p_prompt_id uuid default null
)
returns table (
  avg_score numeric,
  high_impact_count bigint,
  sent_count bigint
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
    ) as sent_count
  from public.content_opportunities co
  where co.brand_id = p_brand_id
    and (p_status is null or co.status = p_status)
    and (p_impact is null or co.impact = p_impact)
    and (p_type is null or co.type = p_type)
    and (p_prompt_id is null or co.prompt_id = p_prompt_id)
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
  uuid
) to authenticated;
