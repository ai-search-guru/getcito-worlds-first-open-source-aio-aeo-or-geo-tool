-- ============================================================================
-- 00377: does Google show the brand's products in its shopping results?
-- ============================================================================
-- Product Visibility's Readiness asked for a Google Merchant Center feed,
-- which this deployment may not be able to connect. Search Console says it
-- too, from the brand's own property: the pages Google shows as merchant
-- listings (the free shopping listings, fed by Merchant Center or by the
-- page's product schema) and as product snippets (a product's price,
-- rating and stock under its result).
--
-- The Search Analytics API can't give search appearance as a column beside
-- the page, so the sync (backend/src/lib/gscSync.js) asks in two steps: the
-- property's appearance types over the last 28 days, then each shopping one's
-- pages by day, filtered to it. gsc_shopping_page_stats keeps those rows; the
-- sync (service role) upserts on (brand_id, page, appearance, date), and
-- members read them. Rows older than 90 days are pruned, as queries' are.
--
-- brands.gsc_shopping_property is the property whose shopping rows the brand
-- has (another one's are dropped first), and gsc_shopping_synced_at when they
-- were last read: before the first read, Readiness says it doesn't know yet
-- rather than that no product shows.

create table if not exists public.gsc_shopping_page_stats (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands(id) on delete cascade,
    page text not null,
    -- merchant_listings | product_snippets
    appearance text not null check (appearance in ('merchant_listings', 'product_snippets')),
    date date not null,
    clicks integer not null default 0,
    impressions integer not null default 0,
    ctr double precision not null default 0,
    position double precision not null default 0,
    created_at timestamptz not null default now(),
    unique (brand_id, page, appearance, date)
);

create index if not exists gsc_shopping_page_stats_brand_date_idx
    on public.gsc_shopping_page_stats (brand_id, date desc);

-- The sync's table-wide retention prune (date < 90 days ago).
create index if not exists gsc_shopping_page_stats_date_idx
    on public.gsc_shopping_page_stats (date);

alter table public.gsc_shopping_page_stats enable row level security;

create policy "gsc_shopping_page_stats: member select" on public.gsc_shopping_page_stats
    for select using (
        brand_id in (
            select b.id
            from public.brands b
            join public.profiles p on p.organization_id = b.organization_id
            where p.id = auth.uid()
        )
    );

revoke all on table public.gsc_shopping_page_stats from anon, authenticated;
grant select on public.gsc_shopping_page_stats to authenticated;

comment on table public.gsc_shopping_page_stats is
  'Product Visibility Readiness (00377): the brand''s Search Console pages Google showed as merchant listings or product snippets, by day. Synced from the brand''s own property (gscSync.js); members read.';

alter table public.brands
    add column if not exists gsc_shopping_property text,
    add column if not exists gsc_shopping_synced_at timestamptz;

comment on column public.brands.gsc_shopping_property is
  '00377: the Search Console property gsc_shopping_page_stats''s rows for the brand come from; when it names another, they are dropped first (gscSync.js).';
comment on column public.brands.gsc_shopping_synced_at is
  '00377: when the brand''s shopping appearance rows were last read; null before the first read, when Readiness doesn''t know yet.';

notify pgrst, 'reload schema';
