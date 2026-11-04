-- Site page inventory (#857, Phase 2).
--
-- Content opportunities can only say "update the page you have" instead of
-- "write a new one" if they know which pages the brand's site has. This is
-- that list: up to 500 pages per brand, chosen from the site's sitemap, the
-- landing pages GA sees and the brand's own pages AI answers cite, with the
-- title, meta description and first heading of each. Page bodies are not
-- stored.
--
-- The server writes it nightly; a page is re-read every 30 days. Members read
-- it.

create table public.site_pages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  url text not null,
  -- Where the page was found: sitemap, ga, citation.
  sources text[] not null default '{}',
  -- From the sitemap, when it gives one.
  lastmod timestamptz,
  -- The figures it was chosen by, over the last 30 days.
  ga_sessions integer not null default 0,
  ai_citations integer not null default 0,
  title text,
  description text,
  h1 text,
  -- HTTP status of the last read (0 when the request failed outright), and
  -- whether it went direct or through Scrape.do.
  fetch_status integer,
  fetched_via text check (fetched_via in ('direct', 'scrapedo')),
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, url)
);

alter table public.site_pages enable row level security;

create policy "site_pages: member select"
  on public.site_pages
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- A brand's GA landing pages by sessions in a window, most first. One jsonb
-- value of [landing_page, sessions] pairs, so PostgREST's row cap does not
-- apply to the per-day rows it sums.
create or replace function public.brand_landing_page_sessions(
  p_brand_id uuid,
  p_since date,
  p_limit integer default 300
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(landing_page, sessions)), '[]'::jsonb)
  from (
    select landing_page, sum(sessions)::bigint as sessions
    from ga_page_stats
    where brand_id = p_brand_id and date >= p_since and landing_page <> ''
    group by landing_page
    order by sum(sessions) desc
    limit p_limit
  ) t;
$$;

revoke all on function public.brand_landing_page_sessions(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.brand_landing_page_sessions(uuid, date, integer) to service_role;
