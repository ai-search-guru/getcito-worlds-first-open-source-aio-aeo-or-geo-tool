-- DB-side aggregation for the visibility-over-time trend (#96).
--
-- The existing getVisibilityTrend in actions/tracking.ts fetches every
-- prompt_results row in the window and folds by day in JS. That works for
-- one user loading the insights page; it scales badly for an MCP client
-- (e.g. the planned in-product assistant in #94) firing repeated trend
-- queries — each call ships back tens of MB of jsonb rows just to be
-- reduced to a handful of date buckets. This RPC mirrors the structural
-- decisions of 00006 (the insights / competitor / SoV aggregates): one
-- jsonb-shaped return, raw sums + counts, ORDER BY inside jsonb_agg for
-- a stable response, and SECURITY DEFINER for symmetry with the other
-- aggregate RPCs (org-membership enforcement is tracked in #115).
--
-- Granularity is constrained to 'day' or 'week' so the response shape
-- stays predictable for chart-rendering consumers. date_trunc would
-- happily accept 'month' / 'year' too, but exposing those introduces
-- empty-bucket ambiguity at the assistant layer; if a caller wants
-- monthly aggregation today they can group the daily buckets client
-- side.
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
      -- Bucket key always stored as YYYY-MM-DD in UTC so callers can sort
      -- lexicographically and so the JS reducer doesn't have to think about
      -- the server's timezone. For weeks, this is the Monday-start ISO week
      -- per Postgres's date_trunc semantics.
      to_char(
        date_trunc(p_granularity, created_at AT TIME ZONE 'UTC'),
        'YYYY-MM-DD'
      ) AS bucket_date,
      COUNT(*)                                                                AS row_count,
      COALESCE(SUM(visibility_score), 0)                                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)::bigint                                 AS sum_mentions,
      COALESCE(SUM(citation_count), 0)::bigint                                AS sum_citations,
      -- Competitor mentions are unnested per-row, then summed. We sum inside
      -- a correlated subquery so a row with five competitor entries
      -- contributes once per entry rather than five times to the brand
      -- numbers above.
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

GRANT EXECUTE ON FUNCTION
  public.visibility_trend_aggregates(uuid, text[], text, timestamptz, timestamptz, uuid, text)
  TO authenticated, service_role;
