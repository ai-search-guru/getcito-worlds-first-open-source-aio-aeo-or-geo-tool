-- Report generation: aggregate in Postgres instead of downloading the window.
--
-- Three report sections computed their figures by paging every matching
-- prompt_results row into the Node process and folding them there. On a brand
-- with ~12k results a week that is dozens of sequential round trips per
-- section, all running while the report's other sections issue their own
-- queries. The heavy aggregate RPCs (ai_visibility_aggregates and friends)
-- then exceed the 8s statement_timeout of the `authenticated` role and the
-- whole report fails.
--
-- The scans also had a ceiling: 50,000 rows. A 30-day report spans 60 days of
-- data for the topic section, which is already past that on a busy brand, so
-- the figures were quietly computed from a truncated window.
--
-- These functions return the raw accumulator components rather than finished
-- scores. The blend lives in one place in TypeScript (computeAiVisibilityScore)
-- and is shared with the Prompts and Topics pages; reimplementing it here
-- would be a second copy to keep in step.

-- Per-prompt totals for the report window. Rows returned: one per prompt,
-- not one per answer.
CREATE OR REPLACE FUNCTION "public"."report_prompt_performance"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz
)
RETURNS TABLE(
  "prompt_id" uuid,
  "prompt_text" text,
  "runs" bigint,
  "visible_runs" bigint,
  "mention_answers" bigint,
  "citation_answers" bigint,
  "total_mentions" bigint,
  "sum_visibility" double precision,
  "pos_sum" double precision,
  "pos_n" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  SELECT
    pr.prompt_id,
    p.text,
    count(*)::bigint,
    count(*) FILTER (
      WHERE coalesce(pr.mention_count, 0) > 0 OR coalesce(pr.citation_count, 0) > 0
    )::bigint,
    count(*) FILTER (WHERE coalesce(pr.mention_count, 0) > 0)::bigint,
    count(*) FILTER (WHERE coalesce(pr.citation_count, 0) > 0)::bigint,
    coalesce(sum(coalesce(pr.mention_count, 0)), 0)::bigint,
    coalesce(sum(coalesce(pr.visibility_score, 0)), 0)::double precision,
    -- Reciprocal rank, summed only over answers that actually placed the
    -- brand somewhere; pos_n is that count so the caller can take the mean.
    coalesce(sum(1.0 / pr.mention_position) FILTER (WHERE pr.mention_position > 0), 0)::double precision,
    count(*) FILTER (WHERE pr.mention_position > 0)::bigint
  FROM prompt_results pr
  JOIN prompts p ON p.id = pr.prompt_id
  WHERE pr.brand_id = p_brand_id
    AND pr.platform <> 'chatgpt-shopping'
    AND pr.created_at >= p_date_from
    AND pr.created_at <= p_date_to
    AND p.text IS NOT NULL
    AND p.text <> ''
  GROUP BY pr.prompt_id, p.text;
$$;

-- Per-topic totals for the report window AND the window before it, so the
-- section can show a change without a second scan. `p_date_from` is the
-- boundary: at or after it is the current window, before it is the previous.
CREATE OR REPLACE FUNCTION "public"."report_topic_performance"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_prev_from" timestamptz
)
RETURNS TABLE(
  "topic_id" uuid,
  "topic_name" text,
  "runs" bigint,
  "visible_runs" bigint,
  "mention_answers" bigint,
  "citation_answers" bigint,
  "sum_visibility" double precision,
  "pos_sum" double precision,
  "pos_n" bigint,
  "prev_runs" bigint,
  "prev_visible_runs" bigint,
  "prev_mention_answers" bigint,
  "prev_citation_answers" bigint,
  "prev_pos_sum" double precision,
  "prev_pos_n" bigint
)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
  SELECT
    t.id,
    t.name,
    count(*) FILTER (WHERE pr.created_at >= p_date_from)::bigint,
    count(*) FILTER (
      WHERE pr.created_at >= p_date_from
        AND (coalesce(pr.mention_count, 0) > 0 OR coalesce(pr.citation_count, 0) > 0)
    )::bigint,
    count(*) FILTER (WHERE pr.created_at >= p_date_from AND coalesce(pr.mention_count, 0) > 0)::bigint,
    count(*) FILTER (WHERE pr.created_at >= p_date_from AND coalesce(pr.citation_count, 0) > 0)::bigint,
    coalesce(sum(coalesce(pr.visibility_score, 0)) FILTER (WHERE pr.created_at >= p_date_from), 0)::double precision,
    coalesce(sum(1.0 / pr.mention_position) FILTER (
      WHERE pr.created_at >= p_date_from AND pr.mention_position > 0
    ), 0)::double precision,
    count(*) FILTER (WHERE pr.created_at >= p_date_from AND pr.mention_position > 0)::bigint,
    count(*) FILTER (WHERE pr.created_at < p_date_from)::bigint,
    count(*) FILTER (
      WHERE pr.created_at < p_date_from
        AND (coalesce(pr.mention_count, 0) > 0 OR coalesce(pr.citation_count, 0) > 0)
    )::bigint,
    count(*) FILTER (WHERE pr.created_at < p_date_from AND coalesce(pr.mention_count, 0) > 0)::bigint,
    count(*) FILTER (WHERE pr.created_at < p_date_from AND coalesce(pr.citation_count, 0) > 0)::bigint,
    coalesce(sum(1.0 / pr.mention_position) FILTER (
      WHERE pr.created_at < p_date_from AND pr.mention_position > 0
    ), 0)::double precision,
    count(*) FILTER (WHERE pr.created_at < p_date_from AND pr.mention_position > 0)::bigint
  FROM prompt_results pr
  JOIN prompts p ON p.id = pr.prompt_id
  JOIN topics t ON t.id = p.topic_id
  WHERE pr.brand_id = p_brand_id
    AND pr.platform <> 'chatgpt-shopping'
    AND pr.created_at >= p_prev_from
    AND pr.created_at <= p_date_to
  GROUP BY t.id, t.name;
