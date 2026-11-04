-- ============================================================================
-- 00186: broken AI links (AT-012)
-- ============================================================================
-- Spec §3.5: "AI-referred visits that landed on a 404 → suggested redirect,
-- exportable as a redirect list." Snippet only (§3.8b).
--
-- The snippet now sends the landing page's HTTP status as the browser saw it
-- (the navigation entry's responseStatus). Browsers that don't report one
-- (Safari) send none, and say instead whether the page's title read "404" or
-- "not found":
--
--   * http_status — the status, or null when the browser didn't tell;
--   * not_found_title — no status, and the title said "not found".
--
-- A page is broken in a range when AI visitors found it missing in the range
-- and its latest pageview with a status, up to now, still says 404 or 410.
-- With no status at all, a title saying "not found" counts unless the nightly
-- page read (site_pages, 00104) found the page working: a post about fixing
-- 404s is not a missing page. A page the nightly read found working after its
-- last miss is fixed, and isn't listed. The status is decided per address
-- (the path plus its query, utm_* and click ids such as gclid left out), and
-- a path is broken only when none of its addresses last answered 2xx or 3xx:
-- on a shop where /index.php?route=product&id=42 is gone and the other
-- products work, /index.php isn't broken. When every missing address of a
-- page carries a query (a route on it, not the page), no redirect is
-- suggested: one from the path would move the whole route. Its visits are
-- the pageviews that found it missing (404, 410, or no status and a
-- not-found title), not those from before it broke.
--
-- Each other broken page gets a suggested redirect to a page known to work
-- (read 2xx by the nightly page read, or its address without a query landed
-- on with a 2xx in the last 90 days), the first that fits of:
--
--   * similar — the most path words in common, at least half of both pages'
--     words together, a plural read as its singular
--     (/blog/best-tools-2025 → /blog/best-tools-2026);
--   * parent — the nearest working page above it (/guides/old → /guides);
--   * home — the home page.
--
-- The Pages section's Traffic, no prompt list leaves broken pages out: their
-- next step is a redirect, not prompts. ai_traffic_pages is redefined from
-- 00178 for that, and its rows say whether a page is broken.
--
-- Pages are keyed as the Pages section keys them (00178). citation_urls has
-- no member select policy, so both reports run as their owner after
-- checking the caller belongs to the brand's organization; a caller from
-- elsewhere gets nothing. The rule itself (ai_traffic_broken_pages) has no
-- check of its own, so members can't call it.

-- Beacon inserts don't queue behind the column change for long: it gives up
-- after 3 s instead (run it again).
set lock_timeout = '3s';

alter table public.ai_traffic_logs
  add column if not exists http_status smallint,
  add column if not exists not_found_title boolean not null default false;

reset lock_timeout;

comment on column public.ai_traffic_logs.http_status is
  'The landing page''s HTTP status as the visitor''s browser saw it; null when the browser doesn''t report one (Safari) or from an older snippet (AT-012).';
comment on column public.ai_traffic_logs.not_found_title is
  'True when the browser reported no status and the page''s title read "404" or "not found" (AT-012).';

-- ─── Which pages are broken ─────────────────────────────────────────────────
-- The rule above, for both the Broken AI links tab and the Pages section's
-- other lists, which leave these pages out (a missing page needs a redirect,
-- not prompts). No organization check of its own: only the two functions
-- below call it, after theirs.

create or replace function public.ai_traffic_broken_pages(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (page_key text, status text, routed boolean)
language sql
stable
set search_path to 'public'
as $$
  with
  -- Only the pageviews that say something about the page: a status, or a
  -- not-found title. Read up to now, so a page that works again since the
  -- window ended isn't listed.
  logs as (
    select
      n.page_key,
      -- The address: the path plus its query, tracking parameters left out,
      -- in one order. Worked out only when the URL has a query.
      case when q.query is null then n.page_key else n.page_key || '?' || q.query end as address,
      l.created_at,
      l.http_status,
      l.not_found_title,
      (p_to is null or l.created_at <= p_to)
        and (l.http_status in (404, 410) or (l.http_status is null and l.not_found_title))
        as failed_in_window
    from public.ai_traffic_logs l
    cross join lateral (select lower(public.normalize_page_path(l.url)) as page_key) n
    cross join lateral (
      select case when strpos(l.url, '?') > 0 then (
        select string_agg(qp.part, '&' order by qp.part)
        from unnest(string_to_array(split_part(split_part(l.url, '#', 1), '?', 2), '&')) as qp(part)
        where qp.part <> ''
          and qp.part !~* '^(utm_[^=]*|gclid|fbclid|msclkid|srsltid|_gl|ref)(=|$)'
      ) end as query
    ) q
    where l.brand_id = p_brand_id
      and l.created_at >= coalesce(p_from, '-infinity'::timestamptz)
      and (l.http_status is not null or l.not_found_title)
  ),
  address_state as (
    select
      page_key,
      address,
      (array_agg(http_status order by created_at desc) filter (where http_status is not null))[1]
        as last_status,
      bool_or(not_found_title) as title_not_found,
      max(created_at) filter (where failed_in_window) as last_failed_at
    from logs
    group by page_key, address
  ),
  page_state as (
    select
      page_key,
      max(last_status) filter (where last_status in (404, 410)) as last_status,
      bool_or(last_status is null and title_not_found) as title_not_found,
      -- No address with a status reads as not working, not as unknown.
      coalesce(bool_or(last_status between 200 and 399), false) as works,
      max(last_failed_at) as last_failed_at,
      -- Every missing address carries a query: a route on the page, not the page.
      bool_and(address <> page_key)
        filter (where last_status in (404, 410) or (last_status is null and title_not_found))
        as routed
    from address_state
    group by page_key
  ),
  -- What the nightly page read found (00104).
  fetched as (
    select lower(public.normalize_page_path(sp.url)) as page_key,
           bool_or(sp.fetch_status between 200 and 399) as works,
           max(sp.fetched_at) filter (where sp.fetch_status between 200 and 299) as last_ok_at
    from public.site_pages sp
    where sp.brand_id = p_brand_id
      and sp.fetch_status is not null
    group by 1
  )
  select
    s.page_key,
    case when s.last_status is not null then s.last_status::text else 'title' end,
    coalesce(s.routed, false)
  from page_state s
  left join fetched f on f.page_key = s.page_key
  where not s.works
    and s.last_failed_at is not null
    -- The nightly read found it working after its last miss: fixed since.
    and not coalesce(f.last_ok_at > s.last_failed_at, false)
    and (
      s.last_status in (404, 410)
      or (s.last_status is null and s.title_not_found and not coalesce(f.works, false))
    );
$$;

revoke all on function public.ai_traffic_broken_pages(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ai_traffic_broken_pages(uuid, timestamptz, timestamptz)
  to service_role;

comment on function public.ai_traffic_broken_pages(uuid, timestamptz, timestamptz) is
  'AI Traffic (AT-012): the brand''s pages AI visitors found missing in a window whose latest reported status up to now is 404 or 410, or, with no status, whose title said not found and that the nightly page read never found working; not those the nightly read found working after their last miss. Decided per address (path plus query, utm_* and click ids left out), and a path none of whose addresses last answered 2xx or 3xx; routed when every missing address carries a query. No organization check: called only by ai_traffic_broken_links and ai_traffic_pages, after theirs.';

-- ─── Broken AI links ────────────────────────────────────────────────────────

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
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
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
      and (l.http_status in (404, 410) or (l.http_status is null and l.not_found_title))
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

revoke all on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer)
  from public, anon;
grant execute on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer) is
  'AI Traffic "Broken AI links" (AT-012, spec §3.5): the pages AI-referred visitors landed on that answered 404 or 410 (or, without a status, whose title said not found) in a window, with their visits, platforms, citations and a suggested redirect to a working page (similar path, parent page or home; none for a route on the page, target_reason query). Security definer with an organization check.';

-- ─── The Pages section leaves broken pages out of Traffic, no prompt ─────────
-- 00178's function with one change: a page AI visitors found missing is not
-- "Traffic, no prompt" (its next step is a redirect, on Broken AI links), and
-- each row says whether it is broken. Everything else is as 00178 wrote it.

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

revoke all on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer)
  from public, anon;
grant execute on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_pages(uuid, timestamptz, timestamptz, text, integer, integer) is
  'AI Traffic Pages section (AT-006, spec §3.5): the brand''s pages in a window with AI visits (ai_traffic_merged), AI key events, top platforms, citations, prompts pointing to them, all-channel traffic, sitemap presence and whether AI visitors found the page missing (AT-012); the counts of the No AI traffic / Cited, not clicked / Traffic, no prompt lists, which leave missing pages out, and one page of the asked tab''s rows. Security definer with an organization check.';

notify pgrst, 'reload schema';
