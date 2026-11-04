-- ── Visibility Rate KPI ───────────────────────────────────────────────────────
--
-- Headline metric change on Insights: the raw average visibility score over
-- ALL results reads near zero for most brands (every answer the brand does
-- not appear in contributes a 0), which buries the two numbers users act on:
-- how OFTEN the brand shows up, and how GOOD it looks when it does. This RPC
-- returns the "appeared" side of that split for the filtered window:
--
--   visible_prompts        distinct prompts with >= 1 answer mentioning or
--                          citing the brand (numerator of Visibility Rate;
--                          the denominator is tracked_prompt_count, 00024)
--   visible_results        result rows where the brand appeared
--   sum_visibility_visible sum of visibility_score over those rows, so the
--                          caller derives "avg score when visible"
--
-- Filters mirror tracked_prompt_count / insights_aggregates exactly — same
-- window, same #155 chatgpt-shopping exclusion — so the KPI row stays
-- internally consistent.
--
-- SECURITY INVOKER (00014 convention): RLS on prompt_results/prompts scopes
-- the caller to their own org's data.

CREATE OR REPLACE FUNCTION public.visible_prompt_stats(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'visible_prompts',
      COUNT(DISTINCT pr.prompt_id)
        FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0),
    'visible_results',
      COUNT(*) FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0),
    'sum_visibility_visible',
      COALESCE(SUM(pr.visibility_score)
        FILTER (WHERE pr.mention_count > 0 OR pr.citation_count > 0), 0)
  )
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND pr.prompt_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    AND (p_platform  IS NULL OR pr.platform    = p_platform)
    AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
    AND (p_region    IS NULL OR pr.region      = p_region)
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
    AND (p_topic_id  IS NULL OR EXISTS (
           SELECT 1 FROM public.prompts p
           WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
$$;

GRANT EXECUTE ON FUNCTION public.visible_prompt_stats(
  uuid, text, text[], text, timestamptz, timestamptz, uuid
) TO authenticated;
