-- Insights "Compare: Same prompts" (VIS-002).
--
-- Adding prompts inflated every change on the Insights page: 509 new prompts
-- in a period read as +203% mentions, and the breakdown counted each new
-- prompt as a gain from 0. With "Same prompts" on, a change compares only the
-- prompts answered in both periods, and the new ones are counted separately.
--
-- That needs the Visibility components per prompt, for the brand and for
-- every competitor. Computing them from prompt_results on each page load is
-- what the daily rollups exist to avoid (unpacking competitor jsonb over 30
-- days took 16s on the largest brand, 00098), so the two prompt-grain rollup
-- tables gain them:
--
--   insights_prompt_daily             the brand's components per prompt/day
--   insights_competitor_prompt_daily  each competitor's, per sighting
--
-- The new columns are nullable on purpose: existing rows read NULL until
-- refresh_insights_daily rewrites their day. The read functions report such a
-- window as incomplete and the app falls back to comparing all prompts, so a
-- partly backfilled history never shows a wrong change. After deploying, run
-- the existing backfill once to fill the history:
--
--   cd backend && node src/scripts/backfillInsightsDaily.js
--
-- Counting rules are the ones insights_brand_daily and
-- insights_competitor_daily already use, so the per-prompt sums add up to
-- what the card reads.

-- ─── Prompt-grain components ────────────────────────────────────────────────

alter table public.insights_prompt_daily
  add column if not exists mention_answers integer,
  add column if not exists citation_answers integer,
  add column if not exists mentioning_answers integer,
  add column if not exists positive_count integer,
  add column if not exists total_mentions bigint,
  add column if not exists total_citations bigint,
  add column if not exists sum_inv_position numeric,
  add column if not exists position_count integer;

comment on column public.insights_prompt_daily.mention_answers is
  'Answers naming the brand (00130). NULL until refresh_insights_daily rewrites the day.';

alter table public.insights_competitor_prompt_daily
  add column if not exists mention_answers integer,
  add column if not exists citation_answers integer,
  add column if not exists sum_inv_position numeric,
  add column if not exists position_count integer;

comment on column public.insights_competitor_prompt_daily.mention_answers is
  'Answers naming the competitor in this sighting (00130). NULL until refresh_insights_daily rewrites the day.';

-- ─── Refresh: 00098 plus the new columns ────────────────────────────────────

create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
begin
  delete from public.insights_brand_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.model_used, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation,
    mention_answers, citation_answers, mentioning_answers, positive_count,
    total_mentions, total_citations, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    count(*) filter (where pr.sentiment = 'positive'),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_daily (
    brand_id, day, competitor_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0)),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0)
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Same-prompt comparison over the rollups (whole-day windows) ───────────
--
-- The two windows' totals over the prompts answered in both, in the
-- ai_visibility_aggregates shape (so the app folds them the same way), plus
-- how many prompts were only answered in one of them. `complete` is false
-- while any row it read has not been rewritten since 00130.

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
language sql
stable
security invoker
set search_path to 'public'
as $$
  with prompt_rows as (
    select d.*,
           case when d.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between p_cur_from and p_cur_to or d.day between p_prev_from and p_prev_to)
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur' and answer_count > 0)  as in_cur,
           bool_or(win = 'prev' and answer_count > 0) as in_prev
    from prompt_rows
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  brand_agg as (
    select r.win,
           sum(r.answer_count)       as answers,
           sum(r.mention_answers)    as mention_answers,
           sum(r.citation_answers)   as citation_answers,
           sum(r.sum_inv_position) / nullif(sum(r.position_count), 0) as position_factor,
           sum(r.total_mentions)     as total_mentions,
           sum(r.total_citations)    as total_citations,
           sum(r.positive_count)     as positive_count,
           sum(r.mentioning_answers) as mentioning_answers
    from prompt_rows r
    join same_prompts s using (prompt_id)
    group by r.win
  ),
  comp_rows as (
    select cd.*,
           case when cd.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win
    from public.insights_competitor_prompt_daily cd
    join same_prompts s using (prompt_id)
    where cd.brand_id = p_brand_id
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (cd.day between p_cur_from and p_cur_to or cd.day between p_prev_from and p_prev_to)
  ),
  -- Competitors tracked in each window, from the dense day-grain table: the
  -- prompt-grain one only records sightings, so it can't tell a competitor
  -- never named from one not tracked yet. A competitor added during the
  -- period then has no previous value, as on all prompts, instead of a gain
  -- from 0.
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
           max(c.name)                           as name,
           coalesce(sum(cr.mention_answers), 0)  as mention_answers,
           coalesce(sum(cr.citation_answers), 0) as citation_answers,
           sum(cr.sum_inv_position) / nullif(sum(cr.position_count), 0) as position_factor
    from tracked t
    join public.competitors c
      on c.id::text = t.competitor_id and c.brand_id = p_brand_id
    left join comp_rows cr
      on cr.win = t.win and cr.competitor_id = t.competitor_id
    group by t.win, t.competitor_id
  ),
  windows(win) as (values ('cur'), ('prev'))
  select jsonb_build_object(
    'complete', not exists (select 1 from prompt_rows where mention_answers is null)
                and not exists (select 1 from comp_rows where mention_answers is null),
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
  );
