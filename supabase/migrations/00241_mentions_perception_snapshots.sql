-- ============================================================================
-- 00241: the Perception tab's default view, precomputed (Mentions & Sentiment, MS-09)
-- ============================================================================
-- 00237's rollup read took 0.95 s (30 days) and 1.36 s (90 days) warm on
-- production, but on 2026-10-23 the GetCito brand's first load took 8.7 s
-- at 30 days (past the 8 s statement timeout: "Couldn't load") and 8.1 s at
-- 90, its retry 5.3 s: a cold read of the rollups' pages. The target is
-- 2–3 s cold.
--
-- The view everyone opens, the last 7, 30 or 90 days on every platform and
-- region, with no topic or search, is now computed ahead: one row per brand
-- and window in mentions_perception_snapshots, refreshed by the server when
-- a brand's Mentions rollups are (each completed tracking run, the nightly
-- sweep, the deleted-prompt rebuild). Reading it is one primary-key lookup.
--
--   * mentions_perception_live: 00237's read, unchanged, without the access
--     check; only this file's functions call it.
--   * mentions_perception: the access check, then the brand's snapshot for
--     the window when it fits the request (a preset window up to now, no
--     filters, computed today or yesterday, UTC); otherwise the live read.
--     A snapshot from yesterday shows its own window, which ends at the end
--     of yesterday: the day's runs refresh it.
--   * refresh_mentions_perception_snapshot(brand, days): one window per
--     call, so the largest brand's 90 days stay well inside the service
--     role's statement timeout.
--   * A brand's snapshots are set aside when a competitor is renamed or
--     removed, or the brand is renamed: the live read stands in until the
--     next refresh, so names and the competitors shown never go stale.
--   * health_probe gains 'mentions_perception_live', timing the read a
--     filtered view (or a brand without a snapshot) still makes.

create table if not exists public.mentions_perception_snapshots (
  brand_id    uuid not null references public.brands(id) on delete cascade,
  days        smallint not null
    constraint mentions_perception_snapshots_days_check check (days in (7, 30, 90)),
  -- The UTC day the window ends on (its last whole day).
  day_to      date not null,
  payload     jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (brand_id, days)
);

comment on table public.mentions_perception_snapshots is
  'The Perception tab''s default view (MS-09) per brand and window (7, 30 or 90 days, every platform and region, no topic or search), as mentions_perception returns it. Written by refresh_mentions_perception_snapshot; dropped when the brand''s competitors or name change.';

-- Service-role only, no policy: read through mentions_perception.
alter table public.mentions_perception_snapshots enable row level security;
revoke all on table public.mentions_perception_snapshots from anon, authenticated;
grant all on table public.mentions_perception_snapshots to service_role;

