-- #155 — Brand-level "Shopping mode" toggle + ChatGPT Shopping isolation
--
-- Two small additions on top of the existing schema, plus a refresh of the
-- insights/visibility-trend RPCs so they exclude `platform = 'chatgpt-shopping'`
-- from brand-level aggregations.
--
-- 1. `brands.shopping_mode_enabled` — bool, default false.
--    Per-brand opt-in. Drives the Shopping sidebar entry's visibility (if
--    any brand in the org has it on) and seeds new prompts under that brand
--    with the chatgpt-shopping platform.
--
-- 2. `prompt_results.inline_products` — jsonb, default '[]'.
--    Mirrors the existing `shopping_cards` column. ChatGPT Shopping's Cloro
--    response returns both `shoppingCards` and `inlineProducts`; the cards go
--    to the shared column, the inline products land here for the Shopping
--    page to consume.
--
-- 3. RPC refresh — the three `*_aggregates` functions in
--    `00006_insights_aggregates.sql` and `visibility_trend_aggregates` in
--    `00008_visibility_trend_aggregates.sql` now exclude
--    `platform = 'chatgpt-shopping'` rows. Reason: ChatGPT Shopping answers
--    come from a different model (`gpt-5-3-mini`) — its visibility_score is
--    not comparable to a normal ChatGPT text response, so mixing those rows
--    into Insights would skew brand visibility/mentions/citations. Other
--    providers' shopping cards are a side-payload of the same model's
--    answer, so their rows stay in Insights.
--
--    The Shopping dashboard is the only surface that consumes
--    `platform = 'chatgpt-shopping'` rows — it reads from the normalized
--    `prompt_result_shopping_cards` table and is not affected.

-- ── 1. brands.shopping_mode_enabled ───────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS shopping_mode_enabled boolean NOT NULL DEFAULT false;


-- ── 2. prompt_results.inline_products ─────────────────────────────────────
ALTER TABLE public.prompt_results
  ADD COLUMN IF NOT EXISTS inline_products jsonb NOT NULL DEFAULT '[]'::jsonb;


-- ── 3. RPC refresh — exclude chatgpt-shopping from Insights aggregates ────
--
-- All four functions are `CREATE OR REPLACE` so this re-runs cleanly.
-- The only change in each is the new `AND pr.platform <> 'chatgpt-shopping'`
-- predicate inside the `filtered` CTE.

CREATE OR REPLACE FUNCTION public.insights_aggregates(
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
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.sentiment, pr.model_used, pr.created_at
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
  totals AS (
    SELECT
      COUNT(*)                                                AS total_results,
      COALESCE(SUM(visibility_score), 0)                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)                         AS total_mentions,
      COALESCE(SUM(citation_count), 0)                        AS total_citations,
      COUNT(*) FILTER (WHERE sentiment = 'positive')          AS positive_count,
      MAX(created_at)                                         AS last_checked_at
    FROM filtered
  ),
  by_model AS (
    SELECT
      COALESCE(model_used, 'unknown') AS model_used,
      SUM(visibility_score)           AS sum_visibility,
      COUNT(*)                        AS result_count
    FROM filtered
    GROUP BY COALESCE(model_used, 'unknown')
  )
  SELECT jsonb_build_object(
    'total_results',     t.total_results,
    'sum_visibility',    t.sum_visibility,
    'total_mentions',    t.total_mentions,
    'total_citations',   t.total_citations,
    'positive_count',    t.positive_count,
    'last_checked_at',   t.last_checked_at,
    'by_model', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              ORDER BY bm.result_count DESC, bm.model_used)
       FROM by_model bm),
      '[]'::jsonb)
  )
  FROM totals t;
