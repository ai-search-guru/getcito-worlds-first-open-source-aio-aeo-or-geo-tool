-- 00022_fanout_query_intents.sql
-- On-demand, brand-independent cache of the search intent of a fan-out sub-query.
--
-- The Query Fan-out tab (#333) labels each observed sub-query with the same
-- 7-value intent taxonomy the Insights "intent" column uses. Intent is derived
-- from an LLM call, so we cache it per distinct (normalized, lower-cased) query
-- string — the intent of "best running shoes 2026" is the same for every brand,
-- so one classification is reused everywhere. Populated on-demand at read time,
-- never during tracking ingest.
--
-- Written only by the server (service role) via /api/prompts/fanout-intents;
-- RLS is enabled with no policies so it isn't readable/writable by anon or
-- authenticated clients directly.

CREATE TABLE IF NOT EXISTS fanout_query_intents (
  query text PRIMARY KEY,
  intent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fanout_query_intents IS
  'Cache of a fan-out sub-query''s search intent (#333). Key is the normalized (trimmed, whitespace-collapsed, lower-cased) query; intent is one of comparison/how-to/what-is/best-top/vs-review/recommendation/problem-solving/other. Brand-independent, populated on-demand.';

ALTER TABLE fanout_query_intents ENABLE ROW LEVEL SECURITY;