-- 00237's read, word for word, without the access check (mentions_perception keeps it).
create or replace function public.mentions_perception_live(
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

revoke all on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to service_role;

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
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
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

revoke execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon;
grant execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to authenticated, service_role;

-- One window of one brand's default view, computed now and kept. The
-- server calls it for 7, 30 and 90 days after it refreshes the brand's
-- Mentions rollups.
create or replace function public.refresh_mentions_perception_snapshot(
  p_brand_id uuid,
  p_days     integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
begin
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'a Perception snapshot covers 7, 30 or 90 days, not %', p_days;
  end if;
  insert into public.mentions_perception_snapshots as s (brand_id, days, day_to, payload, computed_at)
  values (
    p_brand_id,
    p_days,
    (v_now at time zone 'utc')::date,
    public.mentions_perception_live(p_brand_id, v_now - make_interval(days => p_days)),
    v_now)
  on conflict (brand_id, days) do update
    set day_to = excluded.day_to,
        payload = excluded.payload,
        computed_at = excluded.computed_at
    -- A slower refresh that started earlier never writes over a newer one,
    -- nor over a snapshot set aside since (forget_mentions_perception_snapshots).
    where s.computed_at < excluded.computed_at;
end;
$$;

revoke all on function public.refresh_mentions_perception_snapshot(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.refresh_mentions_perception_snapshot(uuid, integer)
  to service_role;

-- A competitor renamed or removed, or the brand renamed, changes what the
-- view lists: its snapshots are set aside (a day_to the read never takes),
-- and the live read stands in. Set aside, not deleted, and stamped now: a
-- refresh already under way when this ran (it started earlier) can't put
-- the old names back. A competitor added changes nothing yet: no answer
-- named it when the rollups were counted.
create or replace function public.forget_mentions_perception_snapshots()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_brands uuid[];
begin
  if tg_table_name = 'brands' then
    v_brands := array[new.id];
  elsif tg_op = 'UPDATE' then
    v_brands := array[old.brand_id, new.brand_id];
  else
    v_brands := array[old.brand_id];
  end if;
  update public.mentions_perception_snapshots
  set day_to = date '1970-01-01', computed_at = clock_timestamp()
  where brand_id = any (v_brands);
  return null;
end;
$$;

revoke all on function public.forget_mentions_perception_snapshots() from public, anon, authenticated;

drop trigger if exists competitors_forget_perception_snapshots on public.competitors;
create trigger competitors_forget_perception_snapshots
  after delete or update of name, brand_id on public.competitors
  for each row execute function public.forget_mentions_perception_snapshots();

drop trigger if exists brands_forget_perception_snapshots on public.brands;
create trigger brands_forget_perception_snapshots
  after update of name on public.brands
  for each row
  when (old.name is distinct from new.name)
  execute function public.forget_mentions_perception_snapshots();

-- health_probe as 00239 left it, with 'mentions_perception_live'.
create or replace function public.health_probe(
  p_user_id uuid,
  p_brand_id uuid,
  p_probe text,
  p_days integer default null
) returns numeric
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  t0 timestamptz;
  ts_from timestamptz := case when p_days is null then null else now() - make_interval(days => p_days) end;
  day_from date := (now() at time zone 'utc')::date - coalesce(p_days, 0);
  page_day_from date := case when p_days is null then null
                             else (now() at time zone 'utc')::date - (p_days - 1) end;
  n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  t0 := clock_timestamp();

  case p_probe
    when 'citations_window_stats' then
      select count(*) into n from public.citations_window_stats(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_domains' then
      select count(*) into n from public.citations_domains(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_urls' then
      select count(*) into n from public.citations_urls(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null,
        p_limit => 100, p_domains => null, p_exclude_domains => null);
    when 'citations_domains_daily' then
      select count(*) into n from public.citations_domains_daily(
        p_brand_id => p_brand_id, p_day_from => page_day_from, p_day_to => null);
    when 'citations_urls_daily' then
      select count(*) into n from public.citations_urls_daily(
        p_brand_id => p_brand_id, p_day_from => page_day_from, p_day_to => null,
        p_limit => 2000);
    when 'insights_aggregates_daily' then
      select count(*) into n from public.insights_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'competitor_aggregates_daily' then
      select count(*) into n from public.competitor_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'topics_overview_aggregates' then
      select count(*) into n from public.topics_overview_aggregates(p_brand_id => p_brand_id);
    -- What the Topics tab runs: its window, the last p_days days (a day when
    -- unset, the tab's default 24 hours).
    when 'topics_overview_window' then
      select count(*) into n from public.topics_overview_window(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 1)),
        p_date_to => null);
    -- The Mentions & Sentiment tabs' reads over the last p_days days (a
    -- month when unset), as the page asks for them: the table's first page,
    -- newest first, and the Perception figures.
    when 'mentions_list' then
      perform public.mentions_list(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 30)),
        p_date_to => null);
    when 'mentions_perception' then
      perform public.mentions_perception(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 30)),
        p_date_to => null);
    -- The read a filtered Perception view makes (and the default view's,
    -- for a brand without a snapshot): an explicit end skips the snapshot.
    when 'mentions_perception_live' then
      perform public.mentions_perception(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 30)),
        p_date_to => now());
    else
      raise exception 'unknown health probe: %', p_probe;
  end case;

  return round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end;
$$;


revoke all on function public.health_probe(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.health_probe(uuid, uuid, text, integer) to service_role;
