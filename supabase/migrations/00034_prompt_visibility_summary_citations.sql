-- Add citation totals to the All Prompts visibility summary (#529).
--
-- The return type changes, so PostgreSQL requires the existing function to
-- be dropped before it can be recreated with the additional column.

DROP FUNCTION public.prompt_visibility_summaries(uuid, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL
)
RETURNS TABLE (
  prompt_id       uuid,
  avg_visibility  double precision,
  total_mentions  bigint,
  total_citations bigint,
  runs            bigint,
  last_run_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.prompt_id,
         AVG(COALESCE(pr.visibility_score, 0))::double precision AS avg_visibility,
         COALESCE(SUM(pr.mention_count), 0)::bigint              AS total_mentions,
         COALESCE(SUM(pr.citation_count), 0)::bigint             AS total_citations,
         COUNT(*)::bigint                                        AS runs,
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
