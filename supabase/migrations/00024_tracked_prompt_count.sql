-- ── Tracked Prompts KPI (#457) ────────────────────────────────────────────────
--
-- Distinct prompts that produced tracked results in a filtered window — the
-- period-aware main value of the Insights "Tracked Prompts" KPI card. A plain
-- "total tracked prompts" number was rejected because every card in that row
-- recomputes with the date preset; this count follows the same filters as
-- `insights_aggregates` (00012), including the #155 chatgpt-shopping
-- exclusion, so the KPI row stays internally consistent.
--
-- SECURITY INVOKER (00014 convention): RLS on prompt_results/prompts scopes
-- the caller to their own org's data.

CREATE OR REPLACE FUNCTION public.tracked_prompt_count(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT pr.prompt_id)::integer
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

GRANT EXECUTE ON FUNCTION public.tracked_prompt_count(
  uuid, text, text[], text, timestamptz, timestamptz, uuid
) TO authenticated;
