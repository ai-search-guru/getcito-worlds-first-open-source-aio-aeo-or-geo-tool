-- ============================================================================
-- 00435: brand access — the AI traffic, content and shopping functions
-- ============================================================================
-- 00389 narrowed the brands table, and every policy that reads a brand through
-- it follows. A security definer function doesn't: it reads past RLS and
-- checks the caller itself. These twenty-three still ask only whether the
-- brand belongs to the caller's organization (brands joined to the caller's
-- profile on organization_id), so a Selected-brands person could read or
-- change a brand they can't see through them. Each now asks can_access_brand
-- (00388) too:
--   * AI Traffic: ai_traffic_page_citations (00178), ai_traffic_conversions
--     (00179), ai_traffic_google_pages (00181), ai_traffic_pages (00186),
--     ai_bot_report (00190), ai_traffic_broken_links (00200), and
--     brand_ai_conversions (00288), its conversions on the Content plan;
--   * the Content Editor and Content plan: content_page_impact (00209),
--     content_page_results (00210), content_page_overlap and
--     content_plan_insights (00226), content_start_prompts (00230),
--     content_page_conversions (00287), content_plan_pages (00291), and the
--     two that take a draft and check its brand: content_draft_cited_answers
--     (00216) and content_draft_sources (00226);
--   * Shopping and the catalog: shopping_amazon_share_weekly (00225),
--     shopping_merchant_split and shopping_own_product_offers (00268),
--     catalog_product_ai_stats (00361);
--   * three writes for an admin or manager of the brand's organization:
--     seed_kpi_presets (00163), override_mention_sentiment (00223) and
--     approve_action_task_review (00375).
--
-- The last of three waves (BRAND-ACCESS PR 4–6), after the citation and
-- report functions (00426) and Insights, Mentions and Topics (00434). None
-- is left to convert: frontend/src/lib/brandAccessFunctions.test.ts fails on a
-- new function that checks only the organization.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for an All-brands person can_access_brand(brand) is true
-- exactly when the brand is their organization's, the check it replaces.
-- Unlike the citation functions, these let the service role through (the
-- server, MCP and Chat call them with it, and check the brand first), and
-- still do: can_access_brand answers no without a person, so the
-- service-role test stays beside it. anon may run none of them, as before.
--
-- How:
--   * Each function is its last definition, word for word, with only the
--     check changed. The reads keep their early return, now taken when the
--     caller isn't the service role and can_access_brand(p_brand_id) (the
--     draft's brand for the two draft reads) is false. It runs once per
--     call, as before.
--   * The three writes keep their organization and role check and add
--     can_access_brand for the person they act for (under the service role
--     the API key's owner, p_user_id; else the caller). A brand that person
--     can't access answers as another organization's did: 42501 from
--     seed_kpi_presets and override_mention_sentiment, null from
--     approve_action_task_review.
--   * create or replace resets the settings a definition doesn't repeat, so
--     each repeats its own: search_path, and plan_cache_mode where it had
--     it. Grants stay as they were (create or replace keeps them).
--   * The comments that said "with an organization check" now say brand
--     access, and the six functions that had none get one.
--   * can_access_brand runs as the function's owner here, as in 00426.

-- ── ai_traffic_page_citations (00178) ──────────────────────────────────────
-- AI Traffic: how often answers cited each of the brand's own pages.

create or replace function public.ai_traffic_page_citations(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns table (page_key text, page text, citations bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return;
  end if;

  return query
  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  )
  select
    lower(public.normalize_page_path(cu.url)),
    min(public.normalize_page_path(cu.url)),
    sum(d.citations)::bigint
  from public.citation_url_daily d
  join public.citation_urls cu on cu.id = d.url_id
  where d.brand_id = p_brand_id
    and d.day >= coalesce(p_since, '-infinity'::date)
    and d.day <= coalesce(p_until, 'infinity'::date)
    and cu.domain in (select domain from own_domains)
  group by 1;
end;
$$;

-- ── ai_traffic_conversions (00179) ─────────────────────────────────────────
-- AI Traffic "Where AI visitors convert".

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
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
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

-- ── ai_traffic_google_pages (00181) ────────────────────────────────────────
-- AI Traffic "Is AI taking Google clicks?".

create or replace function public.ai_traffic_google_pages(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_latest boolean default false,
  p_min_impressions integer default 100,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_first date;
  v_last date;
  v_since date;
  v_until date;
  v_prev_since date;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  select min(g.date), max(g.date) into v_first, v_last
  from public.gsc_page_stats g
  where g.brand_id = p_brand_id;

  if p_since is null or v_last is null then
    return jsonb_build_object(
      'last_day', v_last,
      'since', null, 'until', null, 'prev_since', null, 'prev_until', null,
      'incomplete', false, 'count', 0, 'rows', '[]'::jsonb
    );
  end if;

  v_since := p_since;
  v_until := p_until;
  if p_latest and v_last < p_until then
    v_since := v_last - (p_until - p_since);
    v_until := v_last;
  end if;
  v_prev_since := v_since - (v_until - v_since) - 1;

  if v_first > v_prev_since then
    return jsonb_build_object(
      'last_day', v_last,
      'since', v_since, 'until', v_until,
      'prev_since', v_prev_since, 'prev_until', v_since - 1,
      'incomplete', true, 'count', 0, 'rows', '[]'::jsonb
    );
  end if;

  with by_page as (
    select
      g.page_key,
      min(g.page) as url,
      sum(g.impressions) filter (where g.date >= v_since)::bigint as impressions,
      sum(g.clicks) filter (where g.date >= v_since)::bigint as clicks,
      sum(g.impressions) filter (where g.date < v_since)::bigint as prev_impressions,
      sum(g.clicks) filter (where g.date < v_since)::bigint as prev_clicks
    from public.gsc_page_stats g
    where g.brand_id = p_brand_id
      and g.date >= v_prev_since
      and g.date <= v_until
    group by 1
  ),
  flagged as (
    select
      bp.*,
      bp.clicks::double precision / nullif(bp.impressions, 0) as ctr,
      bp.prev_clicks::double precision / nullif(bp.prev_impressions, 0) as prev_ctr
    from by_page bp
    where bp.prev_impressions >= greatest(p_min_impressions, 1)
      and bp.prev_clicks > 0
      and bp.impressions >= bp.prev_impressions * 1.15
      and bp.clicks::double precision / nullif(bp.impressions, 0)
          <= 0.8 * bp.prev_clicks::double precision / nullif(bp.prev_impressions, 0)
  ),
  -- Only the rows shown work out their display path.
  ranked as (
    select f.*, public.normalize_page_path(f.url) as page,
      f.prev_ctr * f.impressions - f.clicks as clicks_lost
    from flagged f
    order by clicks_lost desc, f.impressions desc, f.page_key
    limit p_limit
  ),
  -- A tracked prompt pointing to the page.
  targeted as (
    select distinct on (lower(public.normalize_page_path(ptu.url)))
      lower(public.normalize_page_path(ptu.url)) as page_key,
      ptu.prompt_id
    from public.prompt_target_urls ptu
    join public.prompts p on p.id = ptu.prompt_id and p.is_active
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and lower(public.normalize_page_path(ptu.url)) in (select page_key from ranked)
    order by lower(public.normalize_page_path(ptu.url)), p.created_at, ptu.prompt_id
  ),
  -- Else an active prompt that cited the page in 90 days.
  own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as (
    select cu.id, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
      and lower(public.normalize_page_path(cu.url)) in (
        select r.page_key from ranked r
        where r.page_key not in (select t.page_key from targeted t)
      )
  ),
  -- The first citation found whose prompt is active, not the latest or the
  -- most-citing one: ordering needs every citation's created_at, a heap read
  -- for each (the (url_id, brand_id) index has none), 35,700 rows and 7.5 s
  -- cold on the largest brand's 50 pages, past the 8 s timeout with the rest.
  -- Stopping at the first match read about 2,100 pages, in 2 s. Any prompt
  -- that cited the page serves the Positions link, and a paused one is
  -- skipped rather than leaving the page without one.
  cited as (
    select pk.page_key, c.prompt_id
    from (
      select ou.page_key, array_agg(ou.id) as url_ids
      from own_urls ou
      group by ou.page_key
    ) pk
    cross join lateral (
      select pr.prompt_id
      from public.prompt_result_citations prc
      join public.prompt_results pr on pr.id = prc.prompt_result_id
      join public.prompts p on p.id = pr.prompt_id and p.is_active
      where prc.url_id = any (pk.url_ids)
        and prc.brand_id = p_brand_id
        and prc.created_at >= now() - interval '90 days'
      limit 1
    ) c
  )
  select jsonb_build_object(
    'last_day', v_last,
    'since', v_since,
    'until', v_until,
    'prev_since', v_prev_since,
    'prev_until', v_since - 1,
    'incomplete', false,
    'count', (select count(*) from flagged),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'page', r.page,
          'url', r.url,
          'impressions', r.impressions,
          'prev_impressions', r.prev_impressions,
          'clicks', r.clicks,
          'prev_clicks', r.prev_clicks,
          'prompt_id', coalesce(t.prompt_id, c.prompt_id)
        )
        order by r.clicks_lost desc, r.impressions desc, r.page_key
      )
      from ranked r
      left join targeted t on t.page_key = r.page_key
      left join cited c on c.page_key = r.page_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── ai_traffic_pages (00186) ───────────────────────────────────────────────
-- AI Traffic: the Pages section.

create or replace function public.ai_traffic_pages(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tab text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_since date := (p_from at time zone 'utc')::date;
  v_until date := coalesce((p_to at time zone 'utc')::date, (now() at time zone 'utc')::date);
  -- The 24-hour range reads the snippet alone, as the rest of the page does:
  -- Analytics has no hours (00176).
  v_hourly boolean := p_from is not null and coalesce(p_to, now()) - p_from <= interval '25 hours';
  v_result jsonb;
begin
  if p_tab not in ('all', 'no_ai_traffic', 'cited_not_clicked', 'traffic_no_prompt') then
    raise exception 'unknown tab %', p_tab;
  end if;
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  with
  -- AI visits per page, day by day from the snippet or Analytics (00176).
  ai as (
    select lower(e->>'page') as page_key, min(e->>'page') as page, sum((e->>'visits')::bigint) as visits
    from jsonb_array_elements(
      public.ai_traffic_merged(p_brand_id, p_from, p_to, true, not v_hourly) -> 'pages'
    ) e
    group by 1
  ),
  -- Days the snippet was active, over the whole UTC day (00176's rule).
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= coalesce(v_since::timestamp at time zone 'utc', '-infinity'::timestamptz)
      and l.created_at < (v_until + 1)::timestamp at time zone 'utc'
  ),
  -- Which assistants sent them, counted as the AI visits are: the snippet,
  -- and Analytics on days without it (never within 24 hours).
  platform_visits as (
    select lower(public.normalize_page_path(l.url)) as page_key,
           coalesce(nullif(l.source_platform, ''), 'unknown') as platform,
           count(*)::bigint as visits
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= coalesce(p_from, '-infinity'::timestamptz)
      and (p_to is null or l.created_at <= p_to)
    group by 1, 2
    union all
    select lower(public.normalize_page_path(g.landing_page)),
           coalesce(g.platform, g.source),
           sum(g.sessions)::bigint
    from public.ga_ai_traffic_stats g
    where not v_hourly
      and g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.sessions > 0
      and g.date >= coalesce(v_since, '-infinity'::date)
      and g.date <= v_until
      and not exists (select 1 from snippet_days s where s.day = g.date)
    group by 1, 2
  ),
  platforms as (
    select page_key, (array_agg(platform order by visits desc, platform))[1:3] as platforms
    from (select page_key, platform, sum(visits) as visits from platform_visits group by 1, 2) t
    group by 1
  ),
  -- Key events in AI sessions: only Analytics has them, and it has no hours.
  ai_key_events as (
    select lower(public.normalize_page_path(g.landing_page)) as page_key, sum(g.key_events)::bigint as key_events
    from public.ga_ai_traffic_stats g
    where not v_hourly
      and g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.date >= coalesce(v_since, '-infinity'::date)
      and g.date <= v_until
    group by 1
  ),
  -- Every channel's traffic, for the No AI traffic list's value.
  traffic as (
    select
      lower(public.normalize_page_path(gps.landing_page)) as page_key,
      min(public.normalize_page_path(gps.landing_page)) as page,
      sum(gps.sessions)::bigint as sessions,
      sum(gps.engaged_sessions)::bigint as engaged_sessions,
      sum(gps.key_events)::bigint as key_events,
      sum(gps.transactions)::bigint as transactions,
      sum(gps.purchase_revenue) as revenue,
      sum(gps.engagement_duration_seconds)::bigint as engagement_seconds
    from public.ga_page_stats gps
    where gps.brand_id = p_brand_id
      and gps.date >= coalesce(v_since, '-infinity'::date)
      and gps.date <= v_until
    group by 1
  ),
  cited as (
    select c.page_key, c.page, c.citations
    from public.ai_traffic_page_citations(p_brand_id, v_since, v_until) c
  ),
  -- Prompts pointing to the page: an active prompt's target URL.
  targeted as (
    select lower(public.normalize_page_path(ptu.url)) as page_key,
           count(distinct ptu.prompt_id)::bigint as prompts
    from public.prompt_target_urls ptu
    join public.prompts p on p.id = ptu.prompt_id and p.is_active
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
    group by 1
  ),
  -- Pages that answered 404 or 410 to AI visitors (AT-012): Broken AI links.
  broken as (
    select bp.page_key from public.ai_traffic_broken_pages(p_brand_id, p_from, p_to) bp
  ),
  in_sitemap as (
    select distinct lower(public.normalize_page_path(sp.url)) as page_key,
           public.normalize_page_path(sp.url) as page
    from public.site_pages sp
    where sp.brand_id = p_brand_id
      and 'sitemap' = any(sp.sources)
  ),
  keys as (
    select page_key, page from ai
    union select page_key, page from traffic
    union select page_key, page from cited
    union select page_key, page from in_sitemap
  ),
  pages as (
    select
      k.page_key,
      min(k.page) as page,
      coalesce(max(ai.visits), 0) as ai_visits,
      coalesce(max(ke.key_events), 0) as ai_key_events,
      coalesce(max(pl.platforms), '{}'::text[]) as ai_platforms,
      coalesce(max(c.citations), 0) as citations,
      coalesce(max(t.prompts), 0) as targeting_prompts,
      coalesce(max(tr.sessions), 0) as sessions,
      coalesce(max(tr.engaged_sessions), 0) as engaged_sessions,
      coalesce(max(tr.key_events), 0) as key_events,
      coalesce(max(tr.transactions), 0) as transactions,
      coalesce(max(tr.revenue), 0) as revenue,
      coalesce(max(tr.engagement_seconds), 0) as engagement_seconds,
      bool_or(s.page_key is not null) as in_sitemap,
      bool_or(br.page_key is not null) as broken
    from keys k
    left join ai on ai.page_key = k.page_key
    left join ai_key_events ke on ke.page_key = k.page_key
    left join platforms pl on pl.page_key = k.page_key
    left join cited c on c.page_key = k.page_key
    left join targeted t on t.page_key = k.page_key
    left join traffic tr on tr.page_key = k.page_key
    left join in_sitemap s on s.page_key = k.page_key
    left join broken br on br.page_key = k.page_key
    group by k.page_key
  ),
  kept as (
    select p.*,
      -- The page's place on the site by value, among pages with traffic.
      case when p.sessions > 0 then
        rank() over (
          partition by (p.sessions > 0)
          order by p.revenue desc, p.key_events desc, p.sessions desc, p.engagement_seconds desc
        )
      end as value_rank,
      p.ai_visits = 0 and (p.sessions > 0 or p.in_sitemap) as no_ai_traffic,
      p.citations >= 20 and p.ai_visits = 0 as cited_not_clicked,
      -- A missing page needs a redirect, not prompts (AT-012).
      p.ai_visits > 0 and p.citations = 0 and not p.broken as traffic_no_prompt
    from pages p
    where p.page not in ('', '(not set)', '(other)')
      -- The nightly detection's excluded segments (pagePaths.js).
      and not exists (
        select 1
        from unnest(string_to_array(lower(p.page), '/')) seg
        where seg = any (array[
          'checkout', 'cart', 'basket', 'order', 'orders', 'order-confirmation',
          'confirmation', 'thank-you', 'thanks', 'payment', 'pay', 'login', 'signin',
          'sign-in', 'signup', 'sign-up', 'register', 'logout', 'account', 'my-account',
          'profile', 'dashboard', 'admin', 'wishlist', 'favorites', 'search', 'career',
          'careers', 'jobs', 'job', 'cookie-policy', 'privacy', 'privacy-policy', 'terms',
          'terms-of-service', 'legal', 'unsubscribe'
        ])
      )
  ),
  tab as (
    select * from kept
    where case p_tab
      when 'no_ai_traffic' then no_ai_traffic
      when 'cited_not_clicked' then cited_not_clicked
      when 'traffic_no_prompt' then traffic_no_prompt
      else true
    end
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'no_ai_traffic', count(*) filter (where no_ai_traffic),
        'cited_not_clicked', count(*) filter (where cited_not_clicked),
        'traffic_no_prompt', count(*) filter (where traffic_no_prompt),
        -- The Broken AI links tab's count, so the card needn't read that list for it.
        'broken_ai_links', (select count(*) from broken)
      )
      from kept
    ),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) - 'page_key' - 'no_ai_traffic' - 'cited_not_clicked' - 'traffic_no_prompt')
      from (
        select * from tab
        order by
          -- Each list in the order it's worked through.
          case when p_tab = 'no_ai_traffic' then revenue end desc nulls last,
          case when p_tab = 'no_ai_traffic' then key_events end desc nulls last,
          case when p_tab = 'no_ai_traffic' then sessions end desc nulls last,
          case when p_tab = 'no_ai_traffic' then engagement_seconds end desc nulls last,
          case when p_tab = 'cited_not_clicked' then citations end desc nulls last,
          ai_visits desc, citations desc, sessions desc, page
        limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── ai_bot_report (00190) ──────────────────────────────────────────────────
-- AI Traffic "AI bots reading your site".

create or replace function public.ai_bot_report(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_first date;
  v_last_day date;
  v_last timestamptz;
  v_since date;
  v_alert text;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  select d.day into v_first
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id
  order by d.day
  limit 1;
  select d.day into v_last_day
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id
  order by d.day desc
  limit 1;
  select max(d.last_seen) into v_last
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id and d.day = v_last_day;

  v_since := coalesce(p_since, current_date - 89);

  v_alert := case
    when v_first is null or v_first > current_date - 29 then 'waiting'
    when not exists (
      select 1 from public.ai_bot_connections c
      where c.brand_id = p_brand_id
        and c.revoked_at is null
        and c.last_event_at >= now() - interval '2 days'
    ) or exists (
      select 1 from public.ai_bot_daily d
      where d.brand_id = p_brand_id
        and d.bot_type = 'search'
        and d.page = '(other)'
        and d.day >= current_date - 29
    ) then 'stale'
    -- The whole 30 days, not only their ends: the longest run of days
    -- without rows (one probe per day, then gaps and islands) is at most 7.
    when (
      select coalesce(max(r.days), 0)
      from (
        select count(*) as days
        from (
          select n, n - row_number() over (order by n) as run
          from generate_series(0, 29) n
          where not exists (
            select 1 from public.ai_bot_daily d
            where d.brand_id = p_brand_id and d.day = current_date - n
          )
        ) empty
        group by empty.run
      ) r
    ) > 7 then 'stale'
    else 'on'
  end;

  with g as (
    -- Each bot's hits on each page in the range, added up once.
    select
      d.bot_type,
      d.bot,
      d.page,
      sum(d.hits)::bigint as hits,
      max(d.last_seen) as last_seen
    from public.ai_bot_daily d
    where d.brand_id = p_brand_id
      and d.day >= v_since
      and d.day <= p_until
    group by d.bot_type, d.bot, d.page
  ),
  types as (
    select
      g.bot_type,
      sum(g.hits)::bigint as hits,
      count(distinct g.page) filter (where g.page <> '(other)')::bigint as pages,
      max(g.last_seen) as last_seen,
      array_agg(distinct g.bot order by g.bot) as bots
    from g
    group by g.bot_type
  ),
  bots as (
    select
      g.bot,
      min(g.bot_type) as bot_type,
      sum(g.hits)::bigint as hits,
      count(*) filter (where g.page <> '(other)')::bigint as pages,
      max(g.last_seen) as last_seen
    from g
    group by g.bot
  ),
  -- Hits folded past the month's cap ('(other)') aren't a page.
  pages as (
    select
      g.page,
      sum(g.hits)::bigint as hits,
      max(g.last_seen) filter (where g.bot_type = 'training') as training_last,
      max(g.last_seen) filter (where g.bot_type = 'search') as search_last,
      max(g.last_seen) filter (where g.bot_type = 'user') as user_last
    from g
    where g.page <> '(other)'
    group by g.page
  ),
  -- The alert reads its own 30 days, whatever the range.
  uncrawled as (
    select c.page, c.citations
    from public.ai_traffic_page_citations(p_brand_id, current_date - 29, current_date) c
    where v_alert = 'on'
      and not exists (
        select 1 from public.ai_bot_daily d
        where d.brand_id = p_brand_id
          and d.bot_type = 'search'
          and d.page = c.page_key
          and d.day >= current_date - 29
      )
  )
  select jsonb_build_object(
    'first_day', v_first,
    'last_seen', v_last,
    'types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', t.bot_type, 'hits', t.hits, 'pages', t.pages,
          'last_seen', t.last_seen, 'bots', to_jsonb(t.bots)
        )
        order by array_position(array['training', 'search', 'user'], t.bot_type)
      )
      from types t
    ), '[]'::jsonb),
    'bots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bot', b.bot, 'type', b.bot_type, 'hits', b.hits, 'pages', b.pages,
          'last_seen', b.last_seen
        )
        order by b.hits desc, b.bot
      )
      from bots b
    ), '[]'::jsonb),
    'page_count', (select count(*) from pages),
    'pages', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.hits desc, p.page)
      from (select * from pages order by hits desc, page limit p_limit) p
    ), '[]'::jsonb),
    -- Null unless the bot data is whole (alert_state 'on').
    'uncrawled_count', case when v_alert = 'on' then (select count(*) from uncrawled) end,
    'uncrawled', case
      when v_alert = 'on' then coalesce((
        select jsonb_agg(to_jsonb(u) order by u.citations desc, u.page)
        from (select * from uncrawled order by citations desc, page limit 10) u
      ), '[]'::jsonb)
    end,
    'alert_state', v_alert,
    'alert_from', case when v_first is not null then v_first + 29 end,
    'since', v_since
  )
  into v_result;

  return v_result;
