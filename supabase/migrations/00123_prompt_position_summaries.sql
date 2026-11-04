-- Per-prompt, per-platform position aggregates for the Tracked Prompts table
-- (PROMPT-007): the Positions column's average position, its trend against
-- the previous period, and a dot per platform.
--
-- One GROUP BY in Postgres, like prompt_visibility_summaries (00025/00072),
-- rather than pulling every answer of every prompt into the page. The web
-- adds the sums up over the plan-included platforms, which keeps the average
-- the same as the Positions panel's: the mean mention position over the
-- answers that mention the brand.
--
-- Sums and counts rather than averages, so platforms can be combined without
-- weighting errors. chatgpt-shopping is excluded like every analytical
-- surface (#155); p_region scopes to one tracked location (#691).

create or replace function public.prompt_position_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null,
  p_region    text default null
)
returns table (
  prompt_id       uuid,
  platform        text,
  runs            bigint,
  mention_answers bigint,
  -- Over answers that mention the brand and store a position.
  position_sum    double precision,
  position_count  bigint,
  -- How many brands those answers named, for Early / Mid / Late.
  entity_sum      double precision,
  entity_count    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select pr.prompt_id,
         pr.platform,
         count(*)::bigint as runs,
         count(*) filter (where pr.mention_count > 0)::bigint as mention_answers,
         coalesce(sum(pr.mention_position) filter (
           where pr.mention_count > 0 and pr.mention_position > 0), 0)::double precision
                                                              as position_sum,
         count(*) filter (
           where pr.mention_count > 0 and pr.mention_position > 0)::bigint as position_count,
         coalesce(sum(pr.mentioned_entity_count) filter (
           where pr.mention_count > 0 and pr.mention_position > 0
             and pr.mentioned_entity_count > 0), 0)::double precision as entity_sum,
         count(*) filter (
           where pr.mention_count > 0 and pr.mention_position > 0
             and pr.mentioned_entity_count > 0)::bigint      as entity_count
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (p_date_from is null or pr.created_at >= p_date_from)
    and (p_date_to   is null or pr.created_at <= p_date_to)
    and (p_region    is null or pr.region = p_region)
  group by pr.prompt_id, pr.platform
$$;

grant execute on function
  public.prompt_position_summaries(uuid, timestamptz, timestamptz, text)
  to authenticated;

comment on function
  public.prompt_position_summaries(uuid, timestamptz, timestamptz, text) is
  'Per-prompt, per-platform mention position sums for the Tracked Prompts Positions column (PROMPT-007). Sums, not averages, so platforms combine exactly.';