$$;

-- ─── Same-prompt comparison over the raw rows (24h and topic views) ────────
--
-- Same output from prompt_results, for the windows the card also reads raw.
-- Each window is selected on its own, inclusive at both ends like
-- ai_visibility_aggregates, so an answer exactly on the boundary counts in
-- both, as it does on the card. Always complete.

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
language sql
stable
security invoker
set search_path to 'public'
as $$
  with filtered as (
    select pr.prompt_id, pr.created_at, pr.mention_count, pr.citation_count,
           pr.mention_position, pr.sentiment, pr.competitor_mentions
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
  windowed as (
    select 'cur' as win, f.* from filtered f
    where f.created_at >= p_cur_from and f.created_at <= p_cur_to
    union all
    select 'prev' as win, f.* from filtered f
    where f.created_at >= p_prev_from and f.created_at <= p_prev_to
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from windowed
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  same_rows as (
    select w.* from windowed w join same_prompts s using (prompt_id)
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
                                                                      as mentioning_answers
    from same_rows
    group by win
  ),
  comp_agg as (
    select r.win,
           cm.value->>'competitor_id' as competitor_id,
           max(c.name)                as name,
           count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0)
                                      as mention_answers,
           count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0)
                                      as citation_answers,
           avg(1.0 / (cm.value->>'mention_position')::numeric)
             filter (where (cm.value->>'mention_position') is not null)
                                      as position_factor
    from same_rows r
    cross join lateral jsonb_array_elements(coalesce(r.competitor_mentions, '[]'::jsonb)) cm
    join public.competitors c
      on c.id::text = cm.value->>'competitor_id' and c.brand_id = p_brand_id
    where cm.value ? 'competitor_id'
    group by r.win, cm.value->>'competitor_id'
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
  );
$$;

revoke all on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text
) from public;
grant execute on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text
) to authenticated, service_role;

revoke all on function public.insights_same_prompt_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid
) from public;
grant execute on function public.insights_same_prompt_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid
) to authenticated, service_role;

comment on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text
) is
  'Insights "Same prompts" (VIS-002, 00130): both windows'' Visibility, mention, citation and sentiment totals over the prompts answered in both, from the prompt-grain rollups, plus new/dropped prompt counts. complete=false until the rows are rewritten by refresh_insights_daily.';

comment on function public.insights_same_prompt_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid
) is
  'Insights "Same prompts" (VIS-002, 00130) for timestamp windows (24h, topic views), from prompt_results. Same output as insights_same_prompt_compare_daily.';
