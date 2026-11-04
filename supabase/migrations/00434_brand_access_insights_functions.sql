-- ============================================================================
-- 00434: brand access — the Insights, Mentions and Topics functions
-- ============================================================================
-- 00389 narrowed the brands table, and every policy that reads a brand through
-- it follows. A security definer function doesn't: it reads past RLS and
-- checks the caller itself. These twelve still ask only whether the brand
-- belongs to the caller's organization (brands joined to the caller's profile
-- on organization_id), so a Selected-brands person could read a brand they
-- can't see through them. Each now asks can_access_brand (00388) instead:
--   * Insights: insights_same_prompt_compare (00149),
--     insights_same_prompt_compare_daily (00164), insights_change_drivers
--     (00148), insights_change_drivers_daily (00164),
--     insights_topic_competitors_daily (00152);
--   * the Competitors page's head-to-head: head_to_head_daily (00169);
--   * Tracked Prompts: prompt_visibility_summaries (00232),
--     prompt_position_summaries_json (00153);
--   * the Topics tab: topics_overview_window (00236);
--   * Mentions & Sentiment: mentions_overview (00195), mentions_list (00239),
--     mentions_perception (00241).
--
-- The second of three waves (BRAND-ACCESS PR 4–6), after the citation and
-- report functions (00426); AI traffic, content, shopping and the catalog
-- come next. frontend/src/lib/brandAccessFunctions.test.ts lists the functions
-- still to do and fails on a new one that checks only the organization.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for an All-brands person can_access_brand(brand) is true
-- exactly when the brand is their organization's, the check it replaces.
-- Without a person (anon) both answer no, so anon still reads nothing.
--
-- The service role still reads any brand. Unlike the citation functions,
-- these let it through, and several callers use it: the Mentions reads of
-- MCP and Chat (mentions_overview, mentions_list, mentions_perception), the
-- web's 24-hour Insights cache (under withDbClient, after the person's own
-- client has read the brand), and the server's signals and Action Center
-- (prompt_visibility_summaries, insights_topic_competitors_daily). Those
-- callers check the brand before the call; brand access reaches the server
-- in BRAND-ACCESS PR 7, Chat in PR 9 and MCP in PR 10.
--
-- How:
--   * Each function is its last definition, word for word, with only the
--     check changed: `not exists (<the organization check>)` becomes
--     `not public.can_access_brand(p_brand_id)`, after the same service-role
--     test, and the early return stays (null, or no rows for the two that
--     return a table). It runs once per call, as before, not per row.
--   * create or replace resets the settings a definition doesn't repeat, so
--     each repeats its own: search_path, and work_mem and plan_cache_mode
--     where it had them. Grants stay as they were (create or replace keeps
--     them; the three first made with `create function` after a drop, in
--     00164 and 00232, are replaced the same way).
--   * The comments that said "not a member of the brand's organization" now
--     say brand access, and the seven functions that had none get one (the
--     two _daily Insights reads lost theirs with the signatures 00164
--     dropped).
--   * can_access_brand runs as the function's owner here, so a caller who may
--     not run it directly (anon) still gets the empty answer, not an error.

-- ── insights_same_prompt_compare (00149) ───────────────────────────────────
-- Insights: the same-prompt KPI changes, over timestamp windows.

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
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
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

-- ── insights_same_prompt_compare_daily (00164) ─────────────────────────────
-- Insights: the same-prompt KPI changes, from the daily rollups.

create or replace function public.insights_same_prompt_compare_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
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
  -- The topic's prompts, resolved once; null reads every prompt.
  v_topic  uuid[] := case when p_topic_id is not null then
                       array(select p.id from public.prompts p where p.topic_id = p_topic_id)
                     end;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
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
      and (v_topic is null or d.prompt_id = any (v_topic))
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

-- ── insights_change_drivers (00148) ────────────────────────────────────────
-- Insights: "Why it changed", over timestamp windows.

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
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
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

-- ── insights_change_drivers_daily (00164) ──────────────────────────────────
-- Insights: "Why it changed", from the daily rollups.

create or replace function public.insights_change_drivers_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null,
  p_same_prompts boolean default true,
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
  -- The topic's prompts, resolved once; null reads every prompt.
  v_topic  uuid[] := case when p_topic_id is not null then
                       array(select p.id from public.prompts p where p.topic_id = p_topic_id)
                     end;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
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
      and (v_topic is null or d.prompt_id = any (v_topic))
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

-- ── insights_topic_competitors_daily (00152) ───────────────────────────────
-- Insights: "Topics vs competitors".

