-- 00014_security_invoker_rpcs.sql
--
-- Security hardening (defense-in-depth): flip every aggregate / row-fetch RPC
-- from SECURITY DEFINER to SECURITY INVOKER so the database itself enforces
-- org isolation via Row Level Security, instead of relying solely on the route
-- layer to verify brand-belongs-to-org before calling.
--
-- Why this is safe (verified against the current schema):
--   * Every table these RPCs read is already covered by an org-scoped SELECT
--     policy for the `authenticated` role:
--       - prompt_results : "Users can read own org prompt results" (00001)
--       - prompts        : "prompts: member select"               (00001)
--       - topics         : no RLS, GRANT ALL to authenticated      (00001)
--   * Dashboard callers (frontend/src/lib/actions/tracking.ts) use the cookie-based
--     authenticated client, so auth.uid() is always populated and RLS resolves
--     to the caller's own organization — legitimate numbers are unchanged.
--   * MCP / worker callers (frontend/src/lib/mcp/data.ts) use the service_role
--     client, which bypasses RLS regardless of INVOKER/DEFINER — unaffected.
--
-- Effect for a wrong-org call: RLS filters out every row, so aggregates return
-- zeroed/empty results and row fetches return no rows. No cross-org data leaks.
--
-- We use ALTER FUNCTION (not CREATE OR REPLACE) on purpose: it flips only the
-- security attribute and leaves each function's body, search_path, volatility
-- and grants byte-for-byte identical — zero risk of body drift.

-- get_latest_prompt_results — two overloads (00001). Currently unused by app
-- code, but exposed to PostgREST, so harden anyway.
ALTER FUNCTION public.get_latest_prompt_results(
  p_brand_id uuid,
  p_platform text
) SECURITY INVOKER;

ALTER FUNCTION public.get_latest_prompt_results(
  p_brand_id uuid,
  p_platform text,
  p_model text,
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz
) SECURITY INVOKER;

-- insights_aggregates (current definition: 00012)
ALTER FUNCTION public.insights_aggregates(
  p_brand_id uuid,
  p_platform text,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_prompt_id uuid,
  p_topic_id uuid
) SECURITY INVOKER;

-- competitor_aggregates (current definition: 00012)
ALTER FUNCTION public.competitor_aggregates(
  p_brand_id uuid,
  p_platform text,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_prompt_id uuid,
  p_topic_id uuid
) SECURITY INVOKER;

-- share_of_voice_aggregates (current definition: 00012)
ALTER FUNCTION public.share_of_voice_aggregates(
  p_brand_id uuid,
  p_platform text,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_prompt_id uuid,
  p_topic_id uuid
) SECURITY INVOKER;

-- visibility_trend_aggregates (current definition: 00012)
ALTER FUNCTION public.visibility_trend_aggregates(
  p_brand_id uuid,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_topic_id uuid,
  p_granularity text
) SECURITY INVOKER;

-- prompt_performance_aggregates (00013)
ALTER FUNCTION public.prompt_performance_aggregates(
  p_brand_id uuid,
  p_models text[],
  p_region text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_topic_id uuid
) SECURITY INVOKER;