$$;


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
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
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
      COALESCE(SUM(citation_count), 0)::bigint          AS total_citations
    FROM filtered
  ),
  by_brand_provider AS (
    SELECT
      model_used,
      platform,
      SUM(visibility_score)  AS sum_visibility,
      COUNT(*)               AS row_count
    FROM filtered
    GROUP BY model_used, platform
  ),
  mentions_flat AS (
    SELECT
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
      SUM(cm_citation_count)::bigint        AS total_citations
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
      COUNT(*)               AS row_count
    FROM mentions_flat
    GROUP BY model_used, platform, competitor_id
  )
  SELECT jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'by_competitor', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'competitor_id',    bc.competitor_id,
                'name',             bc.name,
                'sum_visibility',   bc.sum_visibility,
                'row_count',        bc.row_count,
                'total_mentions',   bc.total_mentions,
                'total_citations',  bc.total_citations)
              ORDER BY bc.row_count DESC, bc.competitor_id)
       FROM by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',      bbp.model_used,
                'platform',        bbp.platform,
                'sum_visibility',  bbp.sum_visibility,
                'row_count',       bbp.row_count)
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
                'row_count',        bcp.row_count)
              ORDER BY bcp.platform NULLS LAST, bcp.model_used NULLS LAST, bcp.competitor_id)
       FROM by_competitor_provider bcp),
      '[]'::jsonb)
  )
  FROM brand_totals b;
$$;


CREATE OR REPLACE FUNCTION public.visibility_trend_aggregates(
  p_brand_id     uuid,
  p_models       text[]       DEFAULT NULL,
  p_region       text         DEFAULT NULL,
  p_date_from    timestamptz  DEFAULT NULL,
  p_date_to      timestamptz  DEFAULT NULL,
  p_topic_id     uuid         DEFAULT NULL,
  p_granularity  text         DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.created_at, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  buckets AS (
    SELECT
      to_char(
        date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
        'YYYY-MM-DD'
      ) AS bucket_date,
      COUNT(*)                                                                AS row_count,
      COALESCE(SUM(visibility_score), 0)                                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint                                 AS sum_mentions,
      COALESCE(SUM(citation_count), 0)::bigint                                AS sum_citations,
      COALESCE(SUM((
        SELECT COALESCE(SUM((cm.value->>'visibility_score')::numeric), 0)
        FROM jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) cm
      )), 0)                                                                  AS comp_sum_visibility,
      COALESCE(SUM((
        SELECT COUNT(*)
        FROM jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) cm
      )), 0)::bigint                                                          AS comp_count
    FROM filtered
    GROUP BY to_char(
      date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
      'YYYY-MM-DD'
    )
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'bucket_date',         b.bucket_date,
                'row_count',           b.row_count,
                'sum_visibility',      b.sum_visibility,
                'sum_mentions',        b.sum_mentions,
                'sum_citations',       b.sum_citations,
                'comp_sum_visibility', b.comp_sum_visibility,
                'comp_count',          b.comp_count
              )
              ORDER BY b.bucket_date)
     FROM buckets b),
    '[]'::jsonb);
$$;


CREATE OR REPLACE FUNCTION public.share_of_voice_aggregates(
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
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      pr.mention_count,
      pr.model_used,
      pr.platform,
      pr.created_at,
      pr.competitor_mentions,
      COALESCE((
        SELECT SUM((cm.value->>'mention_count')::int)
        FROM jsonb_array_elements(
               COALESCE(pr.competitor_mentions, '[]'::jsonb)) cm
      ), 0)::int AS row_competitor_mentions
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
  totals AS (
    SELECT
      COALESCE(SUM(mention_count), 0)::bigint            AS total_brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint  AS total_competitor_mentions
    FROM filtered
  ),
  by_platform AS (
    SELECT
      model_used,
      platform,
      COALESCE(SUM(mention_count), 0)::bigint            AS brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint  AS competitor_mentions
    FROM filtered
    GROUP BY model_used, platform
  ),
  by_day AS (
    SELECT
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')  AS day,
      COALESCE(SUM(mention_count), 0)::bigint               AS brand_mentions,
      COALESCE(SUM(row_competitor_mentions), 0)::bigint     AS competitor_mentions
    FROM filtered
    GROUP BY to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  )
  SELECT jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              ORDER BY bp.platform NULLS LAST, bp.model_used NULLS LAST)
       FROM by_platform bp),
      '[]'::jsonb),
    'by_day', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              ORDER BY bd.day)
       FROM by_day bd),
      '[]'::jsonb)
  )
  FROM totals t;
$$;
