-- ============================================================================
-- 00178: the AI Traffic page's Pages section and its status tabs (AT-006)
-- ============================================================================
-- Spec §3.5, "which answers send visitors": one table of the brand's pages
-- for the page's range, joining AI visits with how often tracked AI answers
-- cite the page and the prompts that point to it, with three work lists:
--
--   * No AI traffic — pages with traffic in Google Analytics or in the
--     site's sitemap (site_pages) that got no AI visit, ranked by value:
--     revenue, key events, then sessions and engagement. Replaces "Pages AI
--     engines aren't sending traffic to", in the page's own window (F2).
--   * Cited, not clicked — cited at least 20 times in the range, no AI visit.
--   * Traffic, no prompt — AI visits, but no tracked prompt's answer cited
--     the page in the range.
--
-- Pages are keyed by lower(normalize_page_path(...)), so a snippet URL, an
-- Analytics landing page, a cited URL and a sitemap URL name one page. AI
-- visits are ai_traffic_merged's (00176): the snippet on days it was active,
-- Analytics on the others, never summed. Checkout, login, legal and similar
-- pages are left out, as the nightly page detection leaves them out
-- (backend/src/lib/pagePaths.js; a server test keeps the two lists equal).
--
-- citation_urls has no member select policy, so both functions run as their
-- owner, after checking the caller belongs to the brand's organization; a
-- caller from elsewhere gets nothing.

-- ─── Citations of the brand's own pages ─────────────────────────────────────

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
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
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

revoke all on function public.ai_traffic_page_citations(uuid, date, date) from public, anon;
grant execute on function public.ai_traffic_page_citations(uuid, date, date)
  to authenticated, service_role;

comment on function public.ai_traffic_page_citations(uuid, date, date) is
  'AI Traffic (AT-006): how often tracked AI answers cited each of the brand''s own pages between two days, keyed by lower(normalize_page_path). Security definer with an organization check: citation_urls has no member select policy.';

-- ─── The Pages section ──────────────────────────────────────────────────────

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
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
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
      bool_or(s.page_key is not null) as in_sitemap
    from keys k
    left join ai on ai.page_key = k.page_key
    left join ai_key_events ke on ke.page_key = k.page_key
    left join platforms pl on pl.page_key = k.page_key
    left join cited c on c.page_key = k.page_key
    left join targeted t on t.page_key = k.page_key
    left join traffic tr on tr.page_key = k.page_key
    left join in_sitemap s on s.page_key = k.page_key
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
      p.ai_visits > 0 and p.citations = 0 as traffic_no_prompt
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
        'traffic_no_prompt', count(*) filter (where traffic_no_prompt)
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

revoke all on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer)
  from public, anon;
grant execute on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer) is
  'AI Traffic Pages section (AT-006, spec §3.5): the brand''s pages in a window with AI visits (ai_traffic_merged), AI key events, top platforms, citations, prompts pointing to them, all-channel traffic and sitemap presence; the counts of the No AI traffic / Cited, not clicked / Traffic, no prompt lists and one page of the asked tab''s rows. Security definer with an organization check.';

notify pgrst, 'reload schema';
