-- Daily Visibility Rate series for the brand and each live competitor.
--
-- Powers the Insights "AI Visibility — Brand vs Competitors" trend chart:
-- one line per entity, each day's value being the prompt-level rate for
-- that day. Rules match the rest of the rate family:
--   - a prompt is "visible" on a day when any of its runs that day carries
--     a brand mention or citation (00027 semantics)
--   - a competitor is "visible" on a prompt when its mention entry has a
--     mention, citation or score (00028 semantics)
--   - competitor rows only count while the competitor still exists (00035)
--   - the denominator is the BRAND's per-day distinct prompt count, shared
--     by every entity so lines are comparable (getCompetitorComparison rule)
--   - chatgpt-shopping excluded (#155)
--
-- Days are UTC buckets. Rates are computed by the caller (visible/prompts),
-- keeping all rounding in one place (the web action).

CREATE OR REPLACE FUNCTION public.visibility_rate_trend(
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
  WITH filtered AS (
    SELECT pr.prompt_id, pr.mention_count, pr.citation_count, pr.competitor_mentions,
           (pr.created_at AT TIME ZONE 'UTC')::date AS day
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_daily AS (
    SELECT day,
           COUNT(DISTINCT prompt_id)                         AS prompt_count,
           COUNT(DISTINCT prompt_id)
             FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                             AS visible_prompts
    FROM filtered
    GROUP BY day
  ),
  comp_daily AS (
    SELECT f.day,
           cm.value->>'competitor_id' AS competitor_id,
           COUNT(DISTINCT f.prompt_id)
             FILTER (WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'citation_count')::int, 0) > 0
                        OR COALESCE((cm.value->>'visibility_score')::numeric, 0) > 0)
                                      AS visible_prompts
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
    GROUP BY f.day, cm.value->>'competitor_id'
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'day',             bd.day,
      'prompt_count',    bd.prompt_count,
      'visible_prompts', bd.visible_prompts,
      'competitors', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'competitor_id',   cd.competitor_id,
                  'visible_prompts', cd.visible_prompts))
         FROM comp_daily cd WHERE cd.day = bd.day),
        '[]'::jsonb)
    ) ORDER BY bd.day),
    '[]'::jsonb)
  FROM brand_daily bd;
$$;

GRANT EXECUTE ON FUNCTION public.visibility_rate_trend(uuid, text, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated;
