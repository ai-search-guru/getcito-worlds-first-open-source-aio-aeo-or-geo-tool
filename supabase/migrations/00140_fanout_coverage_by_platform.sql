-- Query fan-out coverage per platform, for the daily health report.
--
-- ChatGPT's observed fan-out came back empty from 2026-09-30 while its
-- answers still carried sources: the engine was searching, the field just
-- stopped arriving. Nothing noticed for two weeks, because an empty field
-- reads exactly like an answer that ran no search. The health report now
-- reads each platform's share of answers with fan-out over the last day and
-- the days before, and flags one that stops (backend/src/lib/health/report.js).
--
-- One aggregate over the window (idx_prompt_results_created_at), across every
-- brand; no rows leave the database. Service role only.
create or replace function public.fanout_coverage_by_platform(
  p_since timestamptz,
  p_until timestamptz
)
returns table (platform text, answers bigint, answers_with_fanout bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.platform,
    count(*)::bigint,
    count(*) filter (
      where case
        when jsonb_typeof(r.search_queries) = 'array' then jsonb_array_length(r.search_queries)
        else 0
      end > 0
    )::bigint
  from public.prompt_results r
  where r.created_at >= p_since
    and r.created_at < p_until
  group by r.platform;
$$;

revoke all on function public.fanout_coverage_by_platform(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fanout_coverage_by_platform(timestamptz, timestamptz)
  to service_role;

comment on function public.fanout_coverage_by_platform(timestamptz, timestamptz) is
  'Answers and answers with observed query fan-out per platform in [p_since, p_until), across all brands (00140). Read by the daily health report.';
