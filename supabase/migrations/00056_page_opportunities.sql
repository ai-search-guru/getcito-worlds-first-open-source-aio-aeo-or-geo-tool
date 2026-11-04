-- Page opportunities: valuable pages AI engines are not sending traffic to
-- (#719, Phase 5 detection).
--
-- Named for its key, not just its subject, because content_opportunities
-- already exists and means something different. That table is prompt-keyed
-- and LLM-written: "what content should I make, given prompts where I am
-- weak". This one is page-keyed and deterministic: "which of my pages earn,
-- and get nothing from AI". A reader can tell them apart by the key in the
-- name, and a surface can show them together later without either having to
-- pretend to be the other.
--
-- Detection is pure SQL and JavaScript arithmetic — no model runs in this
-- path. Enrichment, clustering and the full lifecycle are deliberately not
-- here; they need volume this has not produced yet.
--
-- One row per (brand, page, kind), upserted daily. A finding that stops
-- qualifying is stamped resolved_at rather than deleted, so the list can show
-- that something improved instead of silently shrinking.

CREATE TABLE public.page_opportunities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    landing_page text NOT NULL,
    kind text NOT NULL,

    -- Which signal ranked this page, and where it ranked. Stored rather than
    -- inferred because the answer differs per property: a shop is ranked on
    -- money, a site with no ecommerce and no conversion events on engagement.
    -- Every surface must say which one it used — calling an engagement rank
    -- "your most valuable page" would be a true sentence about the wrong
    -- thing.
    value_signal text NOT NULL,
    value_percentile numeric NOT NULL,
    value_rank integer NOT NULL,

    -- The figures the finding was raised from, so it can be explained and
    -- audited without recomputing the window.
    sessions integer NOT NULL DEFAULT 0,
    engaged_sessions integer NOT NULL DEFAULT 0,
    key_events integer NOT NULL DEFAULT 0,
    transactions integer NOT NULL DEFAULT 0,
    revenue double precision NOT NULL DEFAULT 0,
    engagement_seconds integer NOT NULL DEFAULT 0,
    ai_sessions integer NOT NULL DEFAULT 0,
    ai_platforms text[] NOT NULL DEFAULT '{}',

    window_days integer NOT NULL,
    first_detected_at timestamptz NOT NULL DEFAULT now(),
    last_detected_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,

    CONSTRAINT page_opportunities_kind_check
        CHECK (kind = ANY (ARRAY['no_ai_traffic'::text])),
    CONSTRAINT page_opportunities_signal_check
        CHECK (value_signal = ANY (ARRAY[
            'revenue'::text, 'transactions'::text, 'key_events'::text, 'engagement'::text
        ])),
    UNIQUE (brand_id, landing_page, kind)
);

-- The list surface reads open findings for one brand, worst gap first.
CREATE INDEX page_opportunities_brand_open_idx
    ON public.page_opportunities (brand_id, value_percentile DESC)
    WHERE resolved_at IS NULL;

ALTER TABLE public.page_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "page_opportunities: member select" ON public.page_opportunities
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.page_opportunities TO authenticated;
