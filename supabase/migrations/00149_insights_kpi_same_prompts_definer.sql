-- The KPI cards' "Same prompts" read, made fast again (#1036 review).
--
-- 00147 (#1036) rewrote insights_same_prompt_compare[_daily] as plpgsql,
-- security definer, with the organization check made explicit, because the
-- SQL-language version timed out on the largest brand: 4.5 s as the table
-- owner, over 30 s for a signed-in member against the authenticated role's
-- 8 s statement_timeout. It carries 00130's output, so on this branch it
-- would drop the components 00131 added (negative count, position sum and
-- count, visible prompts, competitor mentions). This is 00131's output with
-- 00147's shape: planned per call with its real arguments
-- (force_custom_plan), no RLS inside the scan, the rollup rows folded to one
-- row per prompt and window first, and the raw rows kept once. The service
-- role still reads, for the cached 24h view (cachedAnchoredInsights).

-- ─── Over the rollups (whole-day windows) ──────────────────────────────────

create or replace function public.insights_same_prompt_compare_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  with per_prompt as (
    -- One row per prompt and window: nothing below reads the per-day rows.
    select d.prompt_id,
           case when d.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           sum(d.answer_count)                as answers,
           sum(d.mention_answers)             as mention_answers,
           sum(d.citation_answers)            as citation_answers,
           sum(d.sum_inv_position)            as sum_inv_position,
           sum(d.position_count)              as position_count,
           sum(d.total_mentions)              as total_mentions,
           sum(d.total_citations)             as total_citations,
           sum(d.positive_count)              as positive_count,
           sum(d.mentioning_answers)          as mentioning_answers,
           sum(d.negative_count)              as negative_count,
           sum(d.sum_position)                as sum_position,
           bool_or(d.has_mention or d.has_citation) as visible,
           bool_or(d.mention_answers is null or d.negative_count is null) as stale
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between p_cur_from and p_cur_to or d.day between p_prev_from and p_prev_to)
    group by 1, 2
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur' and answers > 0)  as in_cur,
           bool_or(win = 'prev' and answers > 0) as in_prev
    from per_prompt
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  brand_agg as (
    select p.win,
           sum(p.answers)            as answers,
           sum(p.mention_answers)    as mention_answers,
           sum(p.citation_answers)   as citation_answers,
           sum(p.sum_inv_position) / nullif(sum(p.position_count), 0) as position_factor,
           sum(p.total_mentions)     as total_mentions,
           sum(p.total_citations)    as total_citations,
           sum(p.positive_count)     as positive_count,
           sum(p.mentioning_answers) as mentioning_answers,
           sum(p.negative_count)     as negative_count,
           sum(p.sum_position)       as sum_position,
           sum(p.position_count)     as position_count,
           count(*) filter (where p.visible) as visible_prompts
    from per_prompt p
    join same_prompts s using (prompt_id)
    group by p.win
  ),
  comp_sums as (
    select case when cd.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           cd.competitor_id,
           sum(cd.mention_answers)  as mention_answers,
           sum(cd.citation_answers) as citation_answers,
           sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor,
           sum(cd.mention_count)    as mentions,
           bool_or(cd.mention_answers is null) as stale
    from public.insights_competitor_prompt_daily cd
    where cd.brand_id = p_brand_id
      and cd.prompt_id in (select prompt_id from same_prompts)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (cd.day between p_cur_from and p_cur_to or cd.day between p_prev_from and p_prev_to)
    group by 1, 2
  ),
  -- Competitors tracked in each window, from the dense day-grain table (see
  -- 00130): one added during the period then has no previous value.
  tracked as (
    select distinct
           case when cd.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           cd.competitor_id
    from public.insights_competitor_daily cd
    where cd.brand_id = p_brand_id
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (cd.day between p_cur_from and p_cur_to or cd.day between p_prev_from and p_prev_to)
  ),
  comp_agg as (
    select t.win,
           t.competitor_id,
           c.name,
           coalesce(cs.mention_answers, 0)  as mention_answers,
           coalesce(cs.citation_answers, 0) as citation_answers,
           cs.position_factor
    from tracked t
    join public.competitors c
      on c.id::text = t.competitor_id and c.brand_id = p_brand_id
    left join comp_sums cs
      on cs.win = t.win and cs.competitor_id = t.competitor_id
  ),
  -- Every competitor's mentions on the shared prompts, for share of voice
  -- (which counts all competitors, as share_of_voice_aggregates does).
  comp_mentions as (
    select win, sum(mentions) as mentions from comp_sums group by win
  ),
  windows(win) as (values ('cur'), ('prev'))
  select jsonb_build_object(
    'complete', not exists (select 1 from per_prompt where stale)
                and not exists (select 1 from comp_sums where stale),
    'same_prompts',    (select count(*) from same_prompts),
    'new_prompts',     (select count(*) from presence where in_cur and not in_prev),
    'dropped_prompts', (select count(*) from presence where in_prev and not in_cur)
  ) || (
    select jsonb_object_agg(w.win, jsonb_build_object(
      'answers',            coalesce(b.answers, 0),
      'mention_answers',    coalesce(b.mention_answers, 0),
      'citation_answers',   coalesce(b.citation_answers, 0),
      'position_factor',    b.position_factor,
      'total_mentions',     coalesce(b.total_mentions, 0),
      'total_citations',    coalesce(b.total_citations, 0),
      'positive_count',     coalesce(b.positive_count, 0),
      'mentioning_answers', coalesce(b.mentioning_answers, 0),
      'negative_count',     coalesce(b.negative_count, 0),
      'sum_position',       b.sum_position,
      'position_count',     coalesce(b.position_count, 0),
      'visible_prompts',    coalesce(b.visible_prompts, 0),
      'competitor_mentions', coalesce((select cm.mentions from comp_mentions cm where cm.win = w.win), 0),
      'by_competitor', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    ca.competitor_id,
                  'name',             ca.name,
                  'mention_answers',  ca.mention_answers,
                  'citation_answers', ca.citation_answers,
                  'position_factor',  ca.position_factor)
                order by ca.mention_answers desc, ca.competitor_id)
         from comp_agg ca where ca.win = w.win),
        '[]'::jsonb)))
    from windows w
    left join brand_agg b on b.win = w.win
  )
  into v_result;

  return v_result;