create or replace function public.insights_topic_competitors_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
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
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  with topic_prompts as (
    select p.id as prompt_id, t.id as topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    join public.topics t on t.id = p.topic_id
    where ps.brand_id = p_brand_id
      and t.is_active
  ),
  brand_rows as (
    select tp.topic_id, d.prompt_id, d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_prompt_daily d
    join topic_prompts tp on tp.prompt_id = d.prompt_id
    where d.brand_id = p_brand_id
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
  ),
  competitor_rows as (
    select tp.topic_id, c.id as competitor_id, cpd.mention_answers, cpd.citation_answers,
           cpd.sum_inv_position, cpd.position_count
    from public.insights_competitor_prompt_daily cpd
    join topic_prompts tp on tp.prompt_id = cpd.prompt_id
    -- Live competitors only, like the leaderboard.
    join public.competitors c on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
  ),
  brand as (
    select topic_id,
           count(distinct prompt_id) as prompts,
           sum(answer_count)         as answers,
           sum(mention_answers)      as mention_answers,
           sum(citation_answers)     as citation_answers,
           sum(sum_inv_position)     as sum_inv_position,
           sum(position_count)       as position_count
    from brand_rows
    group by topic_id
  ),
  competitor as (
    select topic_id, competitor_id,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from competitor_rows
    group by topic_id, competitor_id
  ),
  -- Each topic's competitors, folded once and joined to its row below.
  competitor_lists as (
    select topic_id,
           jsonb_agg(jsonb_build_object(
             'competitor_id',    competitor_id,
             'mention_answers',  mention_answers,
             'citation_answers', citation_answers,
             'sum_inv_position', sum_inv_position,
             'position_count',   position_count)) as competitors
    from competitor
    group by topic_id
  )
  select jsonb_build_object(
    'complete', not exists (select 1 from brand_rows where mention_answers is null)
                and not exists (select 1 from competitor_rows where mention_answers is null),
    'topics', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'topic_id',         b.topic_id,
                'name',             t.name,
                'prompts',          b.prompts,
                'answers',          b.answers,
                'mention_answers',  b.mention_answers,
                'citation_answers', b.citation_answers,
                'sum_inv_position', b.sum_inv_position,
                'position_count',   b.position_count,
                'competitors',      coalesce(cl.competitors, '[]'::jsonb)))
       from brand b
       join public.topics t on t.id = b.topic_id
       left join competitor_lists cl on cl.topic_id = b.topic_id),
      '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── head_to_head_daily (00169) ─────────────────────────────────────────────
-- The Competitors page: head-to-head with one competitor.

create or replace function public.head_to_head_daily(
  p_brand_id uuid,
  p_competitor_id text
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
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  with brand_groups as (
    select d.prompt_id, d.platform, d.model_used, d.region,
           sum(d.answer_count)   as runs,
           sum(d.sum_visibility) as brand_total,
           max(d.max_created_at) as latest_at
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
    group by d.prompt_id, d.platform, d.model_used, d.region
  ),
  comp_groups as (
    select cd.prompt_id, cd.platform, cd.model_used, cd.region,
           sum(cd.sum_visibility) as comp_total
    from public.insights_competitor_prompt_daily cd
    where cd.brand_id = p_brand_id
      and cd.competitor_id = p_competitor_id
    group by cd.prompt_id, cd.platform, cd.model_used, cd.region
  ),
  brand_engines as (
    select d.platform, d.model_used,
           sum(d.answer_count)   as brand_count,
           sum(d.sum_visibility) as brand_total
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
    group by d.platform, d.model_used
  ),
  comp_engines as (
    select cd.platform, cd.model_used,
           sum(cd.answer_count)   as comp_count,
           sum(cd.sum_visibility) as comp_total
    from public.insights_competitor_daily cd
    where cd.brand_id = p_brand_id
      and cd.competitor_id = p_competitor_id
    group by cd.platform, cd.model_used
  )
  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'prompt_id',       g.prompt_id,
               'platform',        g.platform,
               'model_used',      g.model_used,
               'region',          g.region,
               'runs',            g.runs,
               'brand_total',     coalesce(g.brand_total, 0),
               'comp_total',      coalesce(c.comp_total, 0),
               'latest_at',       g.latest_at))
      from brand_groups g
      left join comp_groups c
        on c.prompt_id = g.prompt_id
       and c.platform is not distinct from g.platform
       and c.model_used is not distinct from g.model_used
       and c.region is not distinct from g.region
    ), '[]'::jsonb),
    -- Each prompt's text once, rather than on each of its groups.
    'prompts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'text', p.text, 'category', p.category))
      from public.prompts p
      where p.id in (select g.prompt_id from brand_groups g)
    ), '[]'::jsonb),
    'engines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'platform',    e.platform,
               'model_used',  e.model_used,
               'brand_count', e.brand_count,
               'brand_total', coalesce(e.brand_total, 0),
               'comp_count',  coalesce(c.comp_count, 0),
               'comp_total',  coalesce(c.comp_total, 0)))
      from brand_engines e
      left join comp_engines c
        on c.platform is not distinct from e.platform
       and c.model_used is not distinct from e.model_used
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── prompt_visibility_summaries (00232) ────────────────────────────────────
-- Tracked Prompts: the All Prompts table's per-prompt figures.

create or replace function public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null,
  p_region    text default null
)
returns table (
  prompt_id              uuid,
  avg_visibility         double precision,
  avg_visibility_visible double precision,
  total_mentions         bigint,
  total_citations        bigint,
  runs                   bigint,
  visible_runs           bigint,
  mention_answers        bigint,
  citation_answers       bigint,
  position_factor        double precision,
  last_run_at            timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return;
  end if;

  return query
  select pr.prompt_id,
         avg(coalesce(pr.visibility_score, 0))::double precision,
         (avg(coalesce(pr.visibility_score, 0))
            filter (where pr.mention_count > 0 or pr.citation_count > 0))::double precision,
         coalesce(sum(pr.mention_count), 0)::bigint,
         coalesce(sum(pr.citation_count), 0)::bigint,
         count(*)::bigint,
         count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0)::bigint,
         count(*) filter (where pr.mention_count > 0)::bigint,
         count(*) filter (where pr.citation_count > 0)::bigint,
         (avg(1.0 / pr.mention_position)
            filter (where pr.mention_position is not null))::double precision,
         max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    and (p_date_from is null or pr.created_at >= p_date_from)
    and (p_date_to   is null or pr.created_at <= p_date_to)
    and (p_region    is null or pr.region = p_region)
  group by pr.prompt_id;
