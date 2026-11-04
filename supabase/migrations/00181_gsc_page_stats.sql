-- ============================================================================
-- 00181: Search Console by page, and "Is AI taking Google clicks?" (AT-008, part B)
-- ============================================================================
-- Spec §3.6: pages whose Google impressions rose at least 15% while their
-- click-through rate fell at least 20% against the period before — the
-- pattern of an AI Overview answering in place of the click. The next step
-- for each page is the Positions panel of a tracked prompt about it.
--
-- gsc_query_stats (00047) holds Search Console by query, which can't say
-- which page lost clicks, and drops anonymised queries. gsc_page_stats holds
-- it by page and day, synced alongside (backend/src/lib/gscSync.js): a
-- brand's sync reads 190 days so a 90-day range has a whole period before it,
-- Google's delay included, until one gets through them all for its property
-- (brands.gsc_pages_backfilled_property); later ones read the last 28, and
-- rows older than 190 days are pruned. The sync (service role) upserts on
-- (brand_id, page, date); org members read.
--
-- page_key is the page as the Pages section keys it (00178), stored: worked
-- out per row at read time it took 4 s warm, 18 s cold, on 110k rows (the
-- largest brand's 600 pages × 183 days); grouped by the column, 46 ms.

create table public.gsc_page_stats (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands(id) on delete cascade,
    page text not null,
    page_key text generated always as (lower(public.normalize_page_path(page))) stored,
    date date not null,
    clicks integer not null default 0,
    impressions integer not null default 0,
    ctr double precision not null default 0,
    position double precision not null default 0,
    created_at timestamptz not null default now(),
    unique (brand_id, page, date)
);

create index gsc_page_stats_brand_date_idx
    on public.gsc_page_stats (brand_id, date desc);

-- The sync's table-wide retention prune (date < 190 days ago).
create index gsc_page_stats_date_idx
    on public.gsc_page_stats (date);

-- The property whose 190 days of pages the sync has read in full. Until it
-- matches gsc_property, every sync reads them again, so a first sync cut
-- short resumes; when it names another property, that one's page rows are
-- dropped first.
alter table public.brands
    add column if not exists gsc_pages_backfilled_property text;

alter table public.gsc_page_stats enable row level security;

create policy "gsc_page_stats: member select" on public.gsc_page_stats
    for select using (
        brand_id in (
            select b.id
            from public.brands b
            join public.profiles p on p.organization_id = b.organization_id
            where p.id = auth.uid()
        )
    );

grant select on public.gsc_page_stats to authenticated;

-- ─── Is AI taking Google clicks? ────────────────────────────────────────────
--
-- Pages are keyed by lower(normalize_page_path(...)), as the Pages section's
-- are (00178). A page qualifies when the period before had at least
-- p_min_impressions impressions (fewer would make the percentages noise),
-- impressions rose by 15% or more and the CTR fell by 20% or more. Rows come
-- most clicks lost first: the previous CTR's clicks on this period's
-- impressions, minus the clicks there were.
--
-- Google reports about two days late: with p_latest the window ends on the
-- latest day it has reported, keeping its length (§3.01), as the Google
-- clicks card's does (00174). All time (p_since null) has no period before.
-- When the brand's page history doesn't reach back to the start of the
-- period before (a property connected lately, a long custom range), its
-- impressions would read low and every page as rising: the result says
-- `incomplete` and lists nothing.
--
-- Each row names one tracked prompt about the page, for its Positions panel:
-- an active prompt whose target URL is the page, else an active prompt whose
-- answers cited it over the last 90 days. citation_urls has no member select
-- policy, so this runs as its owner after checking the caller belongs to the
-- brand's organization; a caller from elsewhere gets nothing.

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
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
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

revoke all on function public.ai_traffic_google_pages(uuid, date, date, boolean, integer, integer)
  from public, anon;
grant execute on function public.ai_traffic_google_pages(uuid, date, date, boolean, integer, integer)
  to authenticated, service_role;

comment on function public.ai_traffic_google_pages(uuid, date, date, boolean, integer, integer) is
  'AI Traffic "Is AI taking Google clicks?" (AT-008, spec §3.6): pages whose Search Console impressions rose 15%+ while CTR fell 20%+ against the period before (at least p_min_impressions impressions before), most clicks lost first, each with a tracked prompt about it for its Positions panel (its target URL, else an active prompt that cited it in 90 days). p_latest ends the window on Google''s latest reported day. Security definer with an organization check: citation_urls has no member select policy.';

notify pgrst, 'reload schema';