end;
$$;

-- ─── Over the raw rows (24h and topic views) ───────────────────────────────

create or replace function public.insights_same_prompt_compare(
  p_brand_id uuid,
  p_cur_from timestamptz,
  p_cur_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  with filtered as (
    select pr.prompt_id, pr.mention_count, pr.citation_count,
           pr.mention_position, pr.sentiment, pr.competitor_mentions,
           pr.created_at >= p_cur_from and pr.created_at <= p_cur_to   as in_cur,
           pr.created_at >= p_prev_from and pr.created_at <= p_prev_to as in_prev
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_models is null or pr.model_used = any (p_models))
      and (p_region is null or pr.region = p_region)
      and pr.created_at >= p_prev_from
      and pr.created_at <= p_cur_to
      and (p_topic_id is null or exists (
             select 1 from public.prompts p
             where p.id = pr.prompt_id and p.topic_id = p_topic_id))
  ),
  presence as (
    select prompt_id,
           bool_or(in_cur)  as in_cur,
           bool_or(in_prev) as in_prev
    from filtered
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  -- Each window selected on its own, inclusive at both ends like
  -- ai_visibility_aggregates: an answer exactly on the boundary counts in
  -- both, as it does on the card.
  same_rows as not materialized (
    select w.win, f.*
    from filtered f
    join same_prompts s using (prompt_id)
    cross join lateral (values ('cur', f.in_cur), ('prev', f.in_prev)) w(win, inside)
    where w.inside
  ),
  brand_agg as (
    select win,
           count(*)                                                   as answers,
           count(*) filter (where mention_count > 0)                  as mention_answers,
           count(*) filter (where citation_count > 0)                 as citation_answers,
           avg(1.0 / mention_position) filter (where mention_position is not null)
                                                                      as position_factor,
           coalesce(sum(mention_count), 0)                            as total_mentions,
           coalesce(sum(citation_count), 0)                           as total_citations,
           count(*) filter (where sentiment = 'positive')             as positive_count,
           count(*) filter (where mention_count > 0 or citation_count > 0)
                                                                      as mentioning_answers,
           count(*) filter (where sentiment = 'negative')             as negative_count,
           sum(mention_position) filter (where mention_position is not null)
                                                                      as sum_position,
           count(*) filter (where mention_position is not null)       as position_count,
           count(distinct prompt_id) filter (where mention_count > 0 or citation_count > 0)
                                                                      as visible_prompts
    from same_rows
    group by win
  ),
  -- The competitor entries of the shared prompts' answers, unpacked once.
  comp_entries as materialized (
    select r.win, cm.value as entry
    from same_rows r
    cross join lateral jsonb_array_elements(coalesce(r.competitor_mentions, '[]'::jsonb)) cm
    where cm.value ? 'competitor_id'
  ),
  comp_agg as (
    select e.win,
           e.entry->>'competitor_id' as competitor_id,
           max(c.name)               as name,
           count(*) filter (where coalesce((e.entry->>'mention_count')::int, 0) > 0)
                                     as mention_answers,
           count(*) filter (where coalesce((e.entry->>'citation_count')::int, 0) > 0)
                                     as citation_answers,
           avg(1.0 / (e.entry->>'mention_position')::numeric)
             filter (where (e.entry->>'mention_position') is not null)
                                     as position_factor
    from comp_entries e
    join public.competitors c
      on c.id::text = e.entry->>'competitor_id' and c.brand_id = p_brand_id
    group by e.win, e.entry->>'competitor_id'
  ),
  -- Every competitor's mentions on the shared prompts, for share of voice.
  comp_mentions as (
    select win, sum(coalesce((entry->>'mention_count')::int, 0)) as mentions
    from comp_entries
    group by win
  ),
  windows(win) as (values ('cur'), ('prev'))
  select jsonb_build_object(
    'complete',        true,
    'same_prompts',    (select count(*) from same_prompts),
    'new_prompts',     (select count(*) from presence where in_cur and not in_prev),
    'dropped_prompts', (select count(*) from presence where in_prev and not in_cur)
  ) || (
    select jsonb_object_agg(w.win, jsonb_build_object(
      'answers',            coalesce(b.answers, 0),
      'mention_answers',    coalesce(b.mention_answers, 0),
      'citation_answers',   coalesce(b.citation_answers, 0),
      'position_factor',    b.position_factor,
      'total_mentions',     coalesce(b.total_mentions, 0),
      'total_citations',    coalesce(b.total_citations, 0),
      'positive_count',     coalesce(b.positive_count, 0),
      'mentioning_answers', coalesce(b.mentioning_answers, 0),
      'negative_count',     coalesce(b.negative_count, 0),
      'sum_position',       b.sum_position,
      'position_count',     coalesce(b.position_count, 0),
      'visible_prompts',    coalesce(b.visible_prompts, 0),
      'competitor_mentions', coalesce((select cm.mentions from comp_mentions cm where cm.win = w.win), 0),
      'by_competitor', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    ca.competitor_id,
                  'name',             ca.name,
                  'mention_answers',  ca.mention_answers,
                  'citation_answers', ca.citation_answers,
                  'position_factor',  ca.position_factor)
                order by ca.mention_answers desc, ca.competitor_id)
         from comp_agg ca where ca.win = w.win),
        '[]'::jsonb)))
    from windows w
    left join brand_agg b on b.win = w.win
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text
) from public, anon;
grant execute on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text
) to authenticated, service_role;

revoke execute on function public.insights_same_prompt_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid
) from public, anon;
grant execute on function public.insights_same_prompt_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid
) to authenticated, service_role;
