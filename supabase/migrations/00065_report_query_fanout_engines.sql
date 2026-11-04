-- Per-engine fan-out coverage, to sit beside the top-ten table.
--
-- That table ranks sub-queries by how many answers ran the identical string,
-- which quietly measures how much an engine reuses its phrasing rather than
-- how much it fans out. On the brand this came from, ChatGPT issued 3,341
-- distinct sub-queries against Copilot's 782 -- and appeared in the top ten
-- exactly never, because its top string repeated 9 times to Copilot's 18.
--
-- A reader concluded ChatGPT does not fan out. It fans out the most. The
-- ranking is a separate question; this gives the section the two numbers that
-- stop the table from being read as the whole story.
CREATE OR REPLACE FUNCTION "public"."report_query_fanout_engines"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz
)
RETURNS TABLE(
  "engine" text,
  "distinct_queries" bigint,
  "answers_with_fanout" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  WITH cleaned AS (
    SELECT
      pr.id AS result_id,
      lower(btrim(regexp_replace(it->>'query', '\s+', ' ', 'g'))) AS qkey,
      coalesce(nullif(it->>'source_platform', ''), pr.platform) AS engine
    FROM prompt_results pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.search_queries) it
    WHERE pr.brand_id = p_brand_id
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
      AND jsonb_typeof(pr.search_queries) = 'array'
      AND it->>'query' IS NOT NULL
  )
  SELECT
    engine,
    count(DISTINCT qkey) AS distinct_queries,
    count(DISTINCT result_id) AS answers_with_fanout
  FROM cleaned
  WHERE qkey <> ''
    AND engine IS NOT NULL
  GROUP BY engine
  ORDER BY count(DISTINCT qkey) DESC, engine;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_query_fanout_engines"(uuid, timestamptz, timestamptz) TO "authenticated";
