-- Tracking run ledger — stable insights 24h window.
--
-- One row per FULL tracking run (cron or manual Run All; single-prompt runs
-- don't stamp). The insights 24h view anchors to the latest COMPLETED run so
-- the daily refresh can't show an empty window or a shrinking prompt count
-- while results stream in: the dashboard keeps the last completed run's
-- window and switches to the new run atomically when the worker finishes
-- draining.
--
-- The worker (service role) writes; org members read — an uncompleted row
-- also powers the "tracking in progress" banner for cron-started runs, which
-- browsers previously couldn't see (the old banner only knew about jobs
-- started from that same browser via localStorage).

CREATE TABLE public.tracking_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    source text NOT NULL DEFAULT 'manual',
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    result_count integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracking_runs_brand_completed_idx
    ON public.tracking_runs (brand_id, completed_at DESC NULLS LAST);
CREATE INDEX tracking_runs_brand_started_idx
    ON public.tracking_runs (brand_id, started_at DESC);

ALTER TABLE public.tracking_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracking_runs: member select" ON public.tracking_runs
    FOR SELECT USING (
        brand_id IN (
            SELECT b.id
            FROM public.brands b
            JOIN public.profiles p ON p.organization_id = b.organization_id
            WHERE p.id = auth.uid()
        )
    );

GRANT SELECT ON public.tracking_runs TO authenticated;

-- Backfill: a synthetic completed run per brand anchored at its newest
-- result, so the stable-window behavior applies immediately instead of
-- waiting for each brand's next real run. Reads prompt_results only —
-- existing data is untouched.
WITH latest AS (
    SELECT brand_id, max(created_at) AS last_at
    FROM public.prompt_results
    GROUP BY brand_id
)
INSERT INTO public.tracking_runs (brand_id, source, started_at, completed_at, result_count)
SELECT l.brand_id,
       'backfill',
       l.last_at - interval '2 hours',
       l.last_at,
       (SELECT count(*)
          FROM public.prompt_results pr
         WHERE pr.brand_id = l.brand_id
           AND pr.created_at > l.last_at - interval '2 hours')
FROM latest l;
