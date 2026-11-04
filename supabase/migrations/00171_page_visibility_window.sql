-- ============================================================================
-- 00171: one window for "Pages AI engines aren't sending traffic to" (AT-002)
-- ============================================================================
-- The AI Traffic page's card listed the nightly findings, always the last 28
-- days whatever range the page showed, and judged "no AI traffic" from
-- Google Analytics' AI channel alone. A page the tracking snippet had seen
-- Gemini visitors land on that week could sit in the card, under the visits
-- that contradicted it.
--
-- ga_page_ai_visibility (00075) now takes the window's last day as well as
-- its first, so the server can rank a page's own range on request, and
-- reports each page's snippet visits in that window. The snippet's URLs go
-- through the same normalize_page_path the Analytics pages do, so the two
-- name a page the same way; ai_traffic_logs only keeps visits attributed to
-- an AI platform, so every row counts. The snippet window runs over whole
-- days, at least the timestamps the page itself counts, so a page with a
-- visit in the page's range is never missed.
--
--   * p_since and p_until are both optional and inclusive: no p_since reads
--     from the start, no p_until up to today. Nightly detection still passes
--     only p_since.
--   * The return type gains snippet_visits, so the function is dropped and
--     recreated: CREATE OR REPLACE can't change a return type, and adding a
--     parameter beside the old signature would leave PostgREST two overloads
--     to choose between (00164). The body is otherwise 00075's.

drop function if exists public.ga_page_ai_visibility(uuid, date);

create function public.ga_page_ai_visibility(
  p_brand_id uuid,
  p_since date default null,
  p_until date default null
)
returns table (
  landing_page text,
  sessions bigint,
  engaged_sessions bigint,
  key_events bigint,
  transactions bigint,
  revenue double precision,
  engagement_seconds bigint,
  ai_sessions bigint,
  ai_platforms text[],
  citations bigint,
  citing_prompts bigint,
  targeting_prompts bigint,
  snippet_visits bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as (
    -- citation_urls.domain is already stored lowercased and without www, so
    -- this is an index probe rather than a scan.
    select cu.id, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  cited as (
    select
      ou.page_key,
      count(*)::bigint as citations,
      count(distinct pr.prompt_id)::bigint as citing_prompts
    from own_urls ou
    join public.prompt_result_citations prc
      on prc.url_id = ou.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= coalesce(p_since, '-infinity'::date)
     and prc.created_at < coalesce(p_until + 1, 'infinity'::date)
    join public.prompt_results pr on pr.id = prc.prompt_result_id
    group by ou.page_key
  ),
  targeted as (
    -- Explicit targeting only. "A prompt covers this page's topic" is not
    -- something SQL can decide, and guessing it would put a made-up reason on
    -- a finding; a URL a customer attached to a prompt is a fact.
    select
      lower(public.normalize_page_path(ptu.url)) as page_key,
      count(distinct ptu.prompt_id)::bigint as targeting_prompts
    from public.prompt_target_urls ptu
    join public.prompts p on p.id = ptu.prompt_id
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
    group by 1
  ),
  pages as (
    select
      lower(public.normalize_page_path(gps.landing_page)) as page_key,
      min(public.normalize_page_path(gps.landing_page)) as landing_page,
      sum(gps.sessions)::bigint as sessions,
      sum(gps.engaged_sessions)::bigint as engaged_sessions,
      sum(gps.key_events)::bigint as key_events,
      sum(gps.transactions)::bigint as transactions,
      sum(gps.purchase_revenue) as revenue,
      sum(gps.engagement_duration_seconds)::bigint as engagement_seconds
    from public.ga_page_stats gps
    where gps.brand_id = p_brand_id
      and gps.date >= coalesce(p_since, '-infinity'::date)
      and gps.date <= coalesce(p_until, 'infinity'::date)
    group by 1
  ),
  ai as (
    select
      lower(public.normalize_page_path(gat.landing_page)) as page_key,
      sum(gat.sessions)::bigint as ai_sessions,
      array_remove(array_agg(distinct gat.platform), null) as ai_platforms
    from public.ga_ai_traffic_stats gat
    where gat.brand_id = p_brand_id
      and gat.date >= coalesce(p_since, '-infinity'::date)
      and gat.date <= coalesce(p_until, 'infinity'::date)
      and gat.landing_page <> ''
    group by 1
  ),
  snippet as (
    -- (brand_id, created_at) is indexed, so this reads the window's visits
    -- only.
    select
      lower(public.normalize_page_path(atl.url)) as page_key,
      count(*)::bigint as snippet_visits
    from public.ai_traffic_logs atl
    where atl.brand_id = p_brand_id
      and atl.created_at >= coalesce(p_since, '-infinity'::date)
      and atl.created_at < coalesce(p_until + 1, 'infinity'::date)
    group by 1
  )
  select
    p.landing_page,
    p.sessions,
    p.engaged_sessions,
    p.key_events,
    p.transactions,
    p.revenue,
    p.engagement_seconds,
    coalesce(a.ai_sessions, 0),
    coalesce(a.ai_platforms, '{}'::text[]),
    coalesce(c.citations, 0),
    coalesce(c.citing_prompts, 0),
    coalesce(t.targeting_prompts, 0),
    coalesce(s.snippet_visits, 0)
  from pages p
  left join ai a on a.page_key = p.page_key
  left join cited c on c.page_key = p.page_key
  left join targeted t on t.page_key = p.page_key
  left join snippet s on s.page_key = p.page_key;
$$;

-- Service-role only, as 00075 had it.
revoke all on function public.ga_page_ai_visibility(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.ga_page_ai_visibility(uuid, date, date) to service_role;

comment on function public.ga_page_ai_visibility(uuid, date, date) is
  'Per landing page for one brand (#719, AT-002): Analytics totals, AI-referred sessions, tracking-snippet AI visits, own-domain citations and prompt targeting, between p_since and p_until (both inclusive, both optional). Feeds nightly detection and the AI Traffic page''s range.';

notify pgrst, 'reload schema';