$$;

-- Top cited URLs with the prompts whose answers cited them.
--
-- SECURITY DEFINER because citation_urls carries row-level security with no
-- select policy — the same reason citations_urls (00061) is defined that way.
-- Unlike those, this one checks that the caller is in the brand's org rather
-- than trusting the brand id it was handed.
CREATE OR REPLACE FUNCTION "public"."report_citation_evidence"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_limit" integer DEFAULT 10,
  "p_prompts_per_url" integer DEFAULT 3
)
RETURNS TABLE(
  "url" text,
  "domain" text,
  "title" text,
  "total_citations" bigint,
  "sourced_prompts" text[]
)
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET "search_path" TO 'public'
SET "work_mem" TO '96MB'
AS $$
  WITH allowed AS (
    SELECT 1
    FROM brands b
    JOIN profiles pf ON pf.organization_id = b.organization_id
    WHERE b.id = p_brand_id
      AND pf.id = auth.uid()
  ),
  -- citation_urls keeps the query string, so one page can sit under several
  -- ids (?utm_source=..., ?authuser=...). Evidence is about the page, not the
  -- link that reached it, so strip query and fragment and group on what is
  -- left — the same normalization the section applied before this moved into
  -- SQL. Without it the list shows the same article three times.
  pairs AS (
    SELECT
      regexp_replace(split_part(split_part(cu.url, '#', 1), '?', 1), '/$', '') AS norm_url,
      cu.domain AS domain,
      nullif(cu.title, '') AS title,
      pr.prompt_id AS prompt_id,
      count(*) AS n
    FROM prompt_result_citations c
    JOIN prompt_results pr ON pr.id = c.prompt_result_id
    JOIN citation_urls cu ON cu.id = c.url_id
    WHERE EXISTS (SELECT 1 FROM allowed)
      AND c.brand_id = p_brand_id
      AND pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
      AND c.created_at >= p_date_from
      AND c.created_at <= p_date_to
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
    GROUP BY 1, 2, 3, 4, c.prompt_result_id
  ),
  agg AS (
    SELECT
      norm_url,
      sum(n)::bigint AS tc,
      min(domain) AS domain,
      min(title) AS title
    FROM pairs
    GROUP BY norm_url
  ),
  top AS (
    SELECT norm_url, tc, domain, title FROM agg ORDER BY tc DESC, norm_url LIMIT p_limit
  ),
  -- One row per (url, prompt text), then keep the first few per url. Ordering
  -- by text keeps the choice stable across runs of the same report.
  ranked AS (
    SELECT norm_url, text, row_number() OVER (PARTITION BY norm_url ORDER BY text) AS rn
    FROM (
      SELECT DISTINCT t.norm_url, p.text
      FROM top t
      JOIN pairs pa ON pa.norm_url = t.norm_url
      JOIN prompts p ON p.id = pa.prompt_id
      WHERE p.text IS NOT NULL AND p.text <> ''
    ) d
  )
  SELECT
    t.norm_url,
    coalesce(t.domain, ''),
    coalesce(t.title, ''),
    t.tc,
    coalesce(
      (SELECT array_agg(r.text ORDER BY r.rn)
       FROM ranked r
       WHERE r.norm_url = t.norm_url AND r.rn <= p_prompts_per_url),
      ARRAY[]::text[]
    )
  FROM top t
  ORDER BY t.tc DESC;
$$;

GRANT EXECUTE ON FUNCTION "public"."report_prompt_performance"(uuid, timestamptz, timestamptz) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."report_topic_performance"(uuid, timestamptz, timestamptz, timestamptz) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."report_citation_evidence"(uuid, timestamptz, timestamptz, integer, integer) TO "authenticated";
