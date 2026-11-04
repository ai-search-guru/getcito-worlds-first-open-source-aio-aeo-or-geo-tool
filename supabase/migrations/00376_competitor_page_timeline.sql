-- ============================================================================
-- 00376: a competitor's pages over time (learning C3)
-- ============================================================================
-- A competitor rising in AI answers had no "why" beside it. This keeps two
-- kinds of dated events for each competitor page the brand's own tracked
-- answers cite (server action-center/competitorTimeline.js):
--
--   first_cited  the first day the brand's answers cited the page, read from
--                prompt_result_citations (no page read; the first night goes
--                back 90 days, so it is the first since then);
--   changed      a weekly re-read found the page's words changed by more than
--                a date or a price moving (the Action Center's page checks'
--                rule, taskChecks.js), with the Site Audit checks it gained
--                and lost.
--
-- The page is read free (safe-fetch), within the brand's daily page reads,
-- as the pages "Analyze competitor content" reads (00369). What is kept of a
-- read is what Site Audit's checks found and a sketch of its words (hashes
-- of its 4-word runs, not the text), so the next read can tell it changed.
-- Members read the events; the server writes them.

alter table public.cited_page_features
  add column if not exists sketch jsonb;

comment on column public.cited_page_features.sketch is
  'Learning C3 (00376): the read page''s word sketch (taskChecks.js sketch(): hashes of its 4-word runs, never its text), compared with the next read to tell whether the page changed.';

create table if not exists public.competitor_page_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  -- The page as Site Audit keys it: host and path, lower case.
  page_key text not null,
  url text not null,
  domain text not null,
  kind text not null check (kind in ('first_cited', 'changed')),
  at timestamptz not null,
  -- first_cited: { answers }; changed: { similarity, gained: [{ key, label }], lost: [{ key, label }] }.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- A page is first cited once.
create unique index if not exists competitor_page_events_first_cited_uidx
  on public.competitor_page_events (brand_id, page_key)
  where kind = 'first_cited';

-- The Competitors page reads one competitor's events, newest first.
create index if not exists competitor_page_events_competitor_idx
  on public.competitor_page_events (brand_id, competitor_id, at desc);

alter table public.competitor_page_events enable row level security;

create policy competitor_page_events_member_select on public.competitor_page_events
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

revoke all on table public.competitor_page_events from anon, authenticated;
grant select on table public.competitor_page_events to authenticated;
grant all on table public.competitor_page_events to service_role;

comment on table public.competitor_page_events is
  'Learning C3 (00376): when a competitor page was first cited in the brand''s tracked answers, and when a weekly re-read found it changed (and which Site Audit checks it gained or lost). Server writes; members read.';

-- When each competitor's citations were last read for first_cited events: a
-- competitor never read is read back 90 days once, the rest from their last
-- read, so a night doesn't read a brand's whole history again.
create table if not exists public.competitor_timeline_scans (
  competitor_id uuid primary key references public.competitors(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  scanned_at timestamptz not null
);

alter table public.competitor_timeline_scans enable row level security;
revoke all on table public.competitor_timeline_scans from anon, authenticated;
grant all on table public.competitor_timeline_scans to service_role;

comment on table public.competitor_timeline_scans is
  'Learning C3 (00376): when each competitor''s cited pages were last read for first_cited events. Server only.';

-- ----------------------------------------------------------------------------
-- The competitor pages the brand's answers cited since p_since: each cited
-- URL on a competitor's domain (its subdomains too), its competitor, the
-- first time it was cited and in how many answers. Read in the database so a
-- brand's citations never travel; the server only.
-- ----------------------------------------------------------------------------
create or replace function public.competitor_cited_urls(p_brand_id uuid, p_since timestamptz)
returns table (
  url text,
  domain text,
  competitor_id uuid,
  first_at timestamptz,
  answers bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with rivals as (
    select c.id,
      -- As citation_urls.domain is kept: host without www., lower case.
      regexp_replace(
        regexp_replace(lower(trim(c.domain)), '^[a-z]+://', ''),
        '^www\.|[/:?#].*$', '', 'g'
      ) as host
    from public.competitors c
    where c.brand_id = p_brand_id and trim(c.domain) <> ''
  )
  select u.url, u.domain, r.id, min(prc.created_at), count(distinct prc.prompt_result_id)
  from public.prompt_result_citations prc
  join public.citation_urls u on u.id = prc.url_id
  join rivals r on r.host <> '' and (u.domain = r.host or u.domain like '%.' || r.host)
  where prc.brand_id = p_brand_id
    and prc.created_at >= p_since
  group by u.url, u.domain, r.id
$$;

revoke all on function public.competitor_cited_urls(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.competitor_cited_urls(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';
