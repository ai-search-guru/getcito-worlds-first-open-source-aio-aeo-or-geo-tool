-- Action Engine (#818): the reads behind the V1 definition library.
--
-- The V1 specification asks for 62 action definitions. Each needs a signal
-- that can trigger it, and each signal needs a read over data the product
-- already collects — prompt visibility per day, competitor presence per
-- prompt, citation sources, fan-out queries, Search Console queries, AI
-- landing-page traffic.
--
-- Doing those reads from the server row by row is how the nightly pass died on
-- the largest brand twice (#829, #834): a query that scans a brand's history
-- crosses the 8s statement timeout once the brand is large enough. So every
-- read here aggregates in Postgres and returns a compact summary — one row per
-- prompt, per competitor, per domain, per query, per page — measured on the
-- largest brand before being written down:
--
--   ae_citation_sources  1.5s   (was 15s as a naive join)
--   ae_fanout_gaps       0.45s
--
-- All are service-role only. They take a brand id and aggregate across it, and
-- nothing in the web calls them; granting them to authenticated users would
-- only widen the surface for no reader.

-- ─── Prompts: presence per day, current window against the previous one ─────

create or replace function public.ae_prompt_stats(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  with days as (
    select prompt_id, day, bool_or(has_mention) as m, bool_or(has_citation) as c
    from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_prev_from and p_cur_to
    group by prompt_id, day
  ),
  active as (
    select p.id, p.topic_id
    from public.prompts p
    join public.prompt_sets s on s.id = p.prompt_set_id
    where s.brand_id = p_brand_id and p.is_active
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select a.id as prompt_id, a.topic_id,
      count(d.day) filter (where d.day between p_cur_from and p_cur_to) as cur_days,
      count(d.day) filter (where d.day between p_cur_from and p_cur_to and d.m) as cur_mention_days,
      count(d.day) filter (where d.day between p_cur_from and p_cur_to and d.c) as cur_citation_days,
      count(d.day) filter (where d.day between p_prev_from and p_prev_to) as prev_days,
      count(d.day) filter (where d.day between p_prev_from and p_prev_to and d.m) as prev_mention_days,
      count(d.day) filter (where d.day between p_prev_from and p_prev_to and d.c) as prev_citation_days,
      max(d.day) filter (where d.m) as last_mention_day,
      max(d.day) filter (where d.c) as last_citation_day,
      (select coalesce(max(v.est_ai_volume), 0) from public.prompt_volumes v where v.prompt_id = a.id) as volume,
      exists (select 1 from public.prompt_target_urls t where t.prompt_id = a.id) as has_target_url
    from active a
    left join days d on d.prompt_id = a.id
    group by a.id, a.topic_id
  ) x
$$;

-- ─── Competitors: presence per prompt ───────────────────────────────────────

create or replace function public.ae_competitor_prompt_stats(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  with days as (
    select prompt_id, competitor_id, day
    from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_prev_from and p_cur_to
    group by prompt_id, competitor_id, day
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select prompt_id, competitor_id,
      count(*) filter (where day between p_cur_from and p_cur_to) as cur_days,
      count(*) filter (where day between p_prev_from and p_prev_to) as prev_days
    from days
    group by prompt_id, competitor_id
  ) x
$$;

-- ─── Dimensions: visibility by platform, by region, and per competitor ───────

create or replace function public.ae_dimension_stats(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'platforms', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select platform as key,
          sum(answer_count) filter (where day between p_cur_from and p_cur_to) as cur_answers,
          sum(mention_answers) filter (where day between p_cur_from and p_cur_to) as cur_mentions,
          sum(answer_count) filter (where day between p_prev_from and p_prev_to) as prev_answers,
          sum(mention_answers) filter (where day between p_prev_from and p_prev_to) as prev_mentions
        from public.insights_brand_daily
        where brand_id = p_brand_id and day between p_prev_from and p_cur_to
        group by platform
      ) x
    ),
    'regions', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select region as key,
          sum(answer_count) filter (where day between p_cur_from and p_cur_to) as cur_answers,
          sum(mention_answers) filter (where day between p_cur_from and p_cur_to) as cur_mentions,
          sum(answer_count) filter (where day between p_prev_from and p_prev_to) as prev_answers,
          sum(mention_answers) filter (where day between p_prev_from and p_prev_to) as prev_mentions
        from public.insights_brand_daily
        where brand_id = p_brand_id and day between p_prev_from and p_cur_to
        group by region
      ) x
    ),
    'competitors', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select c.competitor_id as key, max(co.name) as name,
          sum(c.mention_answers) filter (where c.day between p_cur_from and p_cur_to) as cur_mentions,
          sum(c.mention_answers) filter (where c.day between p_prev_from and p_prev_to) as prev_mentions,
          sum(c.citation_answers) filter (where c.day between p_cur_from and p_cur_to) as cur_citations
        from public.insights_competitor_daily c
        left join public.competitors co on co.id::text = c.competitor_id
        where c.brand_id = p_brand_id and c.day between p_prev_from and p_cur_to
        group by c.competitor_id
      ) x
    )
  )
