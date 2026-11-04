-- Topics overview, aggregated in Postgres (#721).
--
-- The page downloaded the brand's entire 30-day result set to compute twenty
-- table rows: 33 sequential requests, 73 MB of JSON, ~19 s on the largest
-- brand. Two thirds of that was one column — competitor_mentions, averaging
-- eleven entries per row — fetched to derive a single top competitor per
-- topic. The rest was pagination: .range() becomes LIMIT/OFFSET, so page k
-- re-walked k×1000 rows, ~563k buffer touches to read 32k rows once.
--
-- Everything below is what the client was doing in JavaScript, moved to where
-- the data already is. The AI Visibility Score itself stays in JS
-- (lib/visibility-score) over ~20 rows, so the Topics page and the Insights
-- headline keep computing it from one implementation.
--
-- Windows are resolved from now() inside the function rather than passed in:
-- the caller's clock and the database's would otherwise disagree about which
-- answers fall in "the last 7 days", and the page has no reason to care.

CREATE FUNCTION public.topics_overview_aggregates(p_brand_id uuid)
RETURNS TABLE (
  topic_id             uuid,
  answers              bigint,
  mention_answers      bigint,
  citation_answers     bigint,
  pos_sum              double precision,
  pos_n                bigint,
  cur_answers          bigint,
  cur_mention_answers  bigint,
  cur_citation_answers bigint,
  cur_pos_sum          double precision,
  cur_pos_n            bigint,
  prev_answers         bigint,
  prev_mention_answers bigint,
  prev_citation_answers bigint,
  prev_pos_sum         double precision,
  prev_pos_n           bigint,
  total_mentions       bigint,
  total_citations      bigint,
  comp_mentions        bigint,
  active_prompts       bigint,
  visible_prompts      bigint,
  last_run_at          timestamptz,
  competitors          jsonb,
  daily                jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT now() - interval '30 days' AS since_30d,
         now() - interval '7 days'  AS cur_from,
         now() - interval '14 days' AS prev_from,
         -- Start of the 14th day back in UTC, so the earliest bucket the page
         -- draws is complete rather than clipped at the current time of day.
         date_trunc('day', (now() AT TIME ZONE 'UTC') - interval '13 days')
           AT TIME ZONE 'UTC' AS spark_from
),
-- Answers in the window, carrying the topic their prompt belongs to. The
-- prompt_sets join is what scopes prompts to this brand; prompt_results is
-- filtered on brand_id as well, matching what the page did client-side.
rows AS (
  SELECT p.topic_id,
         pr.prompt_id,
         pr.created_at,
         COALESCE(pr.mention_count, 0)  AS mentions,
         COALESCE(pr.citation_count, 0) AS citations,
         pr.mention_position,
         (COALESCE(pr.mention_count, 0) > 0 OR COALESCE(pr.citation_count, 0) > 0) AS visible
  FROM public.prompt_results pr
  JOIN public.prompts p        ON p.id = pr.prompt_id
  JOIN public.prompt_sets ps   ON ps.id = p.prompt_set_id
  CROSS JOIN bounds b
  WHERE pr.brand_id = p_brand_id
    AND ps.brand_id = p_brand_id
    AND p.topic_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND pr.created_at >= b.since_30d
),
-- Competitor share per topic. Summed straight from the array: the client
-- folded duplicates within a row before adding them up, which reaches the
-- same total.
--
-- Scans prompt_results again rather than reusing `rows`. `rows` is referenced
-- several times so Postgres materialises it, and carrying competitor_mentions
-- through that materialisation spills 32k detoasted jsonb values to temp
-- files — 4.5 s and 7,500 temp blocks, measured. Reading the column only
-- where it is needed keeps the shared CTE lean.
comps AS (
  SELECT p.topic_id,
         cm.value ->> 'competitor_id' AS competitor_id,
         MIN(cm.value ->> 'name')     AS name,
         SUM(COALESCE((cm.value ->> 'mention_count')::bigint, 0)) AS mentions
  FROM public.prompt_results pr
  JOIN public.prompts p      ON p.id = pr.prompt_id
  JOIN public.prompt_sets ps ON ps.id = p.prompt_set_id
  CROSS JOIN bounds b
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.competitor_mentions, '[]'::jsonb)) cm
  WHERE pr.brand_id = p_brand_id
    AND ps.brand_id = p_brand_id
    AND p.topic_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'
    AND pr.created_at >= b.since_30d
  GROUP BY p.topic_id, cm.value ->> 'competitor_id'
),
comp_totals AS (
  SELECT topic_id,
         SUM(mentions) AS comp_mentions,
         jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions)) AS competitors
  FROM comps
  GROUP BY topic_id
),
-- Fourteen daily buckets for the sparkline. Only the days the page draws.
--
-- Keyed in UTC, because the client builds the same keys from
-- `Date.toISOString()` — reading them in the database's session timezone
-- would shift every bucket by the offset and silently redraw the trend.
daily AS (
  SELECT d.topic_id,
         jsonb_object_agg(d.day, jsonb_build_object('visible', d.visible, 'count', d.count)) AS daily
  FROM (
    SELECT r2.topic_id,
           to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE r2.visible) AS visible,
           COUNT(*) AS count
    FROM rows r2
    CROSS JOIN bounds b
    WHERE r2.created_at >= b.spark_from
    GROUP BY r2.topic_id, to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  ) d
  GROUP BY d.topic_id
),
main AS (
  SELECT r.topic_id,
         COUNT(*)::bigint                                          AS answers,
         COUNT(*) FILTER (WHERE r.mentions > 0)::bigint            AS mention_answers,
         COUNT(*) FILTER (WHERE r.citations > 0)::bigint           AS citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.mention_position > 0), 0)::double precision AS pos_sum,
         COUNT(*) FILTER (WHERE r.mention_position > 0)::bigint    AS pos_n,

         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from)::bigint AS cur_answers,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.mentions > 0)::bigint
                                                                    AS cur_mention_answers,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.citations > 0)::bigint
                                                                    AS cur_citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.created_at >= b.cur_from AND r.mention_position > 0), 0)::double precision
                                                                    AS cur_pos_sum,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.mention_position > 0)::bigint
                                                                    AS cur_pos_n,

         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from)::bigint
                                                                    AS prev_answers,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.mentions > 0)::bigint                              AS prev_mention_answers,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.citations > 0)::bigint                             AS prev_citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
             AND r.mention_position > 0), 0)::double precision      AS prev_pos_sum,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.mention_position > 0)::bigint                      AS prev_pos_n,

         COALESCE(SUM(r.mentions), 0)::bigint                       AS total_mentions,
         COALESCE(SUM(r.citations), 0)::bigint                      AS total_citations,
         COUNT(DISTINCT r.prompt_id)::bigint                        AS active_prompts,
         COUNT(DISTINCT r.prompt_id) FILTER (WHERE r.visible)::bigint AS visible_prompts,
         MAX(r.created_at)                                          AS last_run_at
  FROM rows r
  CROSS JOIN bounds b
  GROUP BY r.topic_id
)
-- The two jsonb rollups join on at the end rather than riding through the
-- GROUP BY: Postgres has no max(jsonb), and carrying them through an
-- aggregate would need a wrapper that buys nothing here.
SELECT m.topic_id,
       m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
       m.cur_answers, m.cur_mention_answers, m.cur_citation_answers, m.cur_pos_sum, m.cur_pos_n,
       m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
       m.total_mentions, m.total_citations,
       COALESCE(ct.comp_mentions, 0)::bigint,
       m.active_prompts, m.visible_prompts, m.last_run_at,
       COALESCE(ct.competitors, '{}'::jsonb),
       COALESCE(dl.daily, '{}'::jsonb)
FROM main m
LEFT JOIN comp_totals ct ON ct.topic_id = m.topic_id
LEFT JOIN daily dl       ON dl.topic_id = m.topic_id
$$;

GRANT EXECUTE ON FUNCTION public.topics_overview_aggregates(uuid) TO authenticated;