end;
$$;

-- ── prompt_position_summaries_json (00153) ─────────────────────────────────
-- Tracked Prompts: the Positions column.

create or replace function public.prompt_position_summaries_json(
  p_brand_id  uuid,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null,
  p_region    text default null
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
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'prompt_id',       s.prompt_id,
           'platform',        s.platform,
           'runs',            s.runs,
           'mention_answers', s.mention_answers,
           'position_sum',    s.position_sum,
           'position_count',  s.position_count,
           'entity_sum',      s.entity_sum,
           'entity_count',    s.entity_count)), '[]'::jsonb)
  into v_result
  from (
    select pr.prompt_id,
           pr.platform,
           count(*) as runs,
           count(*) filter (where pr.mention_count > 0) as mention_answers,
           coalesce(sum(pr.mention_position) filter (
             where pr.mention_count > 0 and pr.mention_position > 0), 0)::double precision
                                                                as position_sum,
           count(*) filter (
             where pr.mention_count > 0 and pr.mention_position > 0) as position_count,
           coalesce(sum(pr.mentioned_entity_count) filter (
             where pr.mention_count > 0 and pr.mention_position > 0
               and pr.mentioned_entity_count > 0), 0)::double precision as entity_sum,
           count(*) filter (
             where pr.mention_count > 0 and pr.mention_position > 0
               and pr.mentioned_entity_count > 0) as entity_count
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.prompt_id is not null
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from is null or pr.created_at >= p_date_from)
      and (p_date_to   is null or pr.created_at <= p_date_to)
      and (p_region    is null or pr.region = p_region)
    group by pr.prompt_id, pr.platform
  ) s;

  return v_result;
end;
$$;

-- ── topics_overview_window (00236) ─────────────────────────────────────────
-- The Topics tab, for any window.

