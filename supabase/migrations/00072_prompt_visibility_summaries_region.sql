-- Let the per-prompt health column answer "…in which location?" (#691).
--
-- Prompts can now be tracked in several places at once, so a single blended
-- number per prompt hides the thing multi-location tracking was bought for:
-- a prompt can be strong at home and invisible in Germany, and the All
-- Prompts table averaged the two into one figure with no way to split them.
-- Every other analytical surface already takes a region — Insights, the
-- citation RPCs, the KPI cards — this one was the gap.
--
-- The parameter is appended with a NULL default, and NULL keeps the previous
-- whole-brand behaviour exactly, so callers that don't pass it are unchanged.
--
-- The 3-argument signature is dropped rather than left in place: with both
-- installed, a 3-argument call would match the old function AND the new one
-- through its default, which Postgres rejects as ambiguous. Dropping it is
-- safe across the deploy window because PostgREST passes arguments by name —
-- the running app's 3-name call binds to the new function and takes the
-- default.
DROP FUNCTION IF EXISTS public.prompt_visibility_summaries(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to   timestamptz DEFAULT NULL,
  p_region    text DEFAULT NULL
)
RETURNS TABLE (
  prompt_id              uuid,
  avg_visibility         double precision,
  avg_visibility_visible double precision,
  total_mentions         bigint,
  total_citations        bigint,
  runs                   bigint,
  visible_runs           bigint,
  mention_answers        bigint,
  citation_answers       bigint,
  position_factor        double precision,
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
         COUNT(*) FILTER (WHERE pr.mention_count > 0)::bigint    AS mention_answers,
         COUNT(*) FILTER (WHERE pr.citation_count > 0)::bigint   AS citation_answers,
         AVG(1.0 / pr.mention_position)
           FILTER (WHERE pr.mention_position IS NOT NULL)
           ::double precision                                    AS position_factor,
         MAX(pr.created_at)                                      AS last_run_at
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
    AND (p_region    IS NULL OR pr.region = p_region)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION
  public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text)
  TO authenticated;

COMMENT ON FUNCTION
  public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text) IS
  'Per-prompt visibility/mention aggregates for the All Prompts table. p_region scopes to one tracked location (#691); NULL blends every location, as before.';
