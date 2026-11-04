-- ============================================================================
-- 00224: vacuum and analyze the answers and their citations daily
-- ============================================================================
-- prompt_results and prompt_result_citations only grow. At the default
-- scale factors, autovacuum's insert pass ran on them about every three
-- weeks, and analyze about every ten days on the citations (on 2026-10-21:
-- 78k answers and 784k citations inserted since their last vacuum).
--
-- The reads by brand and window (`idx_prompt_results_brand_created_cover`,
-- `prompt_result_citations_brand_created_cover_idx`) are about the latest
-- days, which were the very pages the visibility map didn't cover yet:
--   - their index-only scans still went to the heap, about 20k fetches for a
--     30-day window of the biggest brand, and a cold cache took seconds;
--   - the planner's statistics stopped before those days, so it estimated a
--     window of tens of thousands of citations as a single row.
--
-- At 1% of the rows inserted, the insert pass runs about once a day on each
-- table (about 6k answers and 50k citations a day now). It only reads the
-- pages that aren't all-visible yet, so a run stays small. Analyze runs at
-- 2% of the rows changed, about every other day.

alter table public.prompt_results set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.prompt_result_citations set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);
