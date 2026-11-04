-- Search Console query stats (#644) — daily per-query rows pulled through
-- the Composio connection for every brand mapped to a GSC property.
--
-- The sync (service role) writes with upserts on (brand_id, query, date);
-- org members read. Retention/pruning comes with the first consumer.

CREATE TABLE public.gsc_query_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    query text NOT NULL,
    date date NOT NULL,
    clicks integer NOT NULL DEFAULT 0,
    impressions integer NOT NULL DEFAULT 0,
    ctr double precision NOT NULL DEFAULT 0,
    position double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, query, date)
);

CREATE INDEX gsc_query_stats_brand_date_idx
    ON public.gsc_query_stats (brand_id, date DESC);

ALTER TABLE public.gsc_query_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gsc_query_stats: member select" ON public.gsc_query_stats
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.gsc_query_stats TO authenticated;