end;
$$;

-- ── ai_traffic_broken_links (00200) ────────────────────────────────────────
-- AI Traffic "Broken AI links".

create or replace function public.ai_traffic_broken_links(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_since date := (p_from at time zone 'utc')::date;
  v_until date := coalesce((p_to at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  with
  logs as (
    select
      lower(n.page) as page_key,
      n.page,
      coalesce(l.visit_of, l.id) as visit,
      l.created_at,
      coalesce(nullif(l.source_platform, ''), 'unknown') as platform
    from public.ai_traffic_logs l
    cross join lateral (select public.normalize_page_path(l.url) as page) n
    where l.brand_id = p_brand_id
      and l.created_at >= coalesce(p_from, '-infinity'::timestamptz)
      and (p_to is null or l.created_at <= p_to)
      -- Only the pageviews that found the page missing, not those from before it broke.
      and (
        l.http_status in (404, 410)
        or (l.not_found_title and (l.http_status is null or l.http_status between 200 and 299))
      )
  ),
  broken as (
    select bp.page_key, bp.status, bp.routed
    from public.ai_traffic_broken_pages(p_brand_id, p_from, p_to) bp
  ),
  visits as (
    select l.page_key, min(l.page) as page, count(distinct l.visit)::bigint as visits,
           max(l.created_at) as last_visit
    from logs l
    join broken b on b.page_key = l.page_key
    group by l.page_key
  ),
  platforms as (
    select page_key, (array_agg(platform order by visits desc, platform))[1:3] as platforms
    from (
      select l.page_key, l.platform, count(distinct l.visit) as visits
      from logs l
      join broken b on b.page_key = l.page_key
      group by 1, 2
    ) t
    group by 1
  ),
  cited as (
    select c.page_key, c.citations
    from public.ai_traffic_page_citations(p_brand_id, v_since, v_until) c
  ),
  -- Pages known to work, to redirect to. Only a page's own address counts:
  -- /product.php?id=5 answering 200 says nothing about /product.php.
  landed as (
    select lower(n.page) as page_key,
           min(n.page) as page,
           (array_agg(l.http_status order by l.created_at desc))[1] as last_status
    from public.ai_traffic_logs l
    cross join lateral (select public.normalize_page_path(l.url) as page) n
    where l.brand_id = p_brand_id
      and l.http_status is not null
      and l.created_at >= now() - interval '90 days'
      and (
        strpos(l.url, '?') = 0
        or not exists (
          select 1
          from unnest(string_to_array(split_part(split_part(l.url, '#', 1), '?', 2), '&')) as qp(part)
          where qp.part <> ''
            and qp.part !~* '^(utm_[^=]*|gclid|fbclid|msclkid|srsltid|_gl|ref)(=|$)'
        )
      )
    group by 1
  ),
  candidates as (
    select page_key, min(page) as page, max(weight) as weight
    from (
      select lower(public.normalize_page_path(sp.url)) as page_key,
             public.normalize_page_path(sp.url) as page,
             sp.ga_sessions as weight
      from public.site_pages sp
      where sp.brand_id = p_brand_id
        and sp.fetch_status between 200 and 299
      union all
      select page_key, page, 0 from landed where last_status between 200 and 299
    ) c
    where page_key not in (select page_key from broken)
    group by page_key
  ),
  candidate_words as (
    select distinct c.page_key, regexp_replace(w.word, '^(.{3,})s$', '\1') as word
    from candidates c
    cross join lateral regexp_split_to_table(c.page_key, '[^[:alnum:]]+') as w(word)
    where length(w.word) >= 2
  ),
  broken_words as (
    select distinct b.page_key, regexp_replace(w.word, '^(.{3,})s$', '\1') as word
    from broken b
    cross join lateral regexp_split_to_table(b.page_key, '[^[:alnum:]]+') as w(word)
    where length(w.word) >= 2
  ),
  candidate_sizes as (select page_key, count(*) as words from candidate_words group by 1),
  broken_sizes as (select page_key, count(*) as words from broken_words group by 1),
  similar_pages as (
    select distinct on (page_key) page_key, target
    from (
      select
        bw.page_key,
        c.page as target,
        c.weight,
        count(*)::numeric / (bs.words + cs.words - count(*)) as overlap
      from broken_words bw
      join candidate_words cw on cw.word = bw.word
      join candidates c on c.page_key = cw.page_key
      join broken_sizes bs on bs.page_key = bw.page_key
      join candidate_sizes cs on cs.page_key = cw.page_key
      group by bw.page_key, c.page_key, c.page, c.weight, bs.words, cs.words
    ) m
    where overlap >= 0.5
    order by page_key, overlap desc, weight desc, length(target), target
  ),
  parent_pages as (
    select distinct on (b.page_key) b.page_key, c.page as target
    from broken b
    join candidates c
      on c.page_key <> '/'
     and left(b.page_key, length(c.page_key) + 1) = c.page_key || '/'
    order by b.page_key, length(c.page_key) desc
  ),
  result_rows as (
    select
      v.page,
      v.visits,
      v.last_visit,
      b.status,
      coalesce(p.platforms, '{}'::text[]) as platforms,
      coalesce(ci.citations, 0)::bigint as citations,
      -- A route on the page (every missing address has a query) gets no
      -- redirect: one from its path would move the whole route.
      case when v.page_key <> '/' and not b.routed then coalesce(s.target, pa.target, '/') end
        as target,
      case
        when v.page_key = '/' then null
        when b.routed then 'query'
        when s.target is not null then 'similar'
        when pa.target is not null then 'parent'
        else 'home'
      end as target_reason
    from visits v
    join broken b on b.page_key = v.page_key
    left join platforms p on p.page_key = v.page_key
    left join cited ci on ci.page_key = v.page_key
    left join similar_pages s on s.page_key = v.page_key
    left join parent_pages pa on pa.page_key = v.page_key
  )
  select jsonb_build_object(
    'count', (select count(*) from result_rows),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r))
      from (
        select * from result_rows
        order by visits desc, citations desc, last_visit desc, page
        limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── brand_ai_conversions (00288) ───────────────────────────────────────────
-- The Content plan: the brand's conversions from AI journeys.

create or replace function public.brand_ai_conversions(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_last date := (now() at time zone 'utc')::date - 1;
  v_from timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
  end if;

  v_from := (v_last - p_days + 1)::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';

  with conversions as (
    select c.*
    from public.ai_traffic_events c
    where c.brand_id = p_brand_id
      and c.kind = 'conversion'
      and c.occurred_at >= v_from
      and c.occurred_at < v_until
  ),
  -- The latest 2,000's paths (the goals take all): the landing page, the
  -- latest 100 pageviews before the conversion, from a day before its first
  -- AI visit (first_at is clamped per event, within the server's clock
  -- allowance), the page it converted on; by the keys stored with each
  -- event (00286).
  paths as (
    select t.first_source, t.goal, t.occurred_at, (
      select array_agg(s.page order by s.ord <> 0, s.at, s.ord)
      from (
        select steps.page, steps.at, steps.ord,
          lag(steps.page) over (order by steps.ord <> 0, steps.at, steps.ord) as before
        from (
          select t.first_key as page, t.first_at as at, 0 as ord
          union all
          select p.page_key, p.occurred_at, 1
          from (
            select e.page_key, e.occurred_at
            from public.ai_traffic_events e
            where e.brand_id = p_brand_id
              and e.visitor_id = t.visitor_id
              and e.kind = 'page'
              and e.occurred_at >= t.first_at - interval '1 day'
              and e.occurred_at <= t.occurred_at
            order by e.occurred_at desc
            limit 100
          ) p
          union all
          select t.page_key, t.occurred_at, 2
        ) steps
      ) s
      where s.before is distinct from s.page
    ) as pages
    from (select * from conversions order by occurred_at desc limit 2000) t
  )
  select jsonb_build_object(
    'enabled', coalesce((select b.conversions_enabled from public.brands b where b.id = p_brand_id), false),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('goal', g.goal, 'count', g.n) order by g.n desc, g.goal)
      from (select goal, count(*)::bigint as n from conversions group by goal) g
    ), '[]'::jsonb),
    'journey', (
      select jsonb_build_object('source', j.first_source, 'pages', to_jsonb(j.pages),
        'goal', j.goal, 'count', j.n)
      from (
        select first_source, pages, goal, count(*)::bigint as n
        from paths
        group by first_source, pages, goal
        order by count(*) desc, max(occurred_at) desc, first_source, goal
        limit 1
      ) j
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ── content_page_impact (00209) ────────────────────────────────────────────
-- The Content Editor: one page's citations, AI visits and Google clicks.

create or replace function public.content_page_impact(
  p_brand_id uuid,
  p_page text,
  p_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_key text := lower(public.normalize_page_path(p_page));
  -- The last whole day.
  v_last_day date := (now() at time zone 'utc')::date - 1;
  v_cur_day date;
  v_prev_day date;
  v_cur timestamptz;
  v_prev timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 366 or p_page is null then
    raise exception 'content_page_impact: a page and 1 to 366 days are needed'
      using errcode = '22023';
  end if;

  v_cur_day := v_last_day - p_days + 1;
  v_prev_day := v_cur_day - p_days;
  v_cur := v_cur_day::timestamp at time zone 'utc';
  v_prev := v_prev_day::timestamp at time zone 'utc';
  v_until := (v_last_day + 1)::timestamp at time zone 'utc';

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_all as materialized (
    select cu.id, cu.url, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  own_urls as (
    select o.id from own_all o where o.page_key = v_key
  ),
  -- Both windows' answers, from the cover index alone.
  answers as materialized (
    select pr.id, pr.prompt_id, pr.platform, pr.created_at >= v_cur as is_cur
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.created_at >= v_prev
      and pr.created_at < v_until
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  cites as (
    select a.prompt_id, a.platform, a.is_cur
    from public.prompt_result_citations prc
    join answers a on a.id = prc.prompt_result_id
    where prc.url_id in (select u.id from own_urls u)
      and prc.brand_id = p_brand_id
      and prc.created_at >= v_prev
      and prc.created_at < v_until
  ),
  per_prompt as (
    select
      c.prompt_id,
      count(*) filter (where c.is_cur) as cur,
      count(*) filter (where not c.is_cur) as prev,
      coalesce(array_agg(distinct c.platform) filter (where c.is_cur), '{}') as cur_platforms,
      coalesce(array_agg(distinct c.platform) filter (where not c.is_cur), '{}') as prev_platforms
    from cites c
    group by c.prompt_id
  ),
  -- This window's answers to the prompts citing the page, then their
  -- citations, then the brand's other pages among them.
  citing_answers as materialized (
    select a.id, a.prompt_id
    from answers a
    where a.is_cur
      and a.prompt_id in (select pp.prompt_id from per_prompt pp where pp.cur > 0)
  ),
  other_pages as (
    select o.page_key, min(o.url) as page, count(distinct ca.prompt_id) as prompts
    from citing_answers ca
    join public.prompt_result_citations prc
      on prc.prompt_result_id = ca.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= v_cur
     and prc.created_at < v_until
    join own_all o on o.id = prc.url_id
    where o.page_key <> v_key
    group by o.page_key
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_prev
      and l.created_at < v_until
  ),
  visits as (
    select l.created_at >= v_cur as is_cur, 1::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_prev
      and l.created_at < v_until
      and lower(public.normalize_page_path(l.url)) = v_key
    union all
    select g.date >= v_cur_day, g.sessions::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      -- A session without a landing page would read as the home page.
      and g.landing_page <> ''
      and g.date >= v_prev_day
      and g.date <= v_last_day
      and lower(public.normalize_page_path(g.landing_page)) = v_key
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  clicks as (
    select g.date >= v_cur_day as is_cur, g.clicks::bigint as n
    from public.gsc_page_stats g
    where g.brand_id = p_brand_id
      and g.page_key = v_key
      and g.date >= v_prev_day
      and g.date <= v_last_day
  )
  select jsonb_build_object(
    'citations', (
      select jsonb_build_object('cur', coalesce(sum(cur), 0), 'prev', coalesce(sum(prev), 0))
      from per_prompt
    ),
    'promptCounts', (
      select jsonb_build_object(
        'cur', count(*) filter (where cur > 0),
        'prev', count(*) filter (where prev > 0),
        'lost', count(*) filter (where cur = 0 and prev > 0)
      )
      from per_prompt
    ),
    'aiVisits', (
      select jsonb_build_object(
        'cur', coalesce(sum(n) filter (where is_cur), 0),
        'prev', coalesce(sum(n) filter (where not is_cur), 0)
      )
      from visits
    ),
    'gscClicks', (
      select jsonb_build_object(
        'cur', coalesce(sum(n) filter (where is_cur), 0),
        'prev', coalesce(sum(n) filter (where not is_cur), 0)
      )
      from clicks
    ),
    'gscSince', (select min(g.date) from public.gsc_page_stats g where g.brand_id = p_brand_id),
    'overlap', coalesce((
      select jsonb_agg(jsonb_build_object('page', op.page, 'prompts', op.prompts)
        order by op.prompts desc, op.page)
      from (select * from other_pages order by prompts desc, page limit 3) op
    ), '[]'::jsonb),
    'prompts', coalesce((
      select jsonb_agg(row order by (row->>'cur')::int desc, (row->>'prev')::int desc, row->>'text')
      from (
        select jsonb_build_object(
          'id', pp.prompt_id,
          'text', p.text,
          'cur', pp.cur,
          'prev', pp.prev,
          'curPlatforms', to_jsonb(pp.cur_platforms),
          'prevPlatforms', to_jsonb(pp.prev_platforms)
        ) as row
        from per_prompt pp
        join public.prompts p on p.id = pp.prompt_id
        order by pp.cur desc, pp.prev desc
        limit 100
      ) t
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ── content_page_results (00210) ───────────────────────────────────────────
-- The Content Editor: one page's AI visits per source, with Analytics'
-- AI sessions.

create or replace function public.content_page_results(
  p_brand_id uuid,
  p_page text,
  p_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_key text := lower(public.normalize_page_path(p_page));
  -- The last whole day.
  v_last_day date := (now() at time zone 'utc')::date - 1;
  v_day date;
  v_from timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 366 or p_page is null then
    raise exception 'content_page_results: a page and 1 to 366 days are needed'
      using errcode = '22023';
  end if;

  v_day := v_last_day - p_days + 1;
  v_from := v_day::timestamp at time zone 'utc';
  v_until := (v_last_day + 1)::timestamp at time zone 'utc';

  with snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
  ),
  visits as (
    select coalesce(nullif(l.source_platform, ''), 'unknown') as platform, count(*)::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
      and lower(public.normalize_page_path(l.url)) = v_key
    group by 1
    union all
    select coalesce(g.platform, g.source), sum(g.sessions)::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      and g.landing_page <> ''
      and g.date >= v_day
      and g.date <= v_last_day
      and lower(public.normalize_page_path(g.landing_page)) = v_key
      and not exists (select 1 from snippet_days s where s.day = g.date)
    group by 1
  ),
  analytics as (
    select
      coalesce(g.platform, g.source) as platform,
      sum(g.sessions)::bigint as sessions,
      sum(g.key_events)::bigint as key_events,
      sum(g.key_event_sessions)::bigint as key_event_sessions,
      sum(g.transactions)::bigint as transactions,
      coalesce(sum(g.purchase_revenue), 0)::numeric as revenue
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.date >= v_day
      and g.date <= v_last_day
      and lower(public.normalize_page_path(g.landing_page)) = v_key
    group by 1
  ),
  sources as (
    select
      p.platform,
      coalesce(v.n, 0) as visits,
      coalesce(a.sessions, 0) as sessions,
      coalesce(a.key_events, 0) as key_events,
      coalesce(a.key_event_sessions, 0) as key_event_sessions,
      coalesce(a.transactions, 0) as transactions,
      coalesce(a.revenue, 0) as revenue
    from (select platform from visits union select platform from analytics) p
    left join (select platform, sum(n) as n from visits group by platform) v on v.platform = p.platform
    left join analytics a on a.platform = p.platform
  )
  select jsonb_build_object(
    'analytics', (
      select nullif(b.ga_property_id, '') is not null
      from public.brands b where b.id = p_brand_id
    ),
    'purchases', exists (
      select 1 from public.ga_ai_traffic_stats g
      where g.brand_id = p_brand_id
        and g.date >= v_day
        and g.date <= v_last_day
        and (g.transactions > 0 or g.purchase_revenue > 0)
    ) or exists (
      select 1 from public.ga_channel_stats c
      where c.brand_id = p_brand_id
        and c.date >= v_day
        and c.date <= v_last_day
        and (c.transactions > 0 or c.purchase_revenue > 0)
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
          'platform', s.platform,
          'visits', s.visits,
          'sessions', s.sessions,
          'keyEvents', s.key_events,
          'keyEventSessions', s.key_event_sessions,
          'transactions', s.transactions,
          'revenue', s.revenue
        ) order by s.visits desc, s.sessions desc, s.platform)
      from sources s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ── content_draft_cited_answers (00216) ────────────────────────────────────
-- The Content Editor's locked passages: the answers citing a draft's page.
-- The brand is the draft's.

create or replace function public.content_draft_cited_answers(
  p_draft_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_brand_id uuid;
  v_page_key text;
  v_host text;
  v_since timestamptz;
  v_result jsonb;
begin
  select d.brand_id, lower(public.normalize_page_path(d.source_url)),
    -- Lower-cased first: a scheme may be written HTTPS://.
    regexp_replace(substring(lower(d.source_url) from '^https?://([^/:?#]+)'), '^www\.', '')
    into v_brand_id, v_page_key, v_host
  from public.content_drafts d
  where d.id = p_draft_id;

  if v_brand_id is null or (
    not public.can_access_brand(v_brand_id)
    and auth.role() is distinct from 'service_role'
  ) then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'content_draft_cited_answers: 1 to 90 days are needed' using errcode = '22023';
  end if;
  -- No page, or a page on a site that isn't the brand's: nothing cites it.
  if v_page_key is null or v_host is null or not exists (
    select 1 from public.brand_domains bd
    where bd.brand_id = v_brand_id
      and lower(regexp_replace(bd.domain, '^www\.', '')) = v_host
  ) then
    return '[]'::jsonb;
  end if;

  v_since := now() - make_interval(days => p_days);

  with
  -- Each answer once, however many of its citations name the page.
  citing as (
    select distinct prc.prompt_result_id
    from public.citation_urls cu
    join public.prompt_result_citations prc
      on prc.url_id = cu.id
     and prc.brand_id = v_brand_id
     and prc.created_at >= v_since
    where cu.domain = v_host
      and lower(public.normalize_page_path(cu.url)) = v_page_key
  ),
  -- The latest 200 first; only their responses are read.
  latest as (
    select pr.id, pr.created_at
    from citing c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    where pr.platform is distinct from 'chatgpt-shopping'
      and pr.response <> ''
    order by pr.created_at desc
    limit 200
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('platform', pr.platform, 'response', left(pr.response, 12000))
      order by l.created_at desc
    ),
    '[]'::jsonb
  )
    into v_result
  from latest l
  join public.prompt_results pr on pr.id = l.id;

  return v_result;
end;
$$;

-- ── content_draft_sources (00226) ──────────────────────────────────────────
-- The Content Editor: a draft's sources. The brand is the draft's.

create or replace function public.content_draft_sources(
  p_draft_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_brand_id uuid;
  v_prompt_ids uuid[];
  v_page_key text;
  v_host text;
  v_since timestamptz;
  -- The window's first whole UTC day.
  v_first_day date;
  v_result jsonb;
begin
  select d.brand_id, d.prompt_ids, lower(public.normalize_page_path(d.source_url)),
    -- Lower-cased first: a scheme may be written HTTPS://.
    regexp_replace(substring(lower(d.source_url) from '^https?://([^/:?#]+)'), '^www\.', '')
    into v_brand_id, v_prompt_ids, v_page_key, v_host
  from public.content_drafts d
  where d.id = p_draft_id;

  if v_brand_id is null or (
    not public.can_access_brand(v_brand_id)
    and auth.role() is distinct from 'service_role'
  ) then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'content_draft_sources: 1 to 90 days are needed' using errcode = '22023';
  end if;

  v_since := now() - make_interval(days => p_days);
  v_first_day := (v_since at time zone 'utc')::date + 1;
  -- A page on a site that isn't the brand's is no page of the brand's.
  if v_host is null or not exists (
    select 1 from public.brand_domains bd
    where bd.brand_id = v_brand_id
      and lower(regexp_replace(bd.domain, '^www\.', '')) = v_host
  ) then
    v_page_key := null;
  end if;

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = v_brand_id
  ),
  -- The page's addresses: its path on its host.
  page_urls as materialized (
    select cu.id
    from public.citation_urls cu
    where v_page_key is not null
      and cu.domain = v_host
      and lower(public.normalize_page_path(cu.url)) = v_page_key
  ),
  -- The window's answers, from idx_prompt_results_brand_created_cover alone
  -- (an index-only scan). The prompts are picked after this read: a prompt
  -- filter here makes the planner combine the prompt_id index with the
  -- brand's and read every answer each prompt ever had.
  window_answers as materialized (
    select pr.id, pr.prompt_id, pr.created_at
    from public.prompt_results pr
    where (v_page_key is not null or coalesce(cardinality(v_prompt_ids), 0) > 0)
      and pr.brand_id = v_brand_id
      and pr.created_at >= v_since
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  -- The prompts whose answers cited the page the draft optimizes.
  page_prompts as (
    select distinct wa.prompt_id
    from public.prompt_result_citations prc
    join window_answers wa on wa.id = prc.prompt_result_id
    where prc.url_id in (select pu.id from page_urls pu)
      and prc.brand_id = v_brand_id
      and prc.created_at >= v_since
  ),
  source_prompts as (
    select p.id, p.text, p.id = any(v_prompt_ids) as in_draft,
      p.id in (select prompt_id from page_prompts) as cites_page
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = v_brand_id
      and (p.id = any(v_prompt_ids) or p.id in (select prompt_id from page_prompts))
  ),
  -- The source prompts' answers in the window, newest first per prompt.
  answers as materialized (
    select wa.id, wa.prompt_id, wa.created_at,
      row_number() over (partition by wa.prompt_id order by wa.created_at desc) as recency
    from window_answers wa
    where wa.prompt_id in (select sp.id from source_prompts sp)
  ),
  -- The answers naming the brand: the window's whole UTC days from the
  -- Mentions rollup (mentions_prompt_daily, 00157), and its first, partial
  -- day from those answers' rows. A run still in progress joins the rollup
  -- when it completes.
  named as (
    select m.prompt_id, m.mention_answers as answers
    from public.mentions_prompt_daily m
    where m.brand_id = v_brand_id
      and m.day >= v_first_day
      and m.prompt_id in (select sp.id from source_prompts sp)
    union all
    select a.prompt_id, 1
    from answers a
    join public.prompt_results pr on pr.id = a.id
    where a.created_at < v_first_day::timestamp at time zone 'utc'
      and pr.mention_count > 0
  ),
  prompt_counts as (
    select a.prompt_id, a.answers, coalesce(n.mentioned, 0) as mentioned
    from (select prompt_id, count(*) as answers from answers group by prompt_id) a
    left join (
      select prompt_id, sum(answers) as mentioned from named group by prompt_id
    ) n on n.prompt_id = a.prompt_id
  ),
  -- The only answer rows read: each prompt's latest 30.
  sampled as (
    select pr.id, pr.platform, pr.search_queries
    from answers a
    join public.prompt_results pr on pr.id = a.id
    where a.recency <= 30
  ),
  fanout_rows as (
    select
      a.id as answer_id,
      lower(trim(regexp_replace(q.item->>'query', '\s+', ' ', 'g'))) as norm,
      trim(regexp_replace(q.item->>'query', '\s+', ' ', 'g')) as query,
      coalesce(nullif(q.item->>'source_platform', ''), a.platform) as platform
    from sampled a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.search_queries) = 'array' then a.search_queries else '[]'::jsonb end
    ) as q(item)
    where coalesce(trim(q.item->>'query'), '') <> ''
  ),
  fanouts as (
    select min(query) as query, array_agg(distinct platform order by platform) as platforms,
      count(distinct answer_id) as searched
    from fanout_rows
    group by norm
    order by count(distinct answer_id) desc, min(query)
    limit 30
  ),
  -- The citations of the same sample as the fan-outs, each prompt's latest
  -- 30 answers: every answer in the window is 100k+ citations on a large
  -- brand, read one answer at a time. Grouped by address first; only the
  -- top 20 addresses are read.
  cited_ids as (
    select prc.url_id, count(*) as citations, count(distinct prc.prompt_result_id) as answers
    from answers a
    join public.prompt_result_citations prc
      on prc.prompt_result_id = a.id
     and prc.brand_id = v_brand_id
     and prc.created_at >= v_since
    where a.recency <= 30
    group by prc.url_id
    order by count(*) desc, count(distinct prc.prompt_result_id) desc, prc.url_id
    limit 20
  ),
  cited as (
    select cu.url, cu.title, cu.domain, ci.citations, ci.answers
    from cited_ids ci
    join public.citation_urls cu on cu.id = ci.url_id
  ),
  queries as (
    select g.query, sum(g.clicks)::bigint as clicks, sum(g.impressions)::bigint as impressions
    from public.gsc_query_stats g
    where g.brand_id = v_brand_id
      and g.date >= (now() at time zone 'utc')::date - 28
    group by g.query
    order by sum(g.clicks) desc, sum(g.impressions) desc, g.query
    limit 300
  )
  select jsonb_build_object(
    'prompts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', sp.id,
          'text', sp.text,
          'inDraft', sp.in_draft,
          'citesPage', sp.cites_page,
          'answers', coalesce(pc.answers, 0),
          'mentioned', coalesce(pc.mentioned, 0)
        ) order by sp.in_draft desc, sp.text)
      from source_prompts sp
      left join prompt_counts pc on pc.prompt_id = sp.id
    ), '[]'::jsonb),
    'fanouts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'query', f.query, 'platforms', to_jsonb(f.platforms), 'searched', f.searched
        ) order by f.searched desc, f.query)
      from fanouts f
    ), '[]'::jsonb),
    'citedPages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'url', c.url, 'title', c.title, 'domain', c.domain,
          'citations', c.citations, 'answers', c.answers
        ) order by c.citations desc, c.answers desc, c.url)
      from cited c
    ), '[]'::jsonb),
    'gscQueries', coalesce((
      select jsonb_agg(jsonb_build_object(
          'query', q.query, 'clicks', q.clicks, 'impressions', q.impressions
        ) order by q.clicks desc, q.impressions desc, q.query)
      from queries q
    ), '[]'::jsonb),
    'brandDomains', coalesce((select jsonb_agg(domain order by domain) from own_domains), '[]'::jsonb),
    'competitorDomains', coalesce((
      select jsonb_agg(distinct lower(regexp_replace(c.domain, '^www\.', '')))
      from public.competitors c
      where c.brand_id = v_brand_id and coalesce(c.domain, '') <> ''
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ── content_page_overlap (00226) ───────────────────────────────────────────
-- The Content Editor's Start: the brand's own pages cited for the same
-- prompts.

create or replace function public.content_page_overlap(
  p_brand_id uuid,
  p_prompt_ids uuid[],
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  page text,
  title text,
  prompts_in_common integer,
  citations bigint,
  gsc_position numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return;
  end if;
  if coalesce(cardinality(p_prompt_ids), 0) = 0 then
    return;
  end if;

  return query
  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as materialized (
    select cu.id, cu.url, cu.title, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  -- The window's answers, from the (brand_id, created_at) cover index
  -- alone. The prompts are picked in `cited`: a prompt filter here makes the
  -- planner combine the prompt_id index with the brand's and read the heap.
  answers as materialized (
    select pr.id, pr.prompt_id
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.created_at >= p_since
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  cited as (
    select ou.page_key, ou.url, ou.title, a.prompt_id
    from public.prompt_result_citations prc
    join answers a on a.id = prc.prompt_result_id
    join own_urls ou on ou.id = prc.url_id
    where prc.brand_id = p_brand_id
      and prc.created_at >= p_since
      and a.prompt_id = any(p_prompt_ids)
  ),
  pages as (
    select
      c.page_key,
      -- The address cited most often stands for the page.
      mode() within group (order by c.url) as page,
      max(c.title) as title,
      count(distinct c.prompt_id)::integer as prompts_in_common,
      count(*)::bigint as citations
    from cited c
    group by c.page_key
  ),
  google as (
    select
      g.page_key,
      round((sum(g.position * g.impressions) / nullif(sum(g.impressions), 0))::numeric, 1)
        as position
    from public.gsc_page_stats g
    where g.brand_id = p_brand_id
      and g.date >= (now() at time zone 'utc')::date - 28
      and g.page_key in (select p.page_key from pages p)
    group by g.page_key
  )
  select p.page, p.title, p.prompts_in_common, p.citations, gl.position
  from pages p
  left join google gl on gl.page_key = p.page_key
  order by p.prompts_in_common desc, p.citations desc, p.page
  limit 10;
end;
$$;

-- ── content_plan_insights (00226) ──────────────────────────────────────────
-- The Content plan: the addresses AI answers cite, and what AI visitors
-- did on the site.

create or replace function public.content_plan_insights(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
-- A cached generic plan can't see the brand's size (00207).
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  -- Whole days to yesterday, as the Plan's pages (00220).
  v_last date := (now() at time zone 'utc')::date - 1;
  v_day date;
  v_from timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
  end if;

  v_day := v_last - p_days + 1;
  v_from := v_day::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  -- The brand's own addresses, through citation_urls' domain index, as
  -- content_plan_pages' own_urls (00220).
  own_ids as materialized (
    select cu.id
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  cited as materialized (
    select d.url_id, sum(d.citations)::bigint as citations
    from public.citation_url_daily d
    where d.brand_id = p_brand_id
      and d.day >= v_day
      and d.day <= v_last
      and d.platform is distinct from 'chatgpt-shopping'
    group by d.url_id
  ),
  chosen as (
    (
      select c.url_id, c.citations, true as own
      from cited c
      where exists (select 1 from own_ids o where o.id = c.url_id)
      order by c.citations desc, c.url_id
      limit 5000
    )
    union all
    (
      select c.url_id, c.citations, false
      from cited c
      where not exists (select 1 from own_ids o where o.id = c.url_id)
      order by c.citations desc, c.url_id
      limit 1000
    )
  ),
  top_urls as (
    select ch.url_id, ch.citations, ch.own, cu.url, cu.title
    from chosen ch
    join public.citation_urls cu on cu.id = ch.url_id
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
  ),
  visits as (
    select count(*)::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
    union all
    select coalesce(sum(g.sessions), 0)::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      and g.date >= v_day
      and g.date <= v_last
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  analytics as (
    select
      coalesce(sum(g.key_events), 0)::bigint as key_events,
      coalesce(sum(g.transactions), 0)::bigint as transactions,
      coalesce(sum(g.purchase_revenue), 0)::numeric as revenue
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.date >= v_day
      and g.date <= v_last
  )
  select jsonb_build_object(
    'days', p_days,
    'totalCitations', (select coalesce(sum(c.citations), 0) from cited c),
    'citations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'url', t.url,
          'title', t.title,
          'own', t.own,
          'citations', t.citations
        )
        order by t.citations desc, t.url
      )
      from top_urls t
    ), '[]'::jsonb),
    'results', (
      select jsonb_build_object(
        'visits', (select coalesce(sum(v.n), 0) from visits v),
        'keyEvents', a.key_events,
        'transactions', a.transactions,
        'revenue', a.revenue,
        'analytics', (
          select nullif(b.ga_property_id, '') is not null
          from public.brands b where b.id = p_brand_id
        ),
        'purchases', a.transactions > 0 or a.revenue > 0 or exists (
          select 1 from public.ga_channel_stats c
          where c.brand_id = p_brand_id
            and c.date >= v_day
            and c.date <= v_last
            and (c.transactions > 0 or c.purchase_revenue > 0)
        )
      )
      from analytics a
    )
  )
  into v_result;

  return v_result;
end;
$$;

-- ── content_start_prompts (00230) ──────────────────────────────────────────
-- New content: the brand's active prompts, seen in answers or not.

create or replace function public.content_start_prompts(
  p_brand_id uuid,
  p_days     integer default 30,
  p_limit    integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
    and not public.can_access_brand(p_brand_id) then
    return null;
  end if;

  with seen as (
    select distinct d.prompt_id
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and d.day > current_date - v_days
      and (d.has_mention or d.has_citation)
  ),
  active as (
    select p.id, p.text, (s.prompt_id is not null) as seen
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    left join seen s on s.prompt_id = p.id
    where ps.brand_id = p_brand_id
      and p.is_active
  ),
  listed as (
    select a.id, a.text, a.seen
    from active a
    order by a.seen, a.text
    limit v_limit
  )
  select jsonb_build_object(
           'prompts', coalesce(
             (select jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text, 'seen', l.seen)
                               order by l.seen, l.text)
              from listed l),
             '[]'::jsonb),
           'seen', (select count(*) from active a where a.seen))
  into v_result;

  return v_result;
end;
$$;

-- ── content_page_conversions (00287) ───────────────────────────────────────
-- The Content Editor: conversions of AI journeys through one page.

create or replace function public.content_page_conversions(
  p_brand_id uuid,
  p_page text,
  p_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_key text := lower(public.normalize_page_path(p_page));
  -- The last whole day.
  v_last_day date := (now() at time zone 'utc')::date - 1;
  v_from timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 366 or p_page is null then
    raise exception 'content_page_conversions: a page and 1 to 366 days are needed'
      using errcode = '22023';
  end if;

  v_from := (v_last_day - p_days + 1)::timestamp at time zone 'utc';
  v_until := (v_last_day + 1)::timestamp at time zone 'utc';

  with conversions as (
    select c.*
    from public.ai_traffic_events c
    where c.brand_id = p_brand_id
      and c.kind = 'conversion'
      and c.occurred_at >= v_from
      and c.occurred_at < v_until
  ),
  -- When each visitor id first saw the page in its journey: read once per
  -- visitor id however many conversions it has, from a day before its first
  -- AI visit (first_at is clamped per event, within the server's clock
  -- allowance) to its last conversion, by the stored keys.
  seen as (
    select v.visitor_id, (
      select min(e.occurred_at)
      from public.ai_traffic_events e
      where e.brand_id = p_brand_id
        and e.visitor_id = v.visitor_id
        and e.kind = 'page'
        and e.page_key = v_key
        and e.occurred_at >= v.since
        and e.occurred_at <= v.last_at
    ) as at
    from (
      select visitor_id, min(first_at) - interval '1 day' as since, max(occurred_at) as last_at
      from conversions
      group by visitor_id
    ) v
  ),
  -- A conversion whose journey landed on the page, went through it, or converted on it.
  through as (
    select c.*
    from conversions c
    left join seen s on s.visitor_id = c.visitor_id
    where c.first_key = v_key
      or c.page_key = v_key
      or (s.at is not null and s.at <= c.occurred_at and s.at >= c.first_at - interval '1 day')
  ),
  -- The paths of the latest 2,000 (the counts above take all): the landing
  -- page, the latest 100 pageviews before the conversion, the page it
  -- converted on.
  paths as (
    select t.first_source, t.goal, t.occurred_at, (
      select array_agg(s.page order by s.ord <> 0, s.at, s.ord)
      from (
        select steps.page, steps.at, steps.ord,
          lag(steps.page) over (order by steps.ord <> 0, steps.at, steps.ord) as before
        from (
          select t.first_key as page, t.first_at as at, 0 as ord
          union all
          select p.page_key, p.occurred_at, 1
          from (
            select e.page_key, e.occurred_at
            from public.ai_traffic_events e
            where e.brand_id = p_brand_id
              and e.visitor_id = t.visitor_id
              and e.kind = 'page'
              and e.occurred_at >= t.first_at - interval '1 day'
              and e.occurred_at <= t.occurred_at
            order by e.occurred_at desc
            limit 100
          ) p
          union all
          select t.page_key, t.occurred_at, 2
        ) steps
      ) s
      where s.before is distinct from s.page
    ) as pages
    from (select * from through order by occurred_at desc limit 2000) t
  )
  select jsonb_build_object(
    'page', v_key,
    'enabled', coalesce((select b.conversions_enabled from public.brands b where b.id = p_brand_id), false),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('goal', g.goal, 'count', g.n, 'units', g.units)
        order by g.n desc, g.goal)
      from (
        select goal, count(*)::bigint as n, coalesce(sum(units), 0)::bigint as units
        from through group by goal
      ) g
    ), '[]'::jsonb),
    'revenue', coalesce((
      select jsonb_agg(jsonb_build_object('currency', r.currency, 'value', r.value)
        order by r.value desc, r.currency)
      from (
        select currency, sum(value)::numeric as value
        from through
        where goal in ('order', 'booking') and value is not null and currency is not null
        group by currency
      ) r
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('platform', s.first_source, 'conversions', s.n)
        order by s.n desc, s.first_source)
      from (select first_source, count(*)::bigint as n from through group by first_source) s
    ), '[]'::jsonb),
    'journeys', coalesce((
      select jsonb_agg(jsonb_build_object('source', j.first_source, 'pages', to_jsonb(j.pages),
          'goal', j.goal, 'count', j.n)
        order by j.n desc, j.latest desc, j.first_source, j.goal)
      from (
        select first_source, pages, goal, count(*)::bigint as n, max(occurred_at) as latest
        from paths
        group by first_source, pages, goal
        order by count(*) desc, max(occurred_at) desc, first_source, goal
        limit 5
      ) j
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ── content_plan_pages (00291) ─────────────────────────────────────────────
-- The Content plan: the brand's most cited pages.

create or replace function public.content_plan_pages(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
-- A cached generic plan can't see the brand's size (00207).
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_last date := (now() at time zone 'utc')::date - 1;
  v_cur_day date;
  v_prev_day date;
  v_cur timestamptz;
  v_until timestamptz;
  v_conversions_on boolean;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
  end if;

  v_cur_day := v_last - p_days + 1;
  v_prev_day := v_cur_day - p_days;
  v_cur := v_cur_day::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';
  v_conversions_on := coalesce(
    (select b.conversions_enabled from public.brands b where b.id = p_brand_id), false);

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as materialized (
    select cu.id, cu.url, cu.title, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  url_counts as materialized (
    select d.url_id, d.platform, d.day >= v_cur_day as is_cur, sum(d.citations)::bigint as n
    from public.citation_url_daily d
    where d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day <= v_last
      and d.url_id in (select id from own_urls)
      and d.platform is distinct from 'chatgpt-shopping'
    group by d.url_id, d.platform, d.day >= v_cur_day
  ),
  url_totals as (
    select
      u.page_key,
      u.url,
      u.title,
      coalesce(sum(c.n) filter (where c.is_cur), 0) as cur,
      coalesce(sum(c.n) filter (where not c.is_cur), 0) as prev
    from url_counts c
    join own_urls u on u.id = c.url_id
    group by u.page_key, u.url, u.title
  ),
  pages as materialized (
    select
      t.page_key,
      -- The address cited most often stands for the page.
      (array_agg(t.url order by t.cur + t.prev desc, t.url))[1] as page,
      max(t.title) as title,
      sum(t.cur)::bigint as cur,
      sum(t.prev)::bigint as prev
    from url_totals t
    group by t.page_key
    order by sum(t.cur + t.prev) desc, t.page_key
    limit 100
  ),
  answers as (
    select
      r.platform,
      coalesce(sum(r.answers) filter (where r.day >= v_cur_day), 0)::bigint as cur,
      coalesce(sum(r.answers) filter (where r.day < v_cur_day), 0)::bigint as prev
    from public.citation_result_daily r
    where r.brand_id = p_brand_id
      and r.day >= v_prev_day
      and r.day <= v_last
      and r.platform is distinct from 'chatgpt-shopping'
    group by r.platform
  ),
  per_platform as (
    select
      u.page_key,
      c.platform,
      coalesce(sum(c.n) filter (where c.is_cur), 0) as cur,
      coalesce(sum(c.n) filter (where not c.is_cur), 0) as prev
    from url_counts c
    join own_urls u on u.id = c.url_id
    where u.page_key in (select p.page_key from pages p)
      and c.platform is not null
    group by u.page_key, c.platform
  ),
  down as (
    -- A platform tracked in both windows, citing the page at a lower rate.
    select
      pp.page_key,
      array_agg(
        pp.platform
        order by pp.prev::numeric / a.prev - pp.cur::numeric / a.cur desc, pp.platform
      ) as platforms
    from per_platform pp
    join answers a on a.platform = pp.platform
    where a.prev > 0
      and a.cur > 0
      and pp.prev::numeric / a.prev > pp.cur::numeric / a.cur
    group by pp.page_key
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_cur
      and l.created_at < v_until
  ),
  visits as (
    select lower(public.normalize_page_path(l.url)) as page_key, 1::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_cur
      and l.created_at < v_until
    union all
    select lower(public.normalize_page_path(g.landing_page)), g.sessions::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      -- A session without a landing page would read as the home page.
      and g.landing_page <> ''
      and g.date >= v_cur_day
      and g.date <= v_last
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  page_visits as (
    select v.page_key, sum(v.n) as visits
    from visits v
    where v.page_key in (select p.page_key from pages p)
    group by v.page_key
  ),
  -- Conversions from AI journeys in the window, with conversions on (00286):
  -- the latest 2,000, as 00287 and 00288 bound their journeys, through 00287's
  -- partial index (brand_id, occurred_at desc), so the read stops there. The
  -- score counts 20 in full; past 2,000, a page's count is of the latest.
  conversions as materialized (
    select c.id, c.visitor_id, c.first_key, c.page_key, c.first_at, c.occurred_at
    from public.ai_traffic_events c
    where v_conversions_on
      and c.brand_id = p_brand_id
      and c.kind = 'conversion'
      and c.occurred_at >= v_cur
      and c.occurred_at < v_until
    order by c.occurred_at desc
    limit 2000
  ),
  -- When each visitor id first saw each listed page, from a day before its
  -- first AI visit to its last conversion: 00287's `seen`, for every listed
  -- page at once (the journey index), one row per visitor and page.
  seen as (
    select e.visitor_id, e.page_key, min(e.occurred_at) as at
    from (
      select visitor_id, min(first_at) - interval '1 day' as since, max(occurred_at) as last_at
      from conversions
      group by visitor_id
    ) v
    join public.ai_traffic_events e
      on e.brand_id = p_brand_id
     and e.visitor_id = v.visitor_id
     and e.kind = 'page'
     and e.occurred_at >= v.since
     and e.occurred_at <= v.last_at
    where e.page_key in (select p.page_key from pages p)
    group by e.visitor_id, e.page_key
  ),
  -- A conversion counts for each page its journey landed on, went through
  -- or converted on: the Live page tab's count (00287), once per page.
  touched as (
    select c.id, c.first_key as page_key from conversions c
    union
    select c.id, c.page_key from conversions c
    union
    select c.id, s.page_key
    from conversions c
    join seen s
      on s.visitor_id = c.visitor_id
     and s.at <= c.occurred_at
     and s.at >= c.first_at - interval '1 day'
  ),
  page_conversions as (
    select t.page_key, count(*)::bigint as n
    from touched t
    where t.page_key in (select p.page_key from pages p)
    group by t.page_key
  )
  select jsonb_build_object(
    'days', p_days,
    -- The earlier window's first day, and the brand's first tracked day: a
    -- window before it is only partly tracked, or not at all.
    'prevFrom', v_prev_day,
    'trackedSince', (
      select min(r.day) from public.citation_result_daily r where r.brand_id = p_brand_id
    ),
    'answers', (
      select jsonb_build_object(
        'cur', coalesce(sum(a.cur), 0),
        'prev', coalesce(sum(a.prev), 0)
      )
      from answers a
    ),
    'pages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'page', p.page,
          'title', p.title,
          'citations', jsonb_build_object('cur', p.cur, 'prev', p.prev),
          'platformsDown', coalesce(to_jsonb(d.platforms[1:3]), '[]'::jsonb),
          'aiVisits', coalesce(pv.visits, 0),
          -- Null with conversions off: unknown, never zero.
          'conversions', case when v_conversions_on then coalesce(pc.n, 0) end
        )
        order by p.cur + p.prev desc, p.page
      )
      from pages p
      left join down d on d.page_key = p.page_key
      left join page_visits pv on pv.page_key = p.page_key
      left join page_conversions pc on pc.page_key = p.page_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ── shopping_amazon_share_weekly (00225) ───────────────────────────────────
-- Shopping: the share of the brand's own-product cards that send
-- shoppers to Amazon, week by week.

create or replace function public.shopping_amazon_share_weekly(
  p_brand_id uuid,
  p_as_of timestamptz default now()
)
returns table (
  week_start date,
  amazon_cards bigint,
  classified_cards bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if auth.role() is distinct from 'service_role'
    and not public.can_access_brand(p_brand_id) then
    return;
  end if;

  return query
  with weeks as (
    select
      g.i,
      p_as_of - (g.i + 1) * interval '7 days' as from_ts,
      p_as_of - g.i * interval '7 days' as to_ts
    from generate_series(0, 4) as g(i)
  )
  select
    (w.from_ts at time zone 'UTC')::date as week_start,
    count(c.id) filter (where c.marketplace = 'amazon') as amazon_cards,
    count(c.id) as classified_cards
  from weeks w
  left join public.prompt_result_shopping_cards c
    on c.brand_id = p_brand_id
   and c.matched_brand_role = 'own'
   and c.merchant_kind is not null
   and c.created_at >= w.from_ts
   and c.created_at < w.to_ts
  group by w.i, w.from_ts
  order by w.from_ts;
end;
$$;

-- ── shopping_merchant_split (00268) ────────────────────────────────────────
-- Shopping: the brand's own-product cards per destination.

create or replace function public.shopping_merchant_split(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_platforms text[] default null,
  p_regions text[] default null,
  p_chatgpt_regions text[] default null
)
returns table (
  own_store_cards bigint,
  amazon_cards bigint,
  walmart_cards bigint,
  ebay_cards bigint,
  other_marketplace_cards bigint,
  reseller_cards bigint,
  unclassified_cards bigint
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
  select
    count(*) filter (where c.merchant_kind = 'own'),
    count(*) filter (where c.merchant_kind = 'marketplace' and c.marketplace = 'amazon'),
    count(*) filter (where c.merchant_kind = 'marketplace' and c.marketplace = 'walmart'),
    count(*) filter (where c.merchant_kind = 'marketplace' and c.marketplace = 'ebay'),
    count(*) filter (where c.merchant_kind = 'marketplace'
                       and coalesce(c.marketplace, '') not in ('amazon', 'walmart', 'ebay')),
    count(*) filter (where c.merchant_kind = 'reseller'),
    count(*) filter (where c.merchant_kind is null)
  from public.prompt_result_shopping_cards c
  where c.brand_id = p_brand_id
    and c.matched_brand_role = 'own'
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at <= p_to)
    and (p_platforms is null or c.platform = any (p_platforms))
    and (p_regions is null or c.region = any (p_regions))
    and (p_chatgpt_regions is null or c.platform <> 'chatgpt-shopping'
         or c.region = any (p_chatgpt_regions));
end;
$$;

-- ── shopping_own_product_offers (00268) ────────────────────────────────────
-- Shopping: the lowest price per merchant, for the reseller price alert.

create or replace function public.shopping_own_product_offers(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_platforms text[] default null,
  p_regions text[] default null,
  p_chatgpt_regions text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if auth.role() is distinct from 'service_role'
    and not public.can_access_brand(p_brand_id) then
    return '[]'::jsonb;
  end if;

  return (
    with offers as (
      select
        c.merchant_kind,
        c.marketplace,
        c.merchant_domain,
        c.listing_id,
        min(c.product_title) as product_title,
        upper(btrim(c.price_currency)) as price_currency,
        min(c.price_amount) as price_amount,
        (array_agg(c.merchant_url order by c.price_amount, c.created_at desc))[1] as merchant_url
      from public.prompt_result_shopping_cards c
      where c.brand_id = p_brand_id
        and c.matched_brand_role = 'own'
        and c.merchant_kind is not null
        and c.merchant_url is not null
        and c.price_amount > 0
        and nullif(btrim(c.price_currency), '') is not null
        and (p_from is null or c.created_at >= p_from)
        and (p_to is null or c.created_at <= p_to)
        and (p_platforms is null or c.platform = any (p_platforms))
        and (p_regions is null or c.region = any (p_regions))
        and (p_chatgpt_regions is null or c.platform <> 'chatgpt-shopping'
             or c.region = any (p_chatgpt_regions))
      group by
        c.merchant_kind,
        c.marketplace,
        c.merchant_domain,
        c.listing_id,
        lower(btrim(c.product_title)),
        upper(btrim(c.price_currency))
    )
    -- Without both a store offer and another merchant's there is nothing to
    -- compare: return an empty list rather than every store offer.
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'merchant_kind',   o.merchant_kind,
        'marketplace',     o.marketplace,
        'merchant_domain', o.merchant_domain,
        'merchant_url',    o.merchant_url,
        'listing_id',      o.listing_id,
        'product_title',   o.product_title,
        'price_amount',    o.price_amount,
        'price_currency',  o.price_currency)),
      '[]'::jsonb)
    from offers o
    where exists (select 1 from offers x where x.merchant_kind = 'own')
      and exists (select 1 from offers x where x.merchant_kind <> 'own')
  );
end;
$$;

-- ── catalog_product_ai_stats (00361) ───────────────────────────────────────
-- Product visibility: AI visits and orders per catalog product.

create or replace function public.catalog_product_ai_stats(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz default null,
  p_product_id uuid default null
)
returns table (
  product_id uuid,
  ai_visits bigint,
  orders bigint,
  revenue numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.role() is distinct from 'service_role'
    and not public.can_access_brand(p_brand_id) then
    return;
  end if;

  return query
  with pages as (
    select
      p.id as product_id,
      lower(public.normalize_page_path(coalesce(p.url, (
        select v.url
        from public.catalog_variants v
        where v.product_id = p.id and v.removed_at is null and v.url is not null
        order by v.external_id
        limit 1
      )))) as page
    from public.catalog_products p
    where p.brand_id = p_brand_id
      and p.removed_at is null
      and (p_product_id is null or p.id = p_product_id)
  ),
  keyed as (
    select pages.product_id, pages.page
    from pages
    where pages.page is not null and pages.page <> '/'
  ),
  visits as (
    select lower(public.normalize_page_path(l.url)) as page, count(*) as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.created_at >= p_from
      and (p_to is null or l.created_at < p_to)
      and l.visit_of is null
      and l.source_platform is not null
    group by 1
  ),
  sales as (
    select e.first_key as page, e.currency, count(*) as n, coalesce(sum(e.value), 0) as value
    from public.ai_traffic_events e
    where e.brand_id = p_brand_id
      and e.kind = 'conversion'
      and e.goal = 'order'
      and e.occurred_at >= p_from
      and (p_to is null or e.occurred_at < p_to)
    group by 1, 2
  ),
  -- A page's orders in its main currency: the one most of them are in.
  main_sales as (
    select distinct on (s.page) s.page, s.currency, s.value
    from sales s
    order by s.page, s.n desc, s.currency
  ),
  all_sales as (
    select s.page, sum(s.n) as n
    from sales s
    group by 1
  )
  select
    k.product_id,
    coalesce(v.n, 0)::bigint,
    coalesce(a.n, 0)::bigint,
    m.value,
    m.currency
  from keyed k
  left join visits v on v.page = k.page
  left join all_sales a on a.page = k.page
  left join main_sales m on m.page = k.page
  where v.n is not null or a.n is not null;
end;
$$;

-- ── seed_kpi_presets (00163) ───────────────────────────────────────────────
-- Action Center KPIs: the ready-made set, added by an admin or manager.

create or replace function public.seed_kpi_presets(p_brand_id uuid, p_kpis jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_setup   timestamptz;
begin
  select b.organization_id, b.kpi_setup_at
    into v_org, v_setup
  from public.brands b
  where b.id = p_brand_id
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = v_org
      and p.role = any (array['admin', 'manager']::public.user_role[])
      and public.can_access_brand(p_brand_id)
  ) then
    raise exception 'Only admins and managers can set up KPIs' using errcode = '42501';
  end if;

  if v_setup is not null
     or exists (select 1 from public.kpi_definitions d where d.brand_id = p_brand_id) then
    return false;
  end if;

  insert into public.kpi_definitions (brand_id, kpi_key, target, timeframe, is_active)
  select p_brand_id, k.value->>'key', (k.value->>'target')::numeric, 'monthly', true
  from jsonb_array_elements(coalesce(p_kpis, '[]'::jsonb)) k
  where coalesce(k.value->>'key', '') <> ''
    and (k.value->>'target')::numeric > 0
  on conflict (brand_id, kpi_key) do nothing;

  return found;
end;
$$;

-- ── override_mention_sentiment (00223) ─────────────────────────────────────
-- Mentions "Sentiment is wrong": an admin or manager corrects an
-- answer's sentiment.

create or replace function public.override_mention_sentiment(
  p_result_id uuid,
  p_sentiment text,
  p_note      text default null,
  p_user_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row      record;
  v_user     record;
  v_day      date;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_override public.sentiment_overrides;
  -- Who corrects: the API key's owner for the service role, else the caller.
  v_person   uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
begin
  if p_sentiment is null or p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'Invalid sentiment' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is longer than 500 characters' using errcode = '22023';
  end if;

  select pr.id, pr.brand_id, pr.sentiment, pr.mention_count, pr.created_at, b.organization_id
    into v_row
  from public.prompt_results pr
  join public.brands b on b.id = pr.brand_id
  where pr.id = p_result_id
  for update of pr;
  if not found then
    raise exception 'Answer not found' using errcode = 'P0002';
  end if;

  select p.id, p.full_name, p.role
    into v_user
  from public.profiles p
  where p.id = v_person
    and p.organization_id = v_row.organization_id
    and p.role = any (array['admin', 'manager']::public.user_role[])
    and public.can_access_brand(v_row.brand_id, p.id);
  if not found then
    raise exception 'Only admins and managers can correct a sentiment' using errcode = '42501';
  end if;

  -- Sentiment is only classified for answers that name the brand.
  if coalesce(v_row.mention_count, 0) <= 0 then
    raise exception 'This answer does not name the brand' using errcode = '22023';
  end if;

  if v_row.sentiment = p_sentiment then
    return jsonb_build_object('changed', false, 'previous', v_row.sentiment,
                              'sentiment', p_sentiment, 'override', null);
  end if;

  update public.prompt_results
     set sentiment = p_sentiment,
         visibility_score = greatest(0, least(100,
           coalesce(visibility_score, 0)
           - public.sentiment_visibility_bonus(v_row.sentiment)
           + public.sentiment_visibility_bonus(p_sentiment)))
   where id = p_result_id;

  insert into public.sentiment_overrides
    (result_id, brand_id, previous_sentiment, sentiment, note, user_id, user_name)
  values
    (p_result_id, v_row.brand_id, coalesce(v_row.sentiment, 'neutral'), p_sentiment, v_note,
     v_user.id, v_user.full_name)
  returning * into v_override;

  -- The answer's day in the rollups, now rather than at the nightly sweep.
  v_day := (v_row.created_at at time zone 'utc')::date;
  perform public.refresh_insights_daily(v_row.brand_id, v_day, v_day);
  perform public.refresh_mentions_daily(v_row.brand_id, v_day, v_day);

  return jsonb_build_object(
    'changed', true,
    'previous', v_override.previous_sentiment,
    'sentiment', v_override.sentiment,
    'override', jsonb_build_object(
      'id', v_override.id,
      'sentiment', v_override.sentiment,
      'previous_sentiment', v_override.previous_sentiment,
      'note', v_override.note,
      'user_name', v_override.user_name,
      'created_at', v_override.created_at));
end;
$$;

-- ── approve_action_task_review (00375) ─────────────────────────────────────
-- Action Center: an admin or manager approves a task waiting for
-- review.

create or replace function public.approve_action_task_review(
  p_review_id uuid,
  p_title text,
  p_details jsonb,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.action_task_reviews%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_task_id uuid;
  -- Who approves: the API key's owner for the service role, else the caller.
  v_person uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
begin
  -- The person's role first, before any row is read or locked.
  if not exists (
    select 1 from public.profiles p
    where p.id = v_person and p.role in ('admin', 'manager')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Only a row of a brand the person can access: another's reads as not there.
  select r.* into v_review
  from public.action_task_reviews r
  join public.actions a on a.id = r.action_id
  join public.brands b on b.id = a.brand_id
  join public.profiles p on p.organization_id = b.organization_id
  where r.id = p_review_id
    and p.id = v_person
    and public.can_access_brand(b.id, p.id)
  for update of r;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from public.actions a
    where a.id = v_review.action_id
      and (a.deleted_at is not null or a.status in ('completed', 'dismissed'))
  ) then
    raise exception 'action closed' using errcode = '55000';
  end if;

  if char_length(v_title) not between 1 and 200
    or jsonb_typeof(p_details) is distinct from 'object'
    or nullif(btrim(coalesce(p_details->>'url', '')), '') is null
    or nullif(btrim(coalesce(p_details->'change'->>'after', '')), '') is null
    or nullif(btrim(coalesce(p_details->>'doneWhen', '')), '') is null
    or coalesce(p_details->>'check', '') not in ('auto', 'rerun', 'manual')
  then
    raise exception 'incomplete task' using errcode = '22023';
  end if;

  insert into public.action_tasks (action_id, position, title, status, mode, permission, details)
  select
    v_review.action_id,
    coalesce(max(t.position), 0) + 1,
    v_title,
    'todo',
    'human',
    'read',
    -- The reviewer's task now: Regenerate keeps it (task-writer keepsTask).
    p_details || jsonb_build_object('source', 'reviewed')
  from public.action_tasks t
  where t.action_id = v_review.action_id
  returning id into v_task_id;

  delete from public.action_task_reviews where id = v_review.id;

  insert into public.action_events (action_id, event, data, actor_id)
  values (v_review.action_id, 'task_added', jsonb_build_object('title', v_title), v_person);

  update public.actions set updated_at = now() where id = v_review.action_id;

  return v_task_id;
end;
$$;

-- ── Comments ───────────────────────────────────────────────────────────────
-- Who may call each one, as the check above says it.

comment on function public.ai_traffic_page_citations(uuid, date, date) is
  'AI Traffic (AT-006): how often tracked AI answers cited each of the brand''s own pages between two days, keyed by lower(normalize_page_path). Security definer because citation_urls has no member select policy, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads empty.';

comment on function public.ai_traffic_conversions(uuid, date, date, integer) is
  'AI Traffic "Where AI visitors convert" (AT-014, spec §3.4b): converting landing pages from Analytics'' AI sessions (sessions, key events, sessions with a key event, revenue, best platform) and AI platform × topic of the tracked prompts whose answers cite them. Security definer because citation_urls has no member select policy, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.ai_traffic_google_pages(uuid, date, date, boolean, integer, integer) is
  'AI Traffic "Is AI taking Google clicks?" (AT-008, spec §3.6): pages whose Search Console impressions rose 15%+ while CTR fell 20%+ against the period before (at least p_min_impressions impressions before), most clicks lost first, each with a tracked prompt about it for its Positions panel (its target URL, else an active prompt that cited it in 90 days). p_latest ends the window on Google''s latest reported day. Security definer because citation_urls has no member select policy, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer) is
  'AI Traffic Pages section (AT-006, spec §3.5): the brand''s pages in a window with AI visits (ai_traffic_merged), AI key events, top platforms, citations, prompts pointing to them, all-channel traffic, sitemap presence and whether AI visitors found the page missing (AT-012); the counts of the No AI traffic / Cited, not clicked / Traffic, no prompt lists, which leave missing pages out, and one page of the asked tab''s rows. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.ai_bot_report(uuid, date, date, integer) is
  'AI Traffic "AI bots reading your site" (AT-011, spec §3.7): verified AI-bot hits between two days by type (training, search, user) and by bot, the most read pages with each type''s last read, and the cited pages no search bot read in the last 30 days (null until bot data covers those 30 days: rows on 28 of them, or a live connection 29+ days old that sent in the last 2). Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer) is
  'AI Traffic "Broken AI links" (AT-012, spec §3.5): the pages AI-referred visitors landed on that answered 404 or 410 (or, without a status, whose title said not found) in a window, with their visits, platforms, citations and a suggested redirect to a working page (similar path, parent page or home; none for a route on the page, target_reason query). Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.brand_ai_conversions(uuid, integer) is
  'Content plan (CE-017, 00288): the brand''s conversions from AI journeys over the last 7, 30 or 90 whole UTC days (ending yesterday), from the AI Traffic snippet (ai_traffic_events, 00286): per goal, and the most frequent journey (source, pages, goal, count). Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_page_impact(uuid, text, integer) is
  'Content Editor (CE-016): one page''s citations, AI visits, Google clicks and citing prompts over the last N whole UTC days (ending yesterday) and the N before. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_page_results(uuid, text, integer) is
  'Content Editor (CE-016): one page''s AI visits per AI source over the last N whole UTC days (ending yesterday), with Google Analytics'' AI sessions landing on it, their key events, purchases and revenue. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_draft_cited_answers(uuid, integer) is
  'Content Editor locked passages (CE-018, 00216): the answers of the last p_days days whose citations name the page a draft optimizes (its source_url on one of the brand''s domains), the latest first, at most 200, each response cut to 12,000 characters; [] for a draft without such a page. Security definer because citation_urls has no member select policy, for a person who can access the draft''s brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_draft_sources(uuid, integer) is
  'Content Editor (CE-008): a draft''s sources over the last N days — its prompts and those citing its page, their AI fan-out searches, the pages their answers cited, the brand''s Search Console queries, and the brand and competitor domains. Security definer, for a person who can access the draft''s brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_page_overlap(uuid, uuid[], timestamptz) is
  'Content Editor (CE-015): the brand''s own pages cited for these prompts since p_since, with prompts in common, citations and Google position, for Start''s overlap check. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads empty.';

comment on function public.content_plan_insights(uuid, integer) is
  'Content Editor (CE-014): the addresses AI answers cite for the brand over the last N (7, 30 or 90) whole UTC days to yesterday (from citation_url_daily): its own pages (the 5,000 cited most) and the 1,000 others cited most, with the total; and what AI-referred visitors did on the site: visits, Google Analytics AI key events, purchases and revenue. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_start_prompts(uuid, integer, integer) is
  'Content Editor New content (CE-003): the brand''s active prompts, each marked seen when an answer in the last p_days UTC days named the brand or cited its pages (insights_prompt_daily); not seen first, by text, up to p_limit, with the count of seen ones. Security definer, planned with its arguments, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_page_conversions(uuid, text, integer) is
  'Content Editor (CE-017, 00287): conversions of AI journeys through one page over the last N whole UTC days (ending yesterday), from the AI Traffic snippet (ai_traffic_events, 00286): per goal with units, value per currency, per first AI source, and the five most frequent journeys (source, pages, goal). Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.content_plan_pages(uuid, integer) is
  'Content Editor (CE-014): the brand''s 100 most cited pages over the last N (7, 30 or 90) whole UTC days to yesterday and the N before, from the daily rollups: citations, the brand''s answers in each window, platforms citing at a lower rate, AI visits and, with conversions on (00291), the conversions from AI journeys that landed on, went through or converted on each page, of the latest 2,000 (null with conversions off); with the earlier window''s first day and the brand''s first tracked day. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads null.';

comment on function public.shopping_amazon_share_weekly(uuid, timestamptz) is
  'Shopping (00225): five rolling seven-day windows ending at p_as_of, each with the brand''s own-product cards that have a classified destination and those of them that send shoppers to Amazon. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads empty.';

comment on function public.shopping_merchant_split(uuid, timestamptz, timestamptz, text[], text[], text[]) is
  'Shopping (#1277, 00268): the brand''s own-product cards per destination (its store, Amazon, Walmart, eBay, other marketplaces, other resellers) in the Overview tab''s window and filters, with the cards that have no merchant URL counted apart. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads empty.';

comment on function public.shopping_own_product_offers(uuid, timestamptz, timestamptz, text[], text[], text[]) is
  'Shopping (#1277, 00268): the lowest price per merchant, listing, title and currency among the brand''s own-product cards, with the link of the card that showed it, as one jsonb list for the reseller price alert. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads [].';

comment on function public.catalog_product_ai_stats(uuid, timestamptz, timestamptz, uuid) is
  'Product visibility, part 4 (00361): per live catalog product of a brand with an AI visit or an order (or the one p_product_id names), the AI-referred visits to its page and the orders whose AI visit started there (first_url), with their revenue in the main currency. A product''s page is its link, else its first variant''s. Security definer, for a person who can access the brand (00435, can_access_brand) and for the service role; anyone else reads empty.';

comment on function public.seed_kpi_presets(uuid, jsonb) is
  'Action Center KPIs (00163): adds the ready-made KPIs, p_kpis = [{ key, target }], monthly, to a brand not set up yet. True when it added them; false when the brand was already set up or isn''t there. For an admin or manager who can access the brand (00435, can_access_brand); anyone else gets 42501.';

comment on function public.override_mention_sentiment(uuid, text, text, uuid) is
  'Mentions "Sentiment is wrong" (00160, over the API and MCP since 00223): sets an answer''s sentiment and its visibility score, logs the correction under the person''s name and refreshes that day''s rollups. p_user_id is the person the service role corrects for (the API key''s owner); a signed-in caller is always auth.uid(). For an admin or manager who can access the answer''s brand (00435, can_access_brand); anyone else gets 42501.';

comment on function public.approve_action_task_review(uuid, text, jsonb, uuid) is
  'Action Center (AC-010): a task waiting for review (action_task_reviews) onto its action''s task list, after its last task, with the exact page, the change, Done when and how it is checked filled, as the reviewer''s (source reviewed); the review row goes and the trail says a task was added. For an admin or manager who can access the action''s brand (00435, can_access_brand), on an action neither deleted nor closed; p_user_id is the person the service role approves for (00375), a signed-in caller is always auth.uid(). Null when the row is gone or its brand is one the person can''t access.';

notify pgrst, 'reload schema';
