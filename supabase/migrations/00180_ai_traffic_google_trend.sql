-- ============================================================================
-- 00180: AI visits vs Google clicks (AT-008, part A)
-- ============================================================================
-- Spec §3.3: the AI Referral Trend card gets a "vs Google clicks" view. It
-- shows AI visits and Google organic clicks, each indexed to 100 at the
-- start of the range, with markers on the days actions entered the Action
-- Center and prompts were added. The AI line is the page's own trend; this
-- reads the rest, by UTC day like the trend's buckets:
--
--   * clicks: Search Console clicks per day, summed over the brand's queries
--     the way the Google clicks card sums them (00174);
--   * first_day / last_day: the first and latest day Search Console has rows
--     for the brand. Before the first the sync has no history (it keeps 90
--     days); after the latest Google hasn't reported yet (about two days
--     late, §3.01). The chart leaves both blank rather than drawing 0;
--   * markers: per day, the actions created in the Action Center and the
--     prompts added to the brand's sets.
--
-- Security invoker: gsc_query_stats, actions and prompts each have a member
-- select policy, so RLS decides the brand.

create or replace function public.ai_traffic_google_trend(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'first_day', (
      select min(g.date) from public.gsc_query_stats g where g.brand_id = p_brand_id
    ),
    'last_day', (
      select max(g.date) from public.gsc_query_stats g where g.brand_id = p_brand_id
    ),
    'clicks', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'clicks', d.clicks) order by d.day)
      from (
        select g.date as day, sum(g.clicks)::bigint as clicks
        from public.gsc_query_stats g
        where g.brand_id = p_brand_id
          and g.date >= p_since
          and g.date <= p_until
        group by g.date
      ) d
    ), '[]'::jsonb),
    'markers', coalesce((
      select jsonb_agg(
        jsonb_build_object('day', m.day, 'actions', m.actions, 'prompts', m.prompts)
        order by m.day
      )
      from (
        select
          e.day,
          count(*) filter (where e.kind = 'action') as actions,
          count(*) filter (where e.kind = 'prompt') as prompts
        from (
          select (a.created_at at time zone 'UTC')::date as day, 'action' as kind
          from public.actions a
          where a.brand_id = p_brand_id
            and a.created_at >= p_since::timestamp at time zone 'UTC'
            and a.created_at < (p_until + 1)::timestamp at time zone 'UTC'
          union all
          select (p.created_at at time zone 'UTC')::date, 'prompt'
          from public.prompts p
          join public.prompt_sets s on s.id = p.prompt_set_id
          where s.brand_id = p_brand_id
            and p.created_at >= p_since::timestamp at time zone 'UTC'
            and p.created_at < (p_until + 1)::timestamp at time zone 'UTC'
        ) e
        group by e.day
      ) m
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.ai_traffic_google_trend(uuid, date, date) from public, anon;
grant execute on function public.ai_traffic_google_trend(uuid, date, date)
  to authenticated, service_role;

comment on function public.ai_traffic_google_trend(uuid, date, date) is
  'AI Traffic "vs Google clicks" trend (AT-008, spec §3.3): Search Console clicks per UTC day, the first and latest day Search Console has rows for the brand, and per day the actions created in the Action Center and the prompts added. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
