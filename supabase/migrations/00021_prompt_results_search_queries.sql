-- 00021_prompt_results_search_queries.sql
-- Capture the observed query fan-out on each tracked answer.
--
-- Answer engines (Copilot, Perplexity, and — in principle — ChatGPT) run their
-- own sub-queries to build an answer. Cloro already returns these in the poll /
-- webhook response; we simply had nowhere to store them. This column holds that
-- OBSERVED fan-out (straight from the engine, not an LLM prediction) as a rich,
-- normalized array so the UI can keep the per-item engine label:
--
--   [{ "query": "best running shoes 2026", "engine": "web", "source_platform": "perplexity-web" }]
--
-- (`engine` is present only where the provider labels it — Perplexity today.)
--
-- Existing rows default to an empty array, so nothing changes for historical
-- data; new Copilot/Perplexity results populate it as they land.

ALTER TABLE prompt_results
  ADD COLUMN IF NOT EXISTS search_queries jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prompt_results.search_queries IS
  'Observed query fan-out from the answer engine: [{ query, engine?, source_platform }]. Copilot is the primary source; Perplexity secondary (web queries, carries engine); ChatGPT usually empty. Defaults to [].';
