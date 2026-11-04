-- Google Analytics traffic sync (#704) — daily GA4 rows pulled through the
-- Composio connection for every brand mapped to a property (#694).
--
-- Three tables rather than one, because they answer different questions and
-- must never be added together:
--
--   ga_ai_traffic_stats  what AI sources brought, per landing page
--   ga_page_stats        what a landing page is worth in total, all sources
--   ga_item_stats        what actually sold, product-scoped
--
-- The first two overlap by design: the AI table is a slice of the same
-- traffic the page table totals. Summing them double-counts, which is the
-- same trap this integration already avoids with ai_traffic_logs (our own
-- snippet counts these visits a second time). Nothing in the pipeline joins
-- or sums across origins; how the numbers are presented together is a
-- decision for the surface phase.
--
-- Writes are service-role upserts keyed on the natural grain, so re-running a
-- day rewrites it instead of duplicating. Org members read.

-- ── AI-sourced traffic, by landing page ─────────────────────────────────────
--
-- `source` keeps GA4's raw sessionSource string and `platform` the normalised
-- name. The raw value is not redundant: one engine arrives under several
-- source strings, and keeping what was actually observed is what lets the
-- classification list be extended from real data instead of guesswork.
--
-- Two page columns on purpose. `landing_page_query` is the full entry URL,
-- which is what attribution needs — this table is small enough to afford the
-- cardinality (a live property produced 96 rows over 90 days). `landing_page`
-- drops the query string so it joins the page totals below, which cannot
-- afford it: on the same property the query string multiplied distinct pages
-- by 8.8, and a shop with faceted filters is far worse.
CREATE TABLE public.ga_ai_traffic_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    date date NOT NULL,
    source text NOT NULL,
    platform text,
    landing_page text NOT NULL DEFAULT '',
    landing_page_query text NOT NULL DEFAULT '',
    sessions integer NOT NULL DEFAULT 0,
    engaged_sessions integer NOT NULL DEFAULT 0,
    key_events integer NOT NULL DEFAULT 0,
    total_users integer NOT NULL DEFAULT 0,
    transactions integer NOT NULL DEFAULT 0,
    purchase_revenue double precision NOT NULL DEFAULT 0,
    engagement_duration_seconds integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, date, source, landing_page_query)
);

CREATE INDEX ga_ai_traffic_stats_brand_page_idx
    ON public.ga_ai_traffic_stats (brand_id, landing_page);

CREATE INDEX ga_ai_traffic_stats_brand_date_idx
    ON public.ga_ai_traffic_stats (brand_id, date DESC);

-- ── Landing-page totals, every source ───────────────────────────────────────
--
-- "How much is this page worth to the business" cannot be answered from the
-- AI slice: a page that converts well overall is the interesting one when its
-- AI visibility is weak, and that comparison needs the page's full figures.
--
-- This is the table that grows: one row per page per day, and a large shop
-- can have tens of thousands of pages taking traffic on any given day. Two
-- things bound it — the path without its query string, and a per-day ceiling
-- on how many pages are kept (PAGE_DAILY_LIMIT in gaSync.js). Pages are
-- ordered so anything converting survives the cut whatever its session count;
-- what gets dropped is the one-session tail, which no ranking of commercial
-- value would have surfaced anyway.
CREATE TABLE public.ga_page_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    date date NOT NULL,
    landing_page text NOT NULL DEFAULT '',
    sessions integer NOT NULL DEFAULT 0,
    engaged_sessions integer NOT NULL DEFAULT 0,
    key_events integer NOT NULL DEFAULT 0,
    total_users integer NOT NULL DEFAULT 0,
    transactions integer NOT NULL DEFAULT 0,
    purchase_revenue double precision NOT NULL DEFAULT 0,
    engagement_duration_seconds integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, date, landing_page)
);

CREATE INDEX ga_page_stats_brand_date_idx
    ON public.ga_page_stats (brand_id, date DESC);

-- ── Product rows ────────────────────────────────────────────────────────────
--
-- Item-scoped and deliberately not joined to a page: a GA4 purchase fires on
-- the checkout page, so pairing item metrics with a page dimension would
-- attribute every sale to /checkout. Which entry page produced sales lives in
-- the two tables above; what sold lives here.
--
-- Absent ecommerce tracking is normal, not an error — properties without it
-- simply return no rows.
CREATE TABLE public.ga_item_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    date date NOT NULL,
    item_id text NOT NULL DEFAULT '',
    item_name text NOT NULL DEFAULT '',
    item_category text NOT NULL DEFAULT '',
    items_viewed integer NOT NULL DEFAULT 0,
    items_added_to_cart integer NOT NULL DEFAULT 0,
    items_purchased integer NOT NULL DEFAULT 0,
    item_revenue double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, date, item_id, item_name)
);

CREATE INDEX ga_item_stats_brand_date_idx
    ON public.ga_item_stats (brand_id, date DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.ga_ai_traffic_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_page_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_item_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ga_ai_traffic_stats: member select" ON public.ga_ai_traffic_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

CREATE POLICY "ga_page_stats: member select" ON public.ga_page_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

CREATE POLICY "ga_item_stats: member select" ON public.ga_item_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.ga_ai_traffic_stats TO authenticated;
GRANT SELECT ON public.ga_page_stats TO authenticated;
GRANT SELECT ON public.ga_item_stats TO authenticated;