create or replace function public.topics_overview_window(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null
)
returns table (
  topic_id              uuid,
  answers               bigint,
  mention_answers       bigint,
  citation_answers      bigint,
  pos_sum               double precision,
  pos_n                 bigint,
  prev_answers          bigint,
  prev_mention_answers  bigint,
  prev_citation_answers bigint,
  prev_pos_sum          double precision,
  prev_pos_n            bigint,
  total_mentions        bigint,
  total_citations       bigint,
  comp_mentions         bigint,
  active_prompts        bigint,
  visible_prompts       bigint,
  last_run_at           timestamptz,
  competitors           jsonb,
  daily                 jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_to        timestamptz := coalesce(p_date_to, now());
  v_from      timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  -- Whole days the window spans, at least one, with an hour of slack: a
  -- rolling 7 days starts where the browser put it and ends at now(), a
  -- moment later, which must not make it 8 (lib/topicTrend.ts counts alike).
  v_days      integer;
  -- The rollup days of a longer window, and of the window before it.
  v_day_to    date;
  v_day_from  date;
  v_prev_from date;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return;
  end if;

  v_days := greatest(1, ceil(extract(epoch from (v_to - v_from)) / 86400.0 - 1.0 / 24)::integer);

  if v_days < 2 then
    return query
    with
    topic_prompts as (
      select p.id as prompt_id, p.topic_id
      from public.prompts p
      join public.prompt_sets ps on ps.id = p.prompt_set_id
      where ps.brand_id = p_brand_id
        and p.topic_id is not null
    ),
    -- Both windows' answers from idx_prompt_results_brand_created_metrics
    -- (00232) alone: every column read here is in the index, so the answers'
    -- rows (and their competitor_mentions) stay unread.
    rows as materialized (
      select tp.topic_id,
             pr.prompt_id,
             pr.created_at,
             (pr.created_at >= v_from)                        as in_window,
             coalesce(pr.mention_count, 0)                    as mentions,
             coalesce(pr.citation_count, 0)                   as citations,
             pr.mention_position,
             (coalesce(pr.mention_count, 0) > 0
               or coalesce(pr.citation_count, 0) > 0)         as visible
      from public.prompt_results pr
      join topic_prompts tp on tp.prompt_id = pr.prompt_id
      where pr.brand_id = p_brand_id
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from - (v_to - v_from)
        and pr.created_at <= v_to
    ),
    -- The competitor share is the window's alone, so only the window's
    -- answers are read for their competitor_mentions: half the rows 00156
    -- read, and none of the window before.
    comps as (
      select tp.topic_id,
             cm.value->>'competitor_id'                              as competitor_id,
             min(c.name)                                             as name,
             sum(coalesce((cm.value->>'mention_count')::int, 0))::bigint as mentions
      from public.prompt_results pr
      join topic_prompts tp on tp.prompt_id = pr.prompt_id
      cross join lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      join public.competitors c on c.id::text = cm.value->>'competitor_id' and c.brand_id = p_brand_id
      where pr.brand_id = p_brand_id
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from
        and pr.created_at <= v_to
      group by tp.topic_id, cm.value->>'competitor_id'
      having sum(coalesce((cm.value->>'mention_count')::int, 0)) > 0
    ),
    comp_totals as (
      select topic_id,
             sum(mentions)::bigint as comp_mentions,
             jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions))
               as competitors
      from comps
      group by topic_id
    ),
    main as (
      select r.topic_id,
             count(*) filter (where r.in_window)::bigint                          as answers,
             count(*) filter (where r.in_window and r.mentions > 0)::bigint       as mention_answers,
             count(*) filter (where r.in_window and r.citations > 0)::bigint      as citation_answers,
             coalesce(sum(1.0 / r.mention_position)
               filter (where r.in_window and r.mention_position > 0), 0)::double precision
                                                                                   as pos_sum,
             count(*) filter (where r.in_window and r.mention_position > 0)::bigint
                                                                                   as pos_n,
             count(*) filter (where not r.in_window)::bigint                      as prev_answers,
             count(*) filter (where not r.in_window and r.mentions > 0)::bigint   as prev_mention_answers,
             count(*) filter (where not r.in_window and r.citations > 0)::bigint  as prev_citation_answers,
             coalesce(sum(1.0 / r.mention_position)
               filter (where not r.in_window and r.mention_position > 0), 0)::double precision
                                                                                   as prev_pos_sum,
             count(*) filter (where not r.in_window and r.mention_position > 0)::bigint
                                                                                   as prev_pos_n,
             coalesce(sum(r.mentions) filter (where r.in_window), 0)::bigint      as total_mentions,
             coalesce(sum(r.citations) filter (where r.in_window), 0)::bigint     as total_citations,
             count(distinct r.prompt_id) filter (where r.in_window)::bigint       as active_prompts,
             count(distinct r.prompt_id) filter (where r.in_window and r.visible)::bigint
                                                                                   as visible_prompts,
             max(r.created_at) filter (where r.in_window)                         as last_run_at
      from rows r
      group by r.topic_id
    )
    select m.topic_id,
           m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
           m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
           m.total_mentions, m.total_citations,
           coalesce(ct.comp_mentions, 0)::bigint,
           m.active_prompts, m.visible_prompts, m.last_run_at,
           coalesce(ct.competitors, '{}'::jsonb),
           '{}'::jsonb
    from main m
    left join comp_totals ct on ct.topic_id = m.topic_id
    where m.answers > 0;
    return;
  end if;

  v_day_to := (v_to at time zone 'UTC')::date;
  v_day_from := v_day_to - (v_days - 1);
  v_prev_from := v_day_from - v_days;

  return query
  with
  topic_prompts as (
    select p.id as prompt_id, p.topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and p.topic_id is not null
  ),
  -- The brand's rows of both windows, read by (brand_id, day) and only then
  -- matched to the topics' prompts (see the header).
  prompt_rows as materialized (
    select d.prompt_id,
           d.day,
           d.answer_count,
           d.mention_answers,
           d.citation_answers,
           d.mentioning_answers,
           d.total_mentions,
           d.total_citations,
           d.sum_inv_position,
           d.position_count,
           d.max_created_at
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and d.day between v_prev_from and v_day_to
  ),
  days as (
    select tp.topic_id,
           r.prompt_id,
           r.day,
           (r.day >= v_day_from) as in_window,
           r.answer_count,
           r.mention_answers,
           r.citation_answers,
           r.mentioning_answers,
           r.total_mentions,
           r.total_citations,
           r.sum_inv_position,
           r.position_count,
           r.max_created_at
    from prompt_rows r
    join topic_prompts tp on tp.prompt_id = r.prompt_id
  ),
  sightings as materialized (
    select cpd.prompt_id, cpd.competitor_id, cpd.mention_count
    from public.insights_competitor_prompt_daily cpd
    where cpd.brand_id = p_brand_id
      and cpd.day between v_day_from and v_day_to
  ),
  comps as (
    select tp.topic_id,
           s.competitor_id,
           min(c.name)                   as name,
           sum(s.mention_count)::bigint  as mentions
    from sightings s
    join topic_prompts tp     on tp.prompt_id = s.prompt_id
    join public.competitors c on c.id::text = s.competitor_id and c.brand_id = p_brand_id
    group by tp.topic_id, s.competitor_id
    having sum(s.mention_count) > 0
  ),
  comp_totals as (
    select topic_id,
           sum(mentions)::bigint as comp_mentions,
           jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions))
             as competitors
    from comps
    group by topic_id
  ),
  -- A point per UTC day, keyed as the client builds its keys
  -- (Date.toISOString()).
  daily as (
    select x.topic_id,
           jsonb_object_agg(x.day, jsonb_build_object('visible', x.visible, 'count', x.count))
             as daily
    from (
      select topic_id,
             to_char(day, 'YYYY-MM-DD')     as day,
             sum(mentioning_answers)::bigint as visible,
             sum(answer_count)::bigint       as count
      from days
      where in_window
      group by topic_id, day
    ) x
    group by x.topic_id
  ),
  -- Each topic's last answer in the window, from the rollups (00164).
  last_runs as (
    select topic_id, max(max_created_at) as last_run_at
    from days
    where in_window
    group by topic_id
  ),
  main as (
    select topic_id,
           coalesce(sum(answer_count) filter (where in_window), 0)::bigint         as answers,
           coalesce(sum(mention_answers) filter (where in_window), 0)::bigint      as mention_answers,
           coalesce(sum(citation_answers) filter (where in_window), 0)::bigint     as citation_answers,
           coalesce(sum(sum_inv_position) filter (where in_window), 0)::double precision
                                                                                   as pos_sum,
           coalesce(sum(position_count) filter (where in_window), 0)::bigint       as pos_n,
           coalesce(sum(answer_count) filter (where not in_window), 0)::bigint     as prev_answers,
           coalesce(sum(mention_answers) filter (where not in_window), 0)::bigint  as prev_mention_answers,
           coalesce(sum(citation_answers) filter (where not in_window), 0)::bigint as prev_citation_answers,
           coalesce(sum(sum_inv_position) filter (where not in_window), 0)::double precision
                                                                                   as prev_pos_sum,
           coalesce(sum(position_count) filter (where not in_window), 0)::bigint   as prev_pos_n,
           coalesce(sum(total_mentions) filter (where in_window), 0)::bigint       as total_mentions,
           coalesce(sum(total_citations) filter (where in_window), 0)::bigint      as total_citations,
           count(distinct prompt_id) filter (where in_window and answer_count > 0)::bigint
                                                                                   as active_prompts,
           count(distinct prompt_id) filter (where in_window and mentioning_answers > 0)::bigint
                                                                                   as visible_prompts
    from days
    group by topic_id
  )
  select m.topic_id,
         m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
         m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
         m.total_mentions, m.total_citations,
         coalesce(ct.comp_mentions, 0)::bigint,
         m.active_prompts, m.visible_prompts, lr.last_run_at,
         coalesce(ct.competitors, '{}'::jsonb),
         coalesce(dl.daily, '{}'::jsonb)
  from main m
  left join comp_totals ct on ct.topic_id = m.topic_id
  left join daily dl       on dl.topic_id = m.topic_id
  left join last_runs lr   on lr.topic_id = m.topic_id
  where m.answers > 0;
