-- ── Insights filter options (#458) ───────────────────────────────────────────
--
-- The Insights page's region / AI-model filter dropdowns used to derive their
-- options from the "Prompt Results by Topic" tree's 1500-row fetch. With that
-- tree removed, this returns the same option sets from one DISTINCT scan
-- instead of shipping full result rows to the client.
--
-- SECURITY INVOKER (00014 convention); excludes chatgpt-shopping (#155) to
-- match every other analytical surface. NULL/empty values are dropped exactly
-- like the old client-side filter(Boolean) did.

CREATE OR REPLACE FUNCTION public.insights_filter_options(p_brand_id uuid)
RETURNS TABLE (
  regions text[],
  models  text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT array_agg(DISTINCT pr.region ORDER BY pr.region)
      FROM public.prompt_results pr
      WHERE pr.brand_id = p_brand_id
        AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
        AND pr.region IS NOT NULL AND pr.region <> ''
    ), '{}') AS regions,
    COALESCE((
      SELECT array_agg(DISTINCT pr.model_used ORDER BY pr.model_used)
      FROM public.prompt_results pr
      WHERE pr.brand_id = p_brand_id
        AND pr.platform <> 'chatgpt-shopping'
        AND pr.model_used IS NOT NULL AND pr.model_used <> ''
    ), '{}') AS models
$$;

GRANT EXECUTE ON FUNCTION public.insights_filter_options(uuid)
  TO authenticated;
