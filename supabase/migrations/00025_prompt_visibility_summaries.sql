-- ── Per-prompt visibility summaries (#472 / prompts first-load fix) ──────────
--
-- The All Prompts tab's health columns were computed by fetching the brand's
-- raw prompt_results window into JS: un-paginated, so PostgREST silently
-- capped it at 1000 rows (wrong numbers on busy brands — same family as
-- #430/#464/#450) and the transfer cost slowed the page's first load. One
-- GROUP BY returns at most one row per prompt instead.
--
-- SECURITY INVOKER (00014 convention); excludes chatgpt-shopping (#155) to
-- match every other analytical surface.

CREATE OR REPLACE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id      uuid,
  avg_visibility double precision,
  total_mentions bigint,
  runs           bigint,
  last_run_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.prompt_id,
         AVG(COALESCE(pr.visibility_score, 0))::double precision AS avg_visibility,
         COALESCE(SUM(pr.mention_count), 0)::bigint              AS total_mentions,
         COUNT(*)::bigint                                        AS runs,
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;