end;
$$;

-- ── mentions_overview (00195) ──────────────────────────────────────────────
-- Mentions & Sentiment: the Overview tab.

create or replace function public.mentions_overview(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null,
  p_platform  text default null,
  p_region    text default null,
  p_topic_id  uuid default null,
  p_search    text default null
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
  v_to        timestamptz := coalesce(p_date_to, now());
  v_from      timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_span      interval;
  -- Whole days the window spans, at least one, with an hour of slack: a
  -- rolling 7 days ends at now(), a moment after the browser started it.
  v_days      integer;
  -- Under two days the answers are read directly.
  v_raw       boolean;
  v_day_to    date;
  v_day_from  date;
  v_prev_from date;
  v_search    text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_result    jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  v_span      := v_to - v_from;
  v_days      := greatest(1, ceil(extract(epoch from v_span) / 86400.0 - 1.0 / 24)::integer);
  v_raw       := v_days < 2;
  v_day_to    := (v_to at time zone 'utc')::date;
  v_day_from  := v_day_to - (v_days - 1);
  v_prev_from := v_day_from - v_days;

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  facts as (
    select (d.day >= v_day_from)            as cur,
           d.day,
           d.prompt_id,
           d.platform,
           d.answer_count::bigint            as answers,
           d.mention_answers::bigint         as mentions,
           d.mention_occurrences             as occurrences,
           d.positive_answers::bigint        as positive,
           d.negative_answers::bigint        as negative,
           d.position_sum,
           d.position_count::bigint          as position_count,
           d.last_answer_at
    from public.mentions_prompt_daily d
    join prompts_in pi on pi.id = d.prompt_id
    where not v_raw
      and d.brand_id = p_brand_id
      and d.day between v_prev_from and v_day_to
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    union all
    select (pr.created_at >= v_from),
           (pr.created_at at time zone 'utc')::date,
           pr.prompt_id,
           pr.platform,
           1,
           (pr.mention_count > 0)::int,
           coalesce(pr.mention_count, 0),
           (pr.mention_count > 0 and pr.sentiment = 'positive')::int,
           (pr.mention_count > 0 and pr.sentiment = 'negative')::int,
           case when pr.mention_count > 0 then coalesce(pr.mention_position, 0) else 0 end,
           (pr.mention_count > 0 and pr.mention_position is not null)::int,
           pr.created_at
    from public.prompt_results pr
    join prompts_in pi on pi.id = pr.prompt_id
    where v_raw
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and pr.created_at >= v_from - v_span
      and pr.created_at <= v_to
      and (p_platform is null or pr.platform = p_platform)
      and (p_region is null or pr.region = p_region)
  ),
  -- Prompts answered in both windows: every change is taken on them, as
  -- Insights takes its changes (insights_same_prompt_compare_daily, 00164),
  -- so adding or removing prompts doesn't read as a rise or a fall.
  presence as (
    select prompt_id,
           bool_or(cur and answers > 0)     as in_cur,
           bool_or(not cur and answers > 0) as in_prev
    from facts
    group by prompt_id
  ),
  flagged as (
    select f.*, (p.in_cur and p.in_prev) as shared
    from facts f
    join presence p using (prompt_id)
  ),
  same_totals as (
    select cur,
           sum(answers)::bigint                                     as answers,
           sum(mentions)::bigint                                    as mentions,
           sum(occurrences)::bigint                                 as occurrences,
           sum(positive)::bigint                                    as positive,
           sum(negative)::bigint                                    as negative,
           count(distinct prompt_id)                                as prompts,
           count(distinct prompt_id) filter (where mentions > 0)    as prompts_with_mentions
    from flagged
    where shared
    group by cur
  ),
  totals as (
    select cur,
           sum(answers)::bigint                                     as answers,
           sum(mentions)::bigint                                    as mentions,
           sum(occurrences)::bigint                                 as occurrences,
           sum(positive)::bigint                                    as positive,
           sum(negative)::bigint                                    as negative,
           sum(position_sum)::bigint                                as position_sum,
           sum(position_count)::bigint                              as position_count,
           count(distinct prompt_id)                                as prompts,
           count(distinct prompt_id) filter (where mentions > 0)    as prompts_with_mentions,
           max(last_answer_at)                                      as last_answer_at
    from facts
    group by cur
  ),
  platforms as (
    select platform,
           coalesce(sum(answers)  filter (where cur), 0)::bigint      as answers,
           coalesce(sum(mentions) filter (where cur), 0)::bigint      as mentions,
           coalesce(sum(occurrences) filter (where cur), 0)::bigint   as occurrences,
           coalesce(sum(positive) filter (where cur), 0)::bigint      as positive,
           coalesce(sum(negative) filter (where cur), 0)::bigint      as negative,
           coalesce(sum(answers)  filter (where not cur), 0)::bigint  as prev_answers,
           coalesce(sum(mentions) filter (where not cur), 0)::bigint  as prev_mentions,
           coalesce(sum(positive) filter (where not cur), 0)::bigint  as prev_positive,
           coalesce(sum(negative) filter (where not cur), 0)::bigint  as prev_negative,
           -- The same on the shared prompts, for the platform's change.
           coalesce(sum(answers)  filter (where cur and shared), 0)::bigint      as same_answers,
           coalesce(sum(mentions) filter (where cur and shared), 0)::bigint      as same_mentions,
           coalesce(sum(positive) filter (where cur and shared), 0)::bigint      as same_positive,
           coalesce(sum(negative) filter (where cur and shared), 0)::bigint      as same_negative,
           coalesce(sum(answers)  filter (where not cur and shared), 0)::bigint  as same_prev_answers,
           coalesce(sum(mentions) filter (where not cur and shared), 0)::bigint  as same_prev_mentions,
           coalesce(sum(positive) filter (where not cur and shared), 0)::bigint  as same_prev_positive,
           coalesce(sum(negative) filter (where not cur and shared), 0)::bigint  as same_prev_negative
    from flagged
    group by platform
  ),
  daily as (
    select day,
           sum(answers)::bigint     as answers,
           sum(mentions)::bigint    as mentions,
           sum(occurrences)::bigint as occurrences,
           sum(positive)::bigint    as positive,
           sum(negative)::bigint    as negative
    from facts
    where cur
    group by day
  ),
  comp_facts as (
    select (c.day >= v_day_from)              as cur,
           c.competitor_id,
           c.mention_answers::bigint           as mentions,
           c.co_mention_answers::bigint        as co_mentions
    from public.mentions_competitor_daily c
    join prompts_in pi on pi.id = c.prompt_id
    where not v_raw
      and c.brand_id = p_brand_id
      and c.day between v_prev_from and v_day_to
      and (p_platform is null or c.platform = p_platform)
      and (p_region is null or c.region = p_region)
    union all
    select (pr.created_at >= v_from),
           cm.value->>'competitor_id',
           1,
           (pr.mention_count > 0)::int
    from public.prompt_results pr
    join prompts_in pi on pi.id = pr.prompt_id
    cross join lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
    where v_raw
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and pr.created_at >= v_from - v_span
      and pr.created_at <= v_to
      and (p_platform is null or pr.platform = p_platform)
      and (p_region is null or pr.region = p_region)
      and cm.value ? 'competitor_id'
      and coalesce((cm.value->>'mention_count')::int, 0) > 0
  ),
  competitors as (
    select co.id::text                                                 as competitor_id,
           co.name,
           coalesce(sum(f.mentions)    filter (where f.cur), 0)::bigint     as mentions,
           coalesce(sum(f.co_mentions) filter (where f.cur), 0)::bigint     as co_mentions,
           coalesce(sum(f.mentions)    filter (where not f.cur), 0)::bigint as prev_mentions
    from public.competitors co
    left join comp_facts f on f.competitor_id = co.id::text
    where co.brand_id = p_brand_id
    group by co.id, co.name
  )
  select jsonb_build_object(
    'window', jsonb_build_object(
      'from', v_from, 'to', v_to, 'days', v_days,
      'source', case when v_raw then 'answers' else 'days' end,
      'day_from', v_day_from, 'day_to', v_day_to),
    'current',     (select to_jsonb(t) - 'cur' from totals t where t.cur),
    'previous',    (select to_jsonb(t) - 'cur' from totals t where not t.cur),
    'same',        jsonb_build_object(
                     'prompts',         (select count(*) from presence where in_cur and in_prev),
                     'new_prompts',     (select count(*) from presence where in_cur and not in_prev),
                     'dropped_prompts', (select count(*) from presence where in_prev and not in_cur),
                     'current',  (select to_jsonb(t) - 'cur' from same_totals t where t.cur),
                     'previous', (select to_jsonb(t) - 'cur' from same_totals t where not t.cur)),
    -- In the order of the column the table shows: occurrences, then responses.
    'platforms',   coalesce((select jsonb_agg(to_jsonb(p)
                                              order by p.occurrences desc, p.mentions desc, p.platform)
                             from platforms p), '[]'::jsonb),
    'daily',       coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from daily d),
                            '[]'::jsonb),
    'competitors', coalesce((select jsonb_agg(to_jsonb(c) order by c.mentions desc, c.name)
                             from competitors c), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── mentions_list (00239) ──────────────────────────────────────────────────
-- Mentions & Sentiment: the Mentions table.

create or replace function public.mentions_list(
  p_brand_id      uuid,
  p_date_from     timestamptz,
  p_date_to       timestamptz default null,
  p_platform      text default null,
  p_region        text default null,
  p_topic_id      uuid default null,
  p_search        text default null,
  p_sentiment     text default null,
  p_competitor_id text default null,
  p_sort          text default 'newest',
  p_group         text default null,
  p_limit         integer default 100,
  p_offset        integer default 0
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
  v_to       timestamptz := coalesce(p_date_to, now());
  v_from     timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days     integer;
  v_day_to   date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_search   text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_limit    integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_group    text := case when p_group in ('prompt', 'platform') then p_group end;
  -- Only these read each answer's competitor_mentions: the rest of the
  -- table's choices are answered from the index alone.
  v_competitors boolean := p_sort = 'co_mentions' or p_competitor_id is not null;
  v_result   jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  -- The same window as mentions_overview's current one.
  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;

  with
  prompts_in as (
    select p.id, p.text, p.topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  -- The brand's mentions in the window, read first, through the partial
  -- index above, and only then joined to the prompts. Driven by the prompts
  -- instead, the planner walks each prompt's whole history: 8.8 s for 30
  -- days of the largest brand, against 0.2 s this way. Every column here is
  -- in that index, so the window is read without visiting the table.
  mention_rows as materialized (
    select pr.id, pr.created_at, pr.prompt_id, pr.platform, pr.sentiment
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.mention_count > 0
      and pr.platform <> 'chatgpt-shopping'
      and pr.created_at >= v_start
      and pr.created_at < v_end
      and (p_platform is null or pr.platform = p_platform)
      and (p_region is null or pr.region = p_region)
      and (p_sentiment is null
           or (p_sentiment in ('positive', 'negative') and pr.sentiment = p_sentiment)
           or (p_sentiment = 'neutral'
               and pr.sentiment is distinct from 'positive'
               and pr.sentiment is distinct from 'negative'))
  ),
  hits as (
    select m.id,
           m.created_at,
           m.prompt_id,
           pi.text as prompt_text,
           m.platform,
           m.sentiment,
           co.co_count,
           co.with_competitor
    from mention_rows m
    join prompts_in pi on pi.id = m.prompt_id
    -- Competitors named beside you (the array lists every competitor, named
    -- or not), read from the answer only when the sort or the competitor
    -- filter asks: otherwise v_competitors is false, the plan's one-time
    -- filter skips it, and co_count is never used.
    left join lateral (
      select (select count(*)
                from jsonb_array_elements(coalesce(x.competitor_mentions, '[]'::jsonb)) cm
               where cm.value ? 'competitor_id'
                 and coalesce((cm.value->>'mention_count')::int, 0) > 0) as co_count,
             (p_competitor_id is not null and p_competitor_id <> 'none' and exists (
                select 1
                  from jsonb_array_elements(coalesce(x.competitor_mentions, '[]'::jsonb)) cm
                 where cm.value->>'competitor_id' = p_competitor_id
                   and coalesce((cm.value->>'mention_count')::int, 0) > 0)) as with_competitor
      from public.prompt_results x
      where v_competitors and x.id = m.id
    ) co on true
  ),
  filtered as (
    select h.*,
           case v_group
             when 'prompt' then h.prompt_id::text
             when 'platform' then h.platform
           end as group_key
    from hits h
    where p_competitor_id is null
       or (p_competitor_id = 'none' and h.co_count = 0)
       or h.with_competitor
  ),
  grouped as (
    select f.*,
           case when v_group is not null
                then count(*) over (partition by f.group_key) end as group_count
    from filtered f
  ),
  page as (
    select g.*
    from grouped g
    order by
      case when v_group is not null then g.group_count end desc nulls last,
      case when v_group = 'prompt' then lower(g.prompt_text) end,
      g.group_key,
      case when p_sort = 'negative' then
        case g.sentiment when 'negative' then 0 when 'positive' then 2 else 1 end
      end,
      case when p_sort = 'co_mentions' then g.co_count end desc nulls last,
      case when p_sort = 'oldest' then g.created_at end,
      g.created_at desc,
      g.id
    limit v_limit
    offset v_offset
  ),
  rows_out as (
    select pg.*,
           pr.model_used,
           pr.region,
           pr.mention_count,
           pr.mention_position,
           pr.mentioned_entity_count,
           pr.response,
           pi.topic_id,
           t.name as topic_name,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'competitor_id', cm.value->>'competitor_id',
                      'name', coalesce(co.name, cm.value->>'name'),
                      'mention_position', cm.value->'mention_position')
                    order by (cm.value->>'mention_position')::int nulls last,
                             coalesce(co.name, cm.value->>'name'))
               from jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
               left join public.competitors co
                 on co.id::text = cm.value->>'competitor_id' and co.brand_id = p_brand_id
              where cm.value ? 'competitor_id'
                and coalesce((cm.value->>'mention_count')::int, 0) > 0
           ), '[]'::jsonb) as co_mentioned
    from page pg
    join public.prompt_results pr on pr.id = pg.id
    join prompts_in pi on pi.id = pg.prompt_id
    left join public.topics t on t.id = pi.topic_id
  )
  select jsonb_build_object(
    'total',   (select count(*) from filtered),
    'prompts', (select count(distinct prompt_id) from filtered),
    'rows',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'created_at', r.created_at,
               'prompt_id', r.prompt_id,
               'prompt_text', r.prompt_text,
               'topic_id', r.topic_id,
               'topic_name', r.topic_name,
               'platform', r.platform,
               'model_used', r.model_used,
               'region', r.region,
               'sentiment', r.sentiment,
               'mention_count', r.mention_count,
               'mention_position', r.mention_position,
               'mentioned_entity_count', r.mentioned_entity_count,
               'co_mentioned', r.co_mentioned,
               'response', r.response,
               'group_key', r.group_key,
               'group_count', r.group_count)
             order by
               case when v_group is not null then r.group_count end desc nulls last,
               case when v_group = 'prompt' then lower(r.prompt_text) end,
               r.group_key,
               case when p_sort = 'negative' then
                 case r.sentiment when 'negative' then 0 when 'positive' then 2 else 1 end
               end,
               case when p_sort = 'co_mentions' then r.co_count end desc nulls last,
               case when p_sort = 'oldest' then r.created_at end,
               r.created_at desc,
               r.id)
      from rows_out r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── mentions_perception (00241) ────────────────────────────────────────────
