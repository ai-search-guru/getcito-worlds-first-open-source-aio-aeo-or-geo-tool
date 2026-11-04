-- Add position_n (answers carrying a mention_position) to the per-day
-- buckets of visibility_rate_trend, for the brand and each competitor.
--
-- The trend chart is switching from "that day's score" points to a rolling
-- window (each day's point = the score over the trailing selected window),
-- so the line's last point always equals the headline card exactly. Rolling
-- position factors need the weighted average across days:
--   rolling_pf = Σ(position_factor_d × position_n_d) / Σ(position_n_d)
-- which requires the per-day weight. Purely additive JSON keys — existing
-- consumers are unaffected.

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
    SELECT pr.prompt_id, pr.mention_count, pr.citation_count, pr.mention_position,
           pr.competitor_mentions,
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
                                                             AS visible_prompts,
           COUNT(*)                                          AS answers,
           COUNT(*) FILTER (WHERE mention_count > 0)         AS mention_answers,
           COUNT(*) FILTER (WHERE citation_count > 0)        AS citation_answers,
           AVG(1.0 / mention_position)
             FILTER (WHERE mention_position IS NOT NULL)     AS position_factor,
           COUNT(*) FILTER (WHERE mention_position IS NOT NULL)
                                                             AS position_n
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
                                      AS visible_prompts,
           COUNT(*) FILTER (
             WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0)
                                      AS mention_answers,
           COUNT(*) FILTER (
             WHERE COALESCE((cm.value->>'citation_count')::int, 0) > 0)
                                      AS citation_answers,
           AVG(1.0 / (cm.value->>'mention_position')::numeric)
             FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                      AS position_factor,
           COUNT(*) FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                      AS position_n
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
      'day',              bd.day,
      'prompt_count',     bd.prompt_count,
      'visible_prompts',  bd.visible_prompts,
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'position_n',       bd.position_n,
      'competitors', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  cd.visible_prompts,
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor,
                  'position_n',       cd.position_n))
         FROM comp_daily cd WHERE cd.day = bd.day),
        '[]'::jsonb)
    ) ORDER BY bd.day),
    '[]'::jsonb)
  FROM brand_daily bd;
$$;

GRANT EXECUTE ON FUNCTION public.visibility_rate_trend(uuid, text, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated;
