-- prompt_visibility_summaries — redundant re-declaration (#713).
--
-- This migration adds nothing. Migration 00041 already gave the function its
-- p_date_to bound, for the Daily Pulse movers highlight, and the body below
-- is byte-identical to the one 00041 installs.
--
-- It was written on the mistaken belief that the hosted database carried a
-- three-argument version no migration produced. It did carry one — from
-- 00041, which a truncated search had hidden. There was no drift, and nothing
-- here repairs anything.
--
-- Kept rather than deleted: it is already applied to the hosted database and
-- recorded in schema_migrations, and removing an applied migration is a worse
-- problem than an inert one. Both signatures are dropped conditionally, so it
-- is a no-op wherever it runs. Do not copy this file as a pattern.

DROP FUNCTION IF EXISTS public.prompt_visibility_summaries(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.prompt_visibility_summaries(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to   timestamptz DEFAULT NULL
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
    AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
  GROUP BY pr.prompt_id
$$;

GRANT EXECUTE ON FUNCTION public.prompt_visibility_summaries(uuid, timestamptz, timestamptz)
  TO authenticated;
