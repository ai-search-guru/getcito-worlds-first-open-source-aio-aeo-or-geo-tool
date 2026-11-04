CREATE OR REPLACE FUNCTION public.content_opportunity_aggregates(
  p_brand_id uuid,
  p_status text DEFAULT NULL,
  p_impact text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS TABLE (
  avg_score numeric,
  high_impact_count bigint,
  sent_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(AVG(co.opportunity_score), 0) AS avg_score,
    COUNT(*) FILTER (
      WHERE co.impact = 'high'
    ) AS high_impact_count,
    COUNT(*) FILTER (
      WHERE co.status IN ('sent', 'in_progress', 'done')
    ) AS sent_count
  FROM public.content_opportunities co
  WHERE co.brand_id = p_brand_id
    AND (p_status IS NULL OR co.status = p_status)
    AND (p_impact IS NULL OR co.impact = p_impact)
    AND (p_type IS NULL OR co.type = p_type)
    AND (
      p_q IS NULL
      OR co.title ILIKE '%' || p_q || '%'
      OR co.description ILIKE '%' || p_q || '%'
    );
$$;

GRANT EXECUTE ON FUNCTION public.content_opportunity_aggregates(
  uuid,
  text,
  text,
  text,
  text
) TO authenticated;
