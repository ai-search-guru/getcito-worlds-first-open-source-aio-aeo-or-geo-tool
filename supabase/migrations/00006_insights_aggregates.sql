-- Phase-1 perf fix for /dashboard/insights (#93)
--
-- Today the insights server actions in frontend/src/lib/actions/tracking.ts pull
-- `SELECT *` from prompt_results and aggregate in JS. Each row carries the
-- full AI response text (kilobytes) + JSONB citations/competitor_mentions,
-- and for a brand with thousands of results the page transfers hundreds of
-- MB on every load + does big reducers in Node memory.
--
-- This migration:
--   1. Adds a composite (brand_id, created_at DESC) index — the exact shape
--      every insights filter needs but the only existing indexes are
--      single-column.
--   2. Adds three RPC functions that perform the aggregation server-side and
--      return only the totals + small grouped slices. Callers can compute
--      the same final numbers from these outputs with bit-for-bit parity
--      against the existing JS reducers (parity test in
--      scripts/parity-check-insights.ts).
--
-- Functions intentionally return RAW SUMS + COUNTS (not pre-divided averages)
-- so the final round happens in JS exactly as it does today — guarantees the
-- displayed dashboard numbers don't drift by even ±1 from a `Math.round`
-- half-rule mismatch between JS and Postgres.
--
-- Security model matches the existing get_latest_prompt_results functions:
-- SECURITY DEFINER — server actions verify brand-belongs-to-org access at
-- the route layer before calling. Adding a defensive org check inside the
-- function is a separate hygiene task tracked elsewhere.

-- ── Index ─────────────────────────────────────────────────────────────────
-- Composite covers WHERE brand_id = ? AND created_at BETWEEN ? AND ?
-- ORDER BY created_at DESC — single seek + sequential index walk instead of
-- index scan + heap filter + sort. ~11k rows in prod today; CREATE INDEX
-- without CONCURRENTLY locks writes for milliseconds. CONCURRENTLY would
-- avoid the lock but cannot run inside a transaction, and Supabase wraps
-- migrations in one. Plain CREATE is the right call at this row count.
CREATE INDEX IF NOT EXISTS idx_prompt_results_brand_created
  ON public.prompt_results USING btree (brand_id, created_at DESC);


-- ── insights_summary ──────────────────────────────────────────────────────
-- Replaces getInsightsSummary's `select('*') + JS reduce` over the filtered
-- row set. Returns one JSONB object with raw sums + counts + the per-model
-- breakdown shape the page needs.
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
    -- ORDER BY inside jsonb_agg keeps the response stable across calls so the
    -- platform list / chart doesn't jitter. jsonb_agg is otherwise free to
    -- return rows in any order. Same rationale for the other jsonb_aggs
    -- below.
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


-- ── competitor_aggregates ─────────────────────────────────────────────────
-- Replaces getCompetitorComparison's `select('*') + JS reduce`. Unwraps the
-- competitor_mentions JSONB once via LATERAL, then groups four ways:
--   * brand totals    — overall vis/mentions/citations
--   * by_competitor   — per-competitor flat row
--   * by_brand_provider     — brand vis grouped by (model_used, platform)
--   * by_competitor_provider — competitor vis grouped by (model_used, platform, competitor)
-- The provider mapping (resolveProvider) stays in JS so we don't ship a
-- duplicate lookup table in SQL that has to be kept in sync.
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


-- ── share_of_voice_aggregates ─────────────────────────────────────────────
-- Replaces getShareOfVoiceData's `select('*') + JS reduce`. Returns totals
-- plus per (model_used, platform) and per-day slices. The provider mapping
-- (resolveProvider) stays in JS so we don't have to keep a SQL copy of that
-- lookup in sync as new engines land.
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
      -- Pre-sum the competitor mention counts for each row so we don't
      -- re-unwrap the JSONB array three times below.
      COALESCE((
        SELECT SUM((cm.value->>'mention_count')::int)
        FROM jsonb_array_elements(
               COALESCE(pr.competitor_mentions, '[]'::jsonb)) cm
      ), 0)::int AS row_competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
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
      -- JS does `created_at.slice(0,10)` on the ISO string, which yields the
      -- UTC date. Mirror that exactly so trend buckets line up.
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


-- ── Grants ────────────────────────────────────────────────────────────────
-- Match the existing get_latest_prompt_results pattern: authenticated +
-- service_role can execute. Anon stays out (no anon access to insights).
GRANT EXECUTE ON FUNCTION public.insights_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.competitor_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.share_of_voice_aggregates(uuid, text, text[], text, timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;
