-- ============================================================================
-- 00193: "is this AI platform new?" reads only the platforms in question
-- ============================================================================
-- Follow-up from #1195's review (AT-013). The nightly "new AI platform" check
-- (server signals/trafficPlatforms.js) read the brand's whole AI traffic
-- history before the week with ai_traffic_merged (00176), pages and days
-- included, only to learn which platforms had sent a visit before.
--
-- ai_traffic_platforms_seen answers that directly, for the few platforms the
-- week put forward: whether the brand had any AI visit before p_before, and
-- which of p_platforms did. A snippet visit or an Analytics session counts,
-- whichever day it fell on: for "seen before" any evidence will do, where
-- ai_traffic_merged keeps one source per day so visits aren't counted twice.
--
-- Each platform is an index probe on the new (brand_id, source_platform,
-- created_at) index; Analytics rows are daily and few. On a large
-- ai_traffic_logs, build the index by hand first with `create index
-- concurrently`, which doesn't hold back the beacon's writes; this statement
-- then finds it in place.

create index if not exists idx_ai_traffic_logs_brand_platform_time
  on public.ai_traffic_logs (brand_id, source_platform, created_at)
  where visit_of is null;

create or replace function public.ai_traffic_platforms_seen(
  p_brand_id uuid,
  p_before timestamptz,
  p_platforms text[]
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'any_before',
      exists (
        select 1 from public.ai_traffic_logs l
        where l.brand_id = p_brand_id
          and l.visit_of is null
          and l.created_at < p_before
      )
      or exists (
        select 1 from public.ga_ai_traffic_stats g
        where g.brand_id = p_brand_id
          and g.sessions > 0
          and g.date < (p_before at time zone 'utc')::date
      ),
    'seen', coalesce((
      select jsonb_agg(p.platform order by p.platform)
      from unnest(p_platforms) as p(platform)
      where exists (
          select 1 from public.ai_traffic_logs l
          where l.brand_id = p_brand_id
            and l.visit_of is null
            and l.source_platform = p.platform
            and l.created_at < p_before
        )
        or exists (
          select 1 from public.ga_ai_traffic_stats g
          where g.brand_id = p_brand_id
            and g.sessions > 0
            and coalesce(g.platform, g.source) = p.platform
            and g.date < (p_before at time zone 'utc')::date
        )
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.ai_traffic_platforms_seen(uuid, timestamptz, text[])
  from public, anon;
grant execute on function public.ai_traffic_platforms_seen(uuid, timestamptz, text[])
  to authenticated, service_role;

comment on function public.ai_traffic_platforms_seen(uuid, timestamptz, text[]) is
  'AI Traffic (AT-013): whether a brand had any AI-referred visit before p_before (snippet or Analytics), and which of p_platforms sent one, for the nightly new-platform check. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
