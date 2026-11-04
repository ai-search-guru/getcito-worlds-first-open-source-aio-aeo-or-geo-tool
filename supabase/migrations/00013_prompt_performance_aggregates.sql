-- DB-side aggregation for prompt-level performance (#139).
--
-- Excludes `platform = 'chatgpt-shopping'` to ensure ChatGPT Shopping rows
-- (which use different models and scoring dynamics) do not skew the organic
-- visibility and mentions of the brand's prompts.
-- SECURITY DEFINER allows the RPC to run with elevated privileges while Node
-- data functions enforce tenant membership.

CREATE OR REPLACE FUNCTION public.prompt_performance_aggregates(
  p_brand_id   uuid,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.prompt_id, pr.visibility_score, pr.mention_count, pr.citation_count, pr.competitor_mentions
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  aggregated AS (
    SELECT
      f.prompt_id,
      COUNT(*)                                                                AS result_count,
      COALESCE(SUM(f.visibility_score), 0)                                    AS sum_visibility,
      COALESCE(SUM(f.mention_count), 0)::bigint                               AS total_mentions,
      COALESCE(SUM(f.citation_count), 0)::bigint                              AS total_citations,
      COALESCE(SUM((
        SELECT COALESCE(SUM((cm.value->>'visibility_score')::numeric), 0)
        FROM jsonb_array_elements(COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
      )), 0)                                                                  AS comp_sum_visibility,
      COALESCE(SUM((
        SELECT COUNT(*)
        FROM jsonb_array_elements(COALESCE(f.competitor_mentions, '[]'::jsonb)) cm
      )), 0)::bigint                                                          AS comp_count
    FROM filtered f
    GROUP BY f.prompt_id
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'prompt_id',            a.prompt_id,
                'prompt_text',          p.text,
                'topic_name',           t.name,
                'result_count',         a.result_count,
                'sum_visibility',       a.sum_visibility,
                'total_mentions',       a.total_mentions,
                'total_citations',      a.total_citations,
                'comp_sum_visibility',  a.comp_sum_visibility,
                'comp_count',           a.comp_count
              )
            )
     FROM aggregated a
     JOIN public.prompts p ON p.id = a.prompt_id
     LEFT JOIN public.topics t ON t.id = p.topic_id),
    '[]'::jsonb);
$$;

GRANT EXECUTE ON FUNCTION public.prompt_performance_aggregates(uuid, text[], text, timestamptz, timestamptz, uuid)
  TO authenticated, service_role;
