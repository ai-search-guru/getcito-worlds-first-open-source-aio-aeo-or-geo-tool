-- ============================================================================
-- 00179: where AI visitors convert (AT-014)
-- ============================================================================
-- Spec §3.4b, two cards that need Google Analytics:
--
--   * Top converting pages from AI — landing pages ranked by the key events
--     (or revenue, when the property reports purchases) of their AI-referred
--     sessions, with those sessions, the sessions with a key event (the rate,
--     00177) and the platform whose visitors converted most.
--   * Which answers bring buyers — AI platform × topic: the key events of a
--     platform's visitors on the pages that tracked answers in a topic cite,
--     so the topics worth protecting first are the ones that bring buyers.
--
-- Both read Analytics' own AI sessions (ga_ai_traffic_stats): the key events
-- are theirs, so the visits and the rate come from the same sessions. Pages
-- are keyed by lower(normalize_page_path(...)), as the Pages section's are
-- (00178). A topic is one of the tracked prompts whose answers cited the page
-- in the window, on any platform; a page cited in two topics counts in both.
--
-- citation_urls has no member select policy, so this runs as its owner after
-- checking the caller belongs to the brand's organization; a caller from
-- elsewhere gets nothing.

create or replace function public.ai_traffic_conversions(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  with
  -- Analytics' AI sessions per page and platform over the window's days.
  by_platform as (
    select
      lower(public.normalize_page_path(g.landing_page)) as page_key,
      min(public.normalize_page_path(g.landing_page)) as page,
      coalesce(g.platform, g.source) as platform,
      sum(g.sessions)::bigint as sessions,
      sum(g.key_events)::bigint as key_events,
      sum(g.key_event_sessions)::bigint as key_event_sessions,
      sum(g.transactions)::bigint as transactions,
      coalesce(sum(g.purchase_revenue), 0)::numeric as revenue
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.date >= coalesce(p_since, '-infinity'::date)
      and g.date <= coalesce(p_until, 'infinity'::date)
    group by 1, 3
  ),
  pages as (
    select
      page_key,
      min(page) as page,
      sum(sessions)::bigint as sessions,
      sum(key_events)::bigint as key_events,
      sum(key_event_sessions)::bigint as key_event_sessions,
      sum(transactions)::bigint as transactions,
      sum(revenue) as revenue
    from by_platform
    group by page_key
  ),
  -- The platform whose visitors converted most on each page.
  best as (
    select distinct on (page_key) page_key, platform
    from by_platform
    where key_events > 0 or revenue > 0
    order by page_key, revenue desc, key_events desc, sessions desc, platform
  ),
  converting as (
    select p.*, b.platform as best_platform
    from pages p
    left join best b on b.page_key = p.page_key
    where p.key_events > 0 or p.revenue > 0
  ),
  -- The topics of the tracked prompts whose answers cited a converting page.
  own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as (
    -- citation_urls.domain is stored lowercased and without www: an index probe.
    select cu.id, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  cited_topics as (
    select distinct ou.page_key, t.id as topic_id, t.name as topic
    from own_urls ou
    join converting c on c.page_key = ou.page_key
    join public.prompt_result_citations prc
      on prc.url_id = ou.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= coalesce(p_since::timestamp at time zone 'utc', '-infinity'::timestamptz)
     and prc.created_at < coalesce((p_until + 1)::timestamp at time zone 'utc', 'infinity'::timestamptz)
    join public.prompt_results pr on pr.id = prc.prompt_result_id
    join public.prompts p on p.id = pr.prompt_id
    join public.topics t on t.id = p.topic_id
  ),
  answers as (
    select
      bp.platform,
      ct.topic_id,
      min(ct.topic) as topic,
      count(distinct bp.page_key)::bigint as pages,
      sum(bp.sessions)::bigint as sessions,
      sum(bp.key_events)::bigint as key_events,
      sum(bp.key_event_sessions)::bigint as key_event_sessions,
      sum(bp.revenue) as revenue
    from by_platform bp
    join cited_topics ct on ct.page_key = bp.page_key
    group by bp.platform, ct.topic_id
    having sum(bp.key_events) > 0 or sum(bp.revenue) > 0
  )
  select jsonb_build_object(
    -- All AI sessions in the window, converting or not: the caller widens a
    -- short range that has too few to say anything.
    'sessions', (select coalesce(sum(sessions), 0) from pages),
    'has_revenue', exists (select 1 from pages where revenue > 0),
    'page_count', (select count(*) from converting),
    'answer_count', (select count(*) from answers),
    -- Ranked by revenue, which is 0 everywhere without purchases, then key events.
    'pages', coalesce((
      select jsonb_agg(to_jsonb(r) - 'page_key')
      from (
        select * from converting
        order by revenue desc, key_events desc, sessions desc, page
        limit p_limit
      ) r
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(to_jsonb(a))
      from (
        select * from answers
        order by revenue desc, key_events desc, sessions desc, platform, topic
        limit p_limit
      ) a
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.ai_traffic_conversions(uuid, date, date, integer) from public, anon;
grant execute on function public.ai_traffic_conversions(uuid, date, date, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_conversions(uuid, date, date, integer) is
  'AI Traffic "Where AI visitors convert" (AT-014, spec §3.4b): converting landing pages from Analytics'' AI sessions (sessions, key events, sessions with a key event, revenue, best platform) and AI platform × topic of the tracked prompts whose answers cite them. Security definer with an organization check: citation_urls has no member select policy.';

notify pgrst, 'reload schema';
