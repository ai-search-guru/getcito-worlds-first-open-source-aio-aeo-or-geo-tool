-- ── Per-provider prompt counts in competitor_aggregates ──────────────────────
--
-- Second half of the visibility-rate leaderboard switch (00028): the
-- "AI Visibility — Brand vs Competitors" provider chart still plotted the
-- all-rows score average per provider, so its bars contradicted the rate
-- numbers in the leaderboard next to it. The provider groups now also carry
-- distinct-prompt counts so the chart can plot the same prompt-level rate:
--
--   by_brand_provider[].prompt_count       distinct prompts in the group
--   by_brand_provider[].visible_prompts    …with >= 1 brand mention/citation
--   by_competitor_provider[].visible_prompts
--                                          …where that competitor scored
--
-- Groups stay keyed by (model_used, platform) — the provider mapping lives
-- in JS on purpose. Summing DISTINCT counts across two engines of the same
-- provider counts a shared prompt once per engine, in the numerator and the
-- denominator alike, so the folded rate stays unbiased.
--
-- SECURITY INVOKER kept from 00014.

CREATE OR REPLACE FUNCTION public.competitor_aggregates(
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
    SELECT pr.prompt_id, pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.model_used, pr.platform, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
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
  brand_totals AS (
    SELECT
      COUNT(*)                                          AS row_count,
      COALESCE(SUM(visibility_score), 0)                AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint           AS total_mentions,
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations,
      COUNT(DISTINCT prompt_id)                         AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                                                        AS visible_prompts
    FROM filtered
  ),
  by_brand_provider AS (
    SELECT
      model_used,
      platform,
      SUM(visibility_score)  AS sum_visibility,
      COUNT(*)               AS row_count,
      COUNT(DISTINCT prompt_id) AS prompt_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE mention_count > 0 OR citation_count > 0)
                             AS visible_prompts
    FROM filtered
    GROUP BY model_used, platform
  ),
  mentions_flat AS (
    SELECT
      f.prompt_id,
      f.model_used,
      f.platform,
      cm.value->>'competitor_id'                       AS competitor_id,
      cm.value->>'name'                                AS competitor_name,
      (cm.value->>'visibility_score')::numeric         AS cm_visibility,
      COALESCE((cm.value->>'mention_count')::int, 0)   AS cm_mention_count,
      COALESCE((cm.value->>'citation_count')::int, 0)  AS cm_citation_count
    FROM filtered f,
         LATERAL jsonb_array_elements(
           COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
    WHERE cm.value ? 'competitor_id'
  ),
  by_competitor AS (
    SELECT
      competitor_id,
      MAX(competitor_name)                  AS name,
      SUM(cm_visibility)                    AS sum_visibility,
      COUNT(*)                              AS row_count,
      SUM(cm_mention_count)::bigint         AS total_mentions,
      SUM(cm_citation_count)::bigint        AS total_citations,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                                            AS visible_prompts
    FROM mentions_flat
    GROUP BY competitor_id
  ),
  by_competitor_provider AS (
    SELECT
      model_used,
      platform,
      competitor_id,
      MAX(competitor_name)   AS competitor_name,
      SUM(cm_visibility)     AS sum_visibility,
      COUNT(*)               AS row_count,
      COUNT(DISTINCT prompt_id)
        FILTER (WHERE cm_mention_count > 0
                   OR cm_citation_count > 0
                   OR COALESCE(cm_visibility, 0) > 0)
                             AS visible_prompts
    FROM mentions_flat
    GROUP BY model_used, platform, competitor_id
  )
  SELECT jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations,
                'visible_prompts',  bc.visible_prompts)
              ORDER BY bc.row_count DESC, bc.competitor_id)
       FROM by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',       bbp.model_used,
                'platform',         bbp.platform,
                'sum_visibility',   bbp.sum_visibility,
                'row_count',        bbp.row_count,
                'prompt_count',     bbp.prompt_count,
                'visible_prompts',  bbp.visible_prompts)
              ORDER BY bbp.platform NULLS LAST, bbp.model_used NULLS LAST)
       FROM by_brand_provider bbp),
      '[]'::jsonb),
    'by_competitor_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',       bcp.model_used,
                'platform',         bcp.platform,
                'competitor_id',    bcp.competitor_id,
                'competitor_name',  bcp.competitor_name,
                'sum_visibility',   bcp.sum_visibility,
                'row_count',        bcp.row_count,
                'visible_prompts',  bcp.visible_prompts)
              ORDER BY bcp.platform NULLS LAST, bcp.model_used NULLS LAST, bcp.competitor_id)
       FROM by_competitor_provider bcp),
      '[]'::jsonb)
  )
  FROM brand_totals b;
$$;
