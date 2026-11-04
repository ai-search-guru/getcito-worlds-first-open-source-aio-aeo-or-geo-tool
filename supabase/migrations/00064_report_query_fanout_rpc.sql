-- Query fan-out: the fourth report section that read its window through an
-- unpaginated select.
--
-- 00063 moved prompt performance, topic performance and citation evidence into
-- SQL. getFanoutSnapshot was missed, and it was the worst of the four: no
-- .range(), no pagination, and no .order() either. PostgREST caps a select at
-- 1000 rows, so on a brand with ~12k answers in the window the section ranked
-- sub-queries over an arbitrary twelfth of the data. Every row in the affected
-- report came out at timesSearched = 2 and the list fell back to alphabetical
-- order, while the real top query had been searched 24 times.
--
-- Counting matches the fold this replaces: a sub-query counts once per answer
-- however many times that answer repeats it, and an engine is the item's own
-- source_platform when it has one, otherwise the answer's platform.
CREATE OR REPLACE FUNCTION "public"."report_query_fanout"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_limit" integer DEFAULT 10
)
RETURNS TABLE(
  "query" text,
  "engines" text[],
  "times_searched" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  WITH items AS (
    SELECT
      pr.id AS result_id,
      btrim(regexp_replace(it->>'query', '\s+', ' ', 'g')) AS display,
      coalesce(nullif(it->>'source_platform', ''), pr.platform) AS engine
    FROM prompt_results pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.search_queries) it
    WHERE pr.brand_id = p_brand_id
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
      AND jsonb_typeof(pr.search_queries) = 'array'
      AND it->>'query' IS NOT NULL
  ),
  cleaned AS (
    SELECT result_id, display, lower(display) AS qkey, engine
    FROM items
    WHERE display <> ''
  )
  SELECT
    min(display) AS query,
    array_agg(DISTINCT engine ORDER BY engine) FILTER (WHERE engine IS NOT NULL) AS engines,
    count(DISTINCT result_id) AS times_searched
  FROM cleaned
  GROUP BY qkey
  ORDER BY count(DISTINCT result_id) DESC, min(display)
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_query_fanout"(uuid, timestamptz, timestamptz, integer) TO "authenticated";
