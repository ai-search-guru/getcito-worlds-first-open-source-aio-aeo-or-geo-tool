-- "Why it changed" timed out on the largest brand (#1042 review).
--
-- insights_change_drivers_daily (00135) took 0.58 s as the table owner but
-- over 20 s for a signed-in member on the largest brand (~219k answers, 30
-- days against the 30 before), so the box never showed for that brand and
-- each open spent the authenticated role's whole 8 s statement_timeout. The
-- same query with literal values plans fine: a SQL-language function is
-- planned without its argument values (PostgreSQL 17 and older), so the
-- brand and both day ranges were guesses (a range between unknown bounds is
-- estimated at 0.5% of the rows), and the RLS membership subquery was
-- planned into that small guess. plan_cache_mode does not reach SQL
-- functions.
--
-- As for insights_same_prompt_compare[_daily] (00147): both functions
-- become plpgsql with force_custom_plan, so every call is planned with its
-- real arguments, and security definer with the organization check made
-- explicit, as citations_urls_daily does (00119). The service role still
-- reads, for the cached 24h view (cachedAnchoredInsights), which checks the
-- caller's access to the brand first. The rows are folded to one per
-- prompt, engine and window before the presence check and the two
-- groupings read them. Output and counting rules are 00135's.

-- ─── Over the rollups (whole-day windows) ──────────────────────────────────

create or replace function public.insights_change_drivers_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null,
  p_same_prompts boolean default true
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

  with per_engine as (
    -- One row per prompt, engine and window: nothing below reads the
    -- per-day rows.
    select d.prompt_id, d.model_used, d.platform,
           case when d.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           sum(d.answer_count)                as answers,
           sum(d.mention_answers)             as mention_answers,
           sum(d.citation_answers)            as citation_answers,
           sum(d.sum_inv_position)            as sum_inv_position,
           sum(d.position_count)              as position_count,
           bool_or(d.mention_answers is null) as stale
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between p_cur_from and p_cur_to or d.day between p_prev_from and p_prev_to)
    group by 1, 2, 3, 4
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from per_engine
    group by prompt_id
  ),
  scoped as (
    select r.* from per_engine r join presence p using (prompt_id)
    where not p_same_prompts or (p.in_cur and p.in_prev)
  ),
  by_prompt as (
    select prompt_id, win,
           sum(answers)          as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by prompt_id, win
  ),
  by_engine as (
    select model_used, platform, win,
           sum(answers)          as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by model_used, platform, win
  ),
  added as (
    select p.created_at
    from presence pr
    join public.prompts p on p.id = pr.prompt_id
    where pr.in_cur and not pr.in_prev
  )
  select jsonb_build_object(
    'complete', not exists (select 1 from per_engine where stale),
    'prompts', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'prompt_id',        b.prompt_id,
                'win',              b.win,
                'answers',          b.answers,
                'mention_answers',  b.mention_answers,
                'citation_answers', b.citation_answers,
                'sum_inv_position', b.sum_inv_position,
                'position_count',   b.position_count))
       from by_prompt b),
      '[]'::jsonb),
    'engines', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',       e.model_used,
                'platform',         e.platform,
                'win',              e.win,
                'answers',          e.answers,
                'mention_answers',  e.mention_answers,
                'citation_answers', e.citation_answers,
                'sum_inv_position', e.sum_inv_position,
                'position_count',   e.position_count))
       from by_engine e),
      '[]'::jsonb),
    'prompt_info', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id',         p.id,
                'text',       p.text,
                'topic_id',   p.topic_id,
                'topic_name', t.name))
       from public.prompts p
       left join public.topics t on t.id = p.topic_id
       where p.id in (select prompt_id from by_prompt)),
      '[]'::jsonb),
    -- Dates only for prompts created this period: one answered again after
    -- a pause is new to the comparison, not newly added.
    'new_prompts', (select jsonb_build_object(
                      'count',       count(*),
                      'first_added', min(created_at) filter (
                                       where created_at >= (p_cur_from::timestamp at time zone 'utc')),
                      'last_added',  max(created_at) filter (
                                       where created_at >= (p_cur_from::timestamp at time zone 'utc')))
                    from added)
  )
  into v_result;

  return v_result;
end;
$$;

-- ─── Over the raw rows (24h and topic views) ───────────────────────────────

create or replace function public.insights_change_drivers(
  p_brand_id uuid,
  p_cur_from timestamptz,
  p_cur_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null,
  p_same_prompts boolean default true
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
    select pr.prompt_id, pr.model_used, pr.platform,
           pr.mention_count, pr.citation_count, pr.mention_position,
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
  -- Each window selected on its own, inclusive at both ends like the card,
  -- and folded to one row per prompt, engine and window.
  per_engine as (
    select f.prompt_id, f.model_used, f.platform, w.win,
           count(*)                                      as answers,
           count(*) filter (where f.mention_count > 0)   as mention_answers,
           count(*) filter (where f.citation_count > 0)  as citation_answers,
           sum(1.0 / f.mention_position) filter (where f.mention_position is not null)
                                                         as sum_inv_position,
           count(*) filter (where f.mention_position is not null) as position_count
    from filtered f
    cross join lateral (values ('cur', f.in_cur), ('prev', f.in_prev)) w(win, inside)
    where w.inside
    group by 1, 2, 3, 4
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from per_engine
    group by prompt_id
  ),
  scoped as (
    select r.* from per_engine r join presence p using (prompt_id)
    where not p_same_prompts or (p.in_cur and p.in_prev)
  ),
  by_prompt as (
    select prompt_id, win,
           sum(answers)          as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by prompt_id, win
  ),
  by_engine as (
    select model_used, platform, win,
           sum(answers)          as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by model_used, platform, win
  ),
  added as (
    select p.created_at
    from presence pr
    join public.prompts p on p.id = pr.prompt_id
    where pr.in_cur and not pr.in_prev
  )
  select jsonb_build_object(
    'complete', true,
    'prompts', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'prompt_id',        b.prompt_id,
                'win',              b.win,
                'answers',          b.answers,
                'mention_answers',  b.mention_answers,
                'citation_answers', b.citation_answers,
                'sum_inv_position', b.sum_inv_position,
                'position_count',   b.position_count))
       from by_prompt b),
      '[]'::jsonb),
    'engines', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',       e.model_used,
                'platform',         e.platform,
                'win',              e.win,
                'answers',          e.answers,
                'mention_answers',  e.mention_answers,
                'citation_answers', e.citation_answers,
                'sum_inv_position', e.sum_inv_position,
                'position_count',   e.position_count))
       from by_engine e),
      '[]'::jsonb),
    'prompt_info', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id',         p.id,
                'text',       p.text,
                'topic_id',   p.topic_id,
                'topic_name', t.name))
       from public.prompts p
       left join public.topics t on t.id = p.topic_id
       where p.id in (select prompt_id from by_prompt)),
      '[]'::jsonb),
    -- Dates only for prompts created this period: one answered again after
    -- a pause is new to the comparison, not newly added.
    'new_prompts', (select jsonb_build_object(
                      'count',       count(*),
                      'first_added', min(created_at) filter (where created_at >= p_cur_from),
                      'last_added',  max(created_at) filter (where created_at >= p_cur_from))
                    from added)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean
) from public, anon;
grant execute on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean
) to authenticated, service_role;

revoke execute on function public.insights_change_drivers(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) from public, anon;
grant execute on function public.insights_change_drivers(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) to authenticated, service_role;
