-- ============================================================================
-- 00200: soft 404s count as broken AI links
-- ============================================================================
-- Follow-up from #1192's review (AT-012). A single-page app answers every
-- path with 200 and shows its own "Page not found" route, so the browser's
-- status says the page works. The snippet now reads the title for a 2xx
-- landing page too (with a stricter pattern), a moment after load so the
-- app has set it, and the beacon keeps not_found_title with a 2xx status.
--
-- ai_traffic_broken_pages counts such a page as missing (status soft404)
-- once at least two visits saw it, doesn't let its 2xx count as working,
-- and doesn't let the nightly page read clear it: that read gets the app's
-- shell with a 200 too. The beacon is public, so one visit, stray or made
-- up, lists nothing (gkhngyk on #1247): nothing would clear it, and a cited
-- page would raise broken_citation_target from that visit. ai_traffic_broken_links reads those pageviews for the visits. The
-- rest of both functions is 00186's.

comment on column public.ai_traffic_logs.not_found_title is
  'True when the page''s title read "404" or "not found" and the browser reported no status, or a 2xx (a soft 404) (AT-012).';

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
      -- The visit a pageview belongs to: a reload continues one (AT-003).
      coalesce(l.visit_of, l.id) as visit_id,
      -- A soft 404: the server answered 2xx and the page says not found (a
      -- single-page app's route that doesn't exist).
      coalesce(l.not_found_title and l.http_status between 200 and 299, false) as soft_404,
      (p_to is null or l.created_at <= p_to)
        and (
          l.http_status in (404, 410)
          or (l.not_found_title and (l.http_status is null or l.http_status between 200 and 299))
        )
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
      -- Whether that latest status was a soft 404.
      (array_agg(soft_404 order by created_at desc) filter (where http_status is not null))[1]
        as last_soft_404,
      bool_or(not_found_title) as title_not_found,
      max(created_at) filter (where failed_in_window) as last_failed_at
    from logs
    group by page_key, address
  ),
  -- The visits that saw each page as a soft 404.
  soft_visits as (
    select page_key, count(distinct visit_id) as visits
    from logs
    where soft_404
    group by page_key
  ),
  page_state as (
    select
      a.page_key,
      max(last_status) filter (where last_status in (404, 410)) as last_status,
      bool_or(last_status is null and title_not_found) as title_not_found,
      coalesce(bool_or(last_soft_404), false) and coalesce(max(v.visits), 0) >= 2 as soft_404,
      -- No address with a status reads as not working, not as unknown; a soft
      -- 404's 2xx doesn't either.
      coalesce(bool_or(last_status between 200 and 399 and not last_soft_404), false) as works,
      max(last_failed_at) as last_failed_at,
      -- Every missing address carries a query: a route on the page, not the page.
      bool_and(a.address <> a.page_key)
        filter (
          where last_status in (404, 410)
            or last_soft_404
            or (last_status is null and title_not_found)
        )
        as routed
    from address_state a
    left join soft_visits v on v.page_key = a.page_key
    group by a.page_key
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
    case
      when s.last_status in (404, 410) then s.last_status::text
      when s.soft_404 then 'soft404'
      else 'title'
    end,
    coalesce(s.routed, false)
  from page_state s
  left join fetched f on f.page_key = s.page_key
  where not s.works
    and s.last_failed_at is not null
    and (
      -- The nightly read gets the app's shell with a 200 as well: only the
      -- visitors' browsers can tell a soft 404.
      s.soft_404
      or (
        -- The nightly read found it working after its last miss: fixed since.
        not coalesce(f.last_ok_at > s.last_failed_at, false)
        and (
          s.last_status in (404, 410)
          or (s.last_status is null and s.title_not_found and not coalesce(f.works, false))
        )
      )
    );
$$;

revoke all on function public.ai_traffic_broken_pages(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ai_traffic_broken_pages(uuid, timestamptz, timestamptz)
  to service_role;

comment on function public.ai_traffic_broken_pages(uuid, timestamptz, timestamptz) is
  'AI Traffic (AT-012): the brand''s pages AI visitors found missing in a window whose latest reported status up to now is 404 or 410, or a 2xx with a not-found title (a soft 404, status soft404), or, with no status, whose title said not found and that the nightly page read never found working; not those the nightly read found working after their last miss. Decided per address (path plus query, utm_* and click ids left out), and a path none of whose addresses last answered 2xx or 3xx; routed when every missing address carries a query. No organization check: called only by ai_traffic_broken_links and ai_traffic_pages, after theirs.';

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

revoke all on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer)
  from public, anon;
grant execute on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_broken_links(uuid, timestamptz, timestamptz, integer, integer) is
  'AI Traffic "Broken AI links" (AT-012, spec §3.5): the pages AI-referred visitors landed on that answered 404 or 410 (or, without a status, whose title said not found) in a window, with their visits, platforms, citations and a suggested redirect to a working page (similar path, parent page or home; none for a route on the page, target_reason query). Security definer with an organization check.';

notify pgrst, 'reload schema';