-- Mentions & Sentiment: the Perception tab.

create or replace function public.mentions_perception(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null,
  p_platform  text default null,
  p_region    text default null,
  p_topic_id  uuid default null,
  p_search    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_to       timestamptz := coalesce(p_date_to, now());
  v_from     timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days     integer;
  v_snapshot jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  -- The window's whole days, as mentions_perception_live counts them.
  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if p_date_to is null
     and v_days in (7, 30, 90)
     and p_platform is null
     and p_region is null
     and p_topic_id is null
     and nullif(btrim(coalesce(p_search, '')), '') is null then
    select s.payload into v_snapshot
    from public.mentions_perception_snapshots s
    where s.brand_id = p_brand_id
      and s.days = v_days
      and s.day_to >= (now() at time zone 'utc')::date - 1;
    if v_snapshot is not null then
      return v_snapshot;
    end if;
  end if;

  return public.mentions_perception_live(
    p_brand_id, p_date_from, p_date_to, p_platform, p_region, p_topic_id, p_search);
end;
$$;

-- ── Comments ───────────────────────────────────────────────────────────────
-- Who may call each one, as the check above says it.

comment on function public.insights_same_prompt_compare(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid) is
  'Insights "Same prompts" (VIS-002, 00130) for timestamp windows (24h, topic views), from prompt_results. Same output as insights_same_prompt_compare_daily. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.insights_same_prompt_compare_daily(uuid, date, date, date, date, text[], text, uuid) is
  'Insights "Same prompts" (VIS-002, 00130; by topic, 00164): both windows'' Visibility, mention, citation and sentiment totals over the prompts answered in both, from the prompt-grain rollups, plus new/dropped prompt counts. complete=false until the rows are rewritten by refresh_insights_daily. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.insights_change_drivers(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean) is
  'Insights "Why it changed" (VIS-009, 00135) for timestamp windows (24h, topic views), from prompt_results. Same output as insights_change_drivers_daily. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.insights_change_drivers_daily(uuid, date, date, date, date, text[], text, boolean, uuid) is
  'Insights "Why it changed" (VIS-009, 00135; by topic, 00164): Visibility components per prompt and per (model, platform) in both comparison windows, over the prompts answered in both when p_same_prompts, with prompt text and topic, and the prompts new this period, from the prompt-grain rollups. complete=false until they are backfilled (00130). Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.insights_topic_competitors_daily(uuid, date, date, text[], text) is
  'Insights "Topics vs competitors" (VIS-010, 00137; planned with its arguments, 00152): per active topic, the brand''s Visibility components over the topic''s prompts and each live competitor''s components over the same answers, from the prompt-grain rollups. complete=false until they are backfilled (00130). Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.head_to_head_daily(uuid, text) is
  'Head-to-head on the Competitors page (#923), all time, from the daily rollups (00164): per (prompt, platform, model, region) the runs and the brand''s and the competitor''s visibility, their averages per engine and overall, and each prompt''s text once. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text) is
  'Per-prompt visibility/mention aggregates for the All Prompts table. p_region scopes to one tracked location (#691); NULL blends every location. Planned with its arguments and read from idx_prompt_results_brand_created_metrics (00232). Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads no rows.';

comment on function public.prompt_position_summaries_json(uuid, timestamptz, timestamptz, text) is
  'Tracked Prompts Positions column (#1094): prompt_position_summaries (00123) as one jsonb array, so PostgREST''s max_rows does not cut a large brand''s rows; planned with its arguments. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.topics_overview_window(uuid, timestamptz, timestamptz) is
  'The Topics overview for any window (00156; rollup reads 00170, index-only 00236): per topic, the window''s figures, the same figures for the window of the same length just before, and a point per UTC day for the trend (none under two days). Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads no rows.';

comment on function public.mentions_overview(uuid, timestamptz, timestamptz, text, text, uuid, text) is
  'The Mentions & Sentiment Overview (MS-04, 00157): the brand''s mentions, sentiment and the competitors named beside it in a window, per platform, with the changes on the prompts both windows answered, as Insights takes them (00195). Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.mentions_list(uuid, timestamptz, timestamptz, text, text, uuid, text, text, text, text, text, integer, integer) is
  'The Mentions table (MS-07, 00158; read from its index, 00239): one row per answer naming the brand, a page at a time, with the page''s filters, sorts and groups. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';

comment on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text) is
  'The Perception tab (MS-09, 00161): the terms around the brand''s mentions against the competitors'', from the window''s precomputed snapshot when one fits the request (00241), else mentions_perception_live. Security definer, for a person who can access the brand (00434, can_access_brand), and for the service role, whose callers check the brand first; anyone else reads null.';