$$;

-- ─── Citation sources: which domains answers cite, and whose answers ────────

create or replace function public.ae_citation_sources(p_brand_id uuid, p_from timestamptz)
returns jsonb
language sql stable
as $$
  with owned as (
    select regexp_replace(lower(domain), '^www\.', '') as d
    from public.brand_domains where brand_id = p_brand_id
  ),
  r as materialized (
    select id, prompt_id, coalesce(mention_count, 0) > 0 as bm,
           coalesce(competitor_mentions @? '$[*] ? (@.mention_count > 0)', false) as cm
    from public.prompt_results
    where brand_id = p_brand_id and created_at >= p_from
  ),
  rd as materialized (
    select distinct prc.prompt_result_id as rid, regexp_replace(lower(u.domain), '^www\.', '') as domain
    from public.prompt_result_citations prc
    join public.citation_urls u on u.id = prc.url_id
    where prc.brand_id = p_brand_id and prc.created_at >= p_from
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select rd.domain,
      exists (select 1 from owned o where rd.domain = o.d or rd.domain like '%.' || o.d) as owned,
      count(*) as results,
      count(distinct r.prompt_id) as prompts,
      count(*) filter (where r.bm) as with_brand,
      count(*) filter (where r.cm and not r.bm) as competitor_only,
      count(*) filter (where not r.bm) as without_brand
    from rd join r on r.id = rd.rid
    group by rd.domain
    order by count(*) desc
    limit 300
  ) x
$$;

-- ─── Owned URLs: how often each owned page was cited, now and before ────────

create or replace function public.ae_owned_citations(
  p_brand_id uuid, p_cur_from timestamptz, p_prev_from timestamptz
) returns jsonb
language sql stable
as $$
  with owned as (
    select regexp_replace(lower(domain), '^www\.', '') as d
    from public.brand_domains where brand_id = p_brand_id
  ),
  cites as materialized (
    select prc.created_at, u.url, regexp_replace(lower(u.domain), '^www\.', '') as domain
    from public.prompt_result_citations prc
    join public.citation_urls u on u.id = prc.url_id
    where prc.brand_id = p_brand_id and prc.created_at >= p_prev_from
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select c.url,
      count(*) filter (where c.created_at >= p_cur_from) as cur_citations,
      count(*) filter (where c.created_at < p_cur_from) as prev_citations
    from cites c
    where exists (select 1 from owned o where c.domain = o.d or c.domain like '%.' || o.d)
    group by c.url
    order by count(*) desc
    limit 300
  ) x
$$;

-- ─── Fan-out queries the engines ran where the brand never appeared ─────────

create or replace function public.ae_fanout_gaps(p_brand_id uuid, p_from timestamptz)
returns jsonb
language sql stable
as $$
  with r as materialized (
    select id, prompt_id, coalesce(mention_count, 0) > 0 as bm,
           coalesce(competitor_mentions @? '$[*] ? (@.mention_count > 0)', false) as cm,
           search_queries
    from public.prompt_results
    where brand_id = p_brand_id and created_at >= p_from
      and jsonb_typeof(search_queries) = 'array'
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select lower(trim(q->>'query')) as query,
      count(*) as results,
      count(distinct r.prompt_id) as prompts,
      count(*) filter (where r.cm and not r.bm) as competitor_only
    from r cross join lateral jsonb_array_elements(r.search_queries) q
    where coalesce(trim(q->>'query'), '') <> ''
    group by 1
    having count(*) filter (where r.bm) = 0
    order by count(distinct r.prompt_id) desc, count(*) desc
    limit 300
  ) x
