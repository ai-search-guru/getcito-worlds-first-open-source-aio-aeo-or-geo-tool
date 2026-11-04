-- AI Visibility Score compute layer.
--
-- The score is a weighted blend of three answer-level components, computed
-- over any answer set (brand-wide, per prompt, per topic, per day):
--
--   mention rate     share of answers naming the entity (word-boundary
--                    detection at parse time, URL-stripped)
--   citation rate    share of answers linking a source on the entity's domain
--   position factor  mean of 1/mention_position over answers that name it
--                    (being named first counts more than being named fifth)
--
-- The blend weights live in ONE place per runtime
-- (frontend/src/lib/visibilityScore.ts, mirrored in
-- backend/src/config/visibilityScore.js) — these RPCs return raw
-- components only, so recalibrating weights never needs a migration.
--
-- Three changes, one layer:
--   1. NEW ai_visibility_aggregates — brand + per-competitor components in
--      one call (shared denominator, live competitors only per 00035).
--   2. prompt_visibility_summaries gains the three components per prompt
--      (return type changes, so DROP + CREATE as in 00034/00037).
--   3. visibility_rate_trend gains per-day components for the brand and
--      each competitor, keeping its existing keys untouched.
--
-- chatgpt-shopping stays excluded everywhere (#155).

-- ── 1. ai_visibility_aggregates ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ai_visibility_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.mention_count, pr.citation_count, pr.mention_position, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  brand_agg AS (
    SELECT
      COUNT(*)                                              AS answers,
      COUNT(*) FILTER (WHERE mention_count > 0)             AS mention_answers,
      COUNT(*) FILTER (WHERE citation_count > 0)            AS citation_answers,
      AVG(1.0 / mention_position)
        FILTER (WHERE mention_position IS NOT NULL)         AS position_factor
    FROM filtered
  ),
  comp_agg AS (
    SELECT
      cm.value->>'competitor_id'                            AS competitor_id,
      MAX(cm.value->>'name')                                AS name,
      COUNT(*) FILTER (
        WHERE COALESCE((cm.value->>'mention_count')::int, 0) > 0)
                                                            AS mention_answers,
      COUNT(*) FILTER (
        WHERE COALESCE((cm.value->>'citation_count')::int, 0) > 0)
                                                            AS citation_answers,
      AVG(1.0 / (cm.value->>'mention_position')::numeric)
        FILTER (WHERE (cm.value->>'mention_position') IS NOT NULL)
                                                            AS position_factor
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
      AND EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id::text = cm.value->>'competitor_id'
          AND c.brand_id = p_brand_id
      )
    GROUP BY cm.value->>'competitor_id'
  )
  SELECT jsonb_build_object(
    'answers',          b.answers,
    'mention_answers',  b.mention_answers,
    'citation_answers', b.citation_answers,
    'position_factor',  b.position_factor,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    ca.competitor_id,
                'name',             ca.name,
                'mention_answers',  ca.mention_answers,
                'citation_answers', ca.citation_answers,
                'position_factor',  ca.position_factor)
              ORDER BY ca.mention_answers DESC, ca.competitor_id)
       FROM comp_agg ca),
      '[]'::jsonb)
  )
  FROM brand_agg b;
$$;

GRANT EXECUTE ON FUNCTION public.ai_visibility_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated;

-- ── 2. prompt_visibility_summaries + components ──────────────────────────────

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
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz)
  TO authenticated;

-- ── 3. visibility_rate_trend + per-day components ────────────────────────────

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
             FILTER (WHERE mention_position IS NOT NULL)     AS position_factor
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
                                      AS position_factor
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
      'competitors', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  cd.visible_prompts,
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor))
         FROM comp_daily cd WHERE cd.day = bd.day),
        '[]'::jsonb)
    ) ORDER BY bd.day),
    '[]'::jsonb)
  FROM brand_daily bd;
$$;

GRANT EXECUTE ON FUNCTION public.visibility_rate_trend(uuid, text, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated;
