-- Cloro pending-task queue (#652) — backfills DDL that was only ever applied
-- to the hosted database and never committed here, so a fresh install created
-- every other table and then failed on this one:
--
--   PGRST205: Could not find the table 'public.cloro_pending_tasks'
--
-- The table is a transient submit-queue: the tracking worker inserts a row per
-- task handed to the scraper, /cloro/callback deletes it when the result
-- arrives, and cleanupStalePendingTasks sweeps whatever the provider never
-- delivered. It holds no history — a fresh install starting empty is correct.
--
-- Guarded with IF NOT EXISTS throughout so databases that already have the
-- table (every deployment predating this file) apply it as a no-op.

CREATE TABLE IF NOT EXISTS public.cloro_pending_tasks (
    task_id text PRIMARY KEY,
    prompt_id uuid NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    scraper_id text NOT NULL,
    region text,
    submitted_at timestamptz NOT NULL DEFAULT now()
);

-- brand_id: the drain loop polls "what is still pending for this brand" on
-- every tick of a run. submitted_at: the stale sweep and the ghost-task exit
-- both filter by age (#687).
CREATE INDEX IF NOT EXISTS idx_cloro_pending_tasks_brand_id
    ON public.cloro_pending_tasks (brand_id);
CREATE INDEX IF NOT EXISTS idx_cloro_pending_tasks_submitted_at
    ON public.cloro_pending_tasks (submitted_at);

-- RLS on with no policies: only the service role touches this table, and it
-- bypasses RLS. Anything reaching it through an anon/authenticated key gets
-- nothing, which is the intent — task ids are provider-side handles.
ALTER TABLE public.cloro_pending_tasks ENABLE ROW LEVEL SECURITY;
