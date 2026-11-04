-- Add prompt-level visibility-rate inputs to the All Prompts summary.
--
-- The Visibility column averaged visibility_score across ALL runs, so runs
-- where the brand didn't appear dragged heavily-mentioned prompts down to
-- misleading single digits (same dilution the Insights headline had before
-- the Visibility Rate switch in #490/#493). The table now needs:
--
--   visible_runs           runs with >= 1 brand mention/citation — the
--                          numerator of the prompt-level rate (runs is the
--                          denominator), matching the run-visibility rule
--                          used by insights_aggregates / topic detail
--   avg_visibility_visible average score across visible runs only, for the
--                          "how strong when it shows up" tooltip
--
-- avg_visibility (all-runs average) is kept for compatibility.
--
-- The return type changes, so PostgreSQL requires the existing function to
-- be dropped before it can be recreated with the additional columns.

DROP FUNCTION public.prompt_visibility_summaries(uuid, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id              uuid,
  avg_visibility         double precision,
  avg_visibility_visible double precision,
  total_mentions         bigint,
  total_citations        bigint,
  runs                   bigint,
  visible_runs           bigint,
  last_run_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.prompt_id,
         AVG(COALESCE(pr.visibility_score, 0))::double precision AS avg_visibility,
         AVG(COALESCE(pr.visibility_score, 0))
           FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0)
           ::double precision                                    AS avg_visibility_visible,
         COALESCE(SUM(pr.mention_count), 0)::bigint              AS total_mentions,
         COALESCE(SUM(pr.citation_count), 0)::bigint             AS total_citations,
         COUNT(*)::bigint                                        AS runs,
         COUNT(*) FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0)::bigint
                                                                 AS visible_runs,
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;