$$;

-- ─── Search Console: per query, now against before ──────────────────────────

create or replace function public.ae_gsc_queries(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select query,
      sum(clicks) filter (where date between p_cur_from and p_cur_to) as cur_clicks,
      sum(impressions) filter (where date between p_cur_from and p_cur_to) as cur_impressions,
      avg(position) filter (where date between p_cur_from and p_cur_to) as cur_position,
      sum(clicks) filter (where date between p_prev_from and p_prev_to) as prev_clicks,
      sum(impressions) filter (where date between p_prev_from and p_prev_to) as prev_impressions
    from public.gsc_query_stats
    where brand_id = p_brand_id and date between p_prev_from and p_cur_to
    group by query
    order by sum(impressions) filter (where date between p_cur_from and p_cur_to) desc nulls last
    limit 500
  ) x
$$;

-- ─── AI landing pages: analytics and the tracking snippet, per page ─────────

create or replace function public.ae_ai_traffic_pages(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  with ga as (
    select landing_page as page,
      sum(sessions) filter (where date between p_cur_from and p_cur_to) as cur_sessions,
      sum(sessions) filter (where date between p_prev_from and p_prev_to) as prev_sessions,
      sum(engaged_sessions) filter (where date between p_cur_from and p_cur_to) as cur_engaged,
      sum(key_events) filter (where date between p_cur_from and p_cur_to) as cur_key_events,
      sum(key_events) filter (where date between p_prev_from and p_prev_to) as prev_key_events
    from public.ga_ai_traffic_stats
    where brand_id = p_brand_id and date between p_prev_from and p_cur_to
    group by landing_page
  ),
  snippet as (
    select url as page,
      count(*) filter (where created_at::date between p_cur_from and p_cur_to) as cur_sessions,
      count(*) filter (where created_at::date between p_prev_from and p_prev_to) as prev_sessions
    from public.ai_traffic_logs
    where brand_id = p_brand_id and created_at >= p_prev_from
    group by url
  )
  select jsonb_build_object(
    'analytics', (select coalesce(jsonb_agg(row_to_json(g)), '[]'::jsonb) from (select * from ga order by cur_sessions desc nulls last limit 300) g),
    'snippet', (select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) from (select * from snippet order by cur_sessions desc nulls last limit 300) s)
  )
$$;

-- Service-role only.
revoke all on function public.ae_prompt_stats(uuid, date, date, date, date) from public, anon, authenticated;
revoke all on function public.ae_competitor_prompt_stats(uuid, date, date, date, date) from public, anon, authenticated;
revoke all on function public.ae_dimension_stats(uuid, date, date, date, date) from public, anon, authenticated;
revoke all on function public.ae_citation_sources(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.ae_owned_citations(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ae_fanout_gaps(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.ae_gsc_queries(uuid, date, date, date, date) from public, anon, authenticated;
revoke all on function public.ae_ai_traffic_pages(uuid, date, date, date, date) from public, anon, authenticated;

grant execute on function public.ae_prompt_stats(uuid, date, date, date, date) to service_role;
grant execute on function public.ae_competitor_prompt_stats(uuid, date, date, date, date) to service_role;
grant execute on function public.ae_dimension_stats(uuid, date, date, date, date) to service_role;
grant execute on function public.ae_citation_sources(uuid, timestamptz) to service_role;
grant execute on function public.ae_owned_citations(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.ae_fanout_gaps(uuid, timestamptz) to service_role;
grant execute on function public.ae_gsc_queries(uuid, date, date, date, date) to service_role;
grant execute on function public.ae_ai_traffic_pages(uuid, date, date, date, date) to service_role;
