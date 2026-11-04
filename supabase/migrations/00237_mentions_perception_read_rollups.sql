-- ============================================================================
-- 00237: the Perception tab reads the daily rollups (Mentions & Sentiment, MS-09)
-- ============================================================================
-- 00161's read, the same jsonb and the same rules. For whole UTC days (two
-- days or more) without a topic or a search, the rollups 00231 adds stand in
-- for the answers' terms; under two days, or filtered to some prompts, it
-- reads the answers' terms as before.
--
-- Apply it after 00231, the server and
-- `node src/scripts/backfillMentionTermsDaily.js` (server): this read
-- doesn't fall back to the answers' terms, so a day not yet in the rollups
-- would show as empty. Timed on production (as owner, rolled back): 30 days
-- 0.95 s and 90 days 1.36 s, against 6.2–16.3 s for 00161's read.

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
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_to         timestamptz := coalesce(p_date_to, now());
  v_from       timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days       integer;
  v_day_to     date;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_search     text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_rollup     boolean;
  v_start_day  date;
  v_end_day    date;
  v_prev_day   date;
  v_result     jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;
  v_prev_start := v_start - (v_end - v_start);
  -- Whole UTC days with no topic or search read the daily rollups (00231);
  -- a window under two days, or a filter on the prompts, reads the answers'
  -- terms as before. The branch not taken is pruned (plan_cache_mode).
  v_rollup    := v_days >= 2 and p_topic_id is null and v_search is null;
  v_start_day := (v_start at time zone 'utc')::date;
  v_end_day   := (v_end at time zone 'utc')::date;
  v_prev_day  := (v_prev_start at time zone 'utc')::date;

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  rows_in as (
    select t.result_id, t.entity, t.terms, (t.created_at >= v_start) as cur
    from public.mentions_answer_terms t
    join prompts_in pi on pi.id = t.prompt_id
    where not v_rollup
      and t.brand_id = p_brand_id
      and t.created_at >= v_prev_start
      and t.created_at < v_end
      and (p_platform is null or t.platform = p_platform)
      and (p_region is null or t.region = p_region)
  ),
  entity_counts as (
    select entity,
           count(*) filter (where cur)     as mentions,
           count(*) filter (where not cur) as prev_mentions
    from rows_in
    group by entity
    union all
    select d.entity,
           coalesce(sum(d.answers) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.answers) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
  ),
  shown as (
    select 'brand'::text as entity, 0 as rank
    union all
    select * from (
      select ec.entity, row_number() over (order by ec.mentions desc, ec.entity)::int
      from entity_counts ec
      join public.competitors co on co.id::text = ec.entity and co.brand_id = p_brand_id
      where ec.mentions > 0
      order by ec.mentions desc, ec.entity
      limit 4
    ) top_competitors
  ),
  term_counts_all as (
    select r.entity, term,
           count(*) filter (where r.cur)     as answers,
           count(*) filter (where not r.cur) as prev_answers
    from rows_in r
    join shown s on s.entity = r.entity
    cross join lateral unnest(r.terms) as term
    group by r.entity, term
    union all
    select d.entity, d.term,
           coalesce(sum(d.answers) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.answers) filter (where d.day < v_start_day), 0)
    from public.mentions_terms_daily d
    join shown s on s.entity = d.entity
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity, d.term
  ),
  -- Each entity's 60 most frequent terms are the candidates.
  candidates as (
    select entity, term, answers, prev_answers
    from (
      select t.*, row_number() over (partition by t.entity order by t.answers desc, t.term) as rn
      from term_counts_all t
      where t.answers > 0
    ) ranked
    where rn <= 60
  ),
  -- A word that nearly always comes in one phrase is that phrase: "fresh" and
  -- "roast" give way to "fresh roast" when it has 80% of their answers.
  term_counts as (
    select c.*
    from candidates c
    where position(' ' in c.term) > 0
       or not exists (
         select 1 from candidates p
         where p.entity = c.entity
           and position(' ' in p.term) > 0
           and (p.term like c.term || ' %' or p.term like '% ' || c.term)
           and p.answers >= 0.8 * c.answers)
  ),
  brand_terms as (
    select term, answers, prev_answers
    from term_counts
    where entity = 'brand' and answers > 0
    order by answers desc, term
    limit 15
  ),
  -- The terms that tell the brands apart most: the widest spread between the
  -- highest and lowest share of mentions, then the highest shares.
  attributes as (
    select u.term
    from (select distinct term from term_counts) u
    cross join shown s
    left join term_counts_all tc on tc.entity = s.entity and tc.term = u.term
    left join entity_counts ec on ec.entity = s.entity
    group by u.term
    order by
      max(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0))
        - min(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      sum(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      u.term
    limit 8
  ),
  -- A competitor's rows in answers that name the brand too, in one pass.
  co as (
    select x.entity,
           count(*) filter (where x.cur)     as co_mentions,
           count(*) filter (where not x.cur) as prev_co_mentions
    from (
      select r.entity, r.cur,
             bool_or(r.entity = 'brand') over (partition by r.result_id) as with_brand
      from rows_in r
    ) x
    where x.entity <> 'brand' and x.with_brand
    group by x.entity
    union all
    select d.entity,
           coalesce(sum(d.with_brand) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.with_brand) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.entity <> 'brand'
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
    having sum(d.with_brand) > 0
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', v_start, 'to', v_end, 'days', v_days),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity', s.entity,
               'name', case when s.entity = 'brand' then b.name else co.name end,
               'is_brand', s.entity = 'brand',
               'mentions', coalesce(ec.mentions, 0),
               'prev_mentions', coalesce(ec.prev_mentions, 0))
             order by s.rank)
      from shown s
      left join entity_counts ec on ec.entity = s.entity
      left join public.brands b on s.entity = 'brand' and b.id = p_brand_id
      left join public.competitors co on co.id::text = s.entity and co.brand_id = p_brand_id
    ), '[]'::jsonb),
    'brand_terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', bt.term, 'answers', bt.answers, 'prev_answers', bt.prev_answers)
             order by bt.answers desc, bt.term)
      from brand_terms bt
    ), '[]'::jsonb),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', a.term,
               'values', (
                 select jsonb_agg(jsonb_build_object(
                          'entity', s.entity, 'answers', coalesce(tc.answers, 0))
                        order by s.rank)
                 from shown s
                 left join term_counts_all tc on tc.entity = s.entity and tc.term = a.term)))
      from attributes a
    ), '[]'::jsonb),
    'co_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'competitor_id', c.entity,
               'name', comp.name,
               'co_mentions', c.co_mentions,
               'prev_co_mentions', c.prev_co_mentions)
             order by c.co_mentions desc, comp.name)
      from co c
      join public.competitors comp on comp.id::text = c.entity and comp.brand_id = p_brand_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon;
grant execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to authenticated, service_role;
