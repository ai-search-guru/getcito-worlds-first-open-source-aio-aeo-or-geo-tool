-- Insights visibility trend (VIS-007).
--
-- The v2 mockup's trend keeps the competitors you pin (up to five) on the
-- chart whatever the range, and marks the days that explain a step in the
-- line: prompts added ("+509 prompts added · Sep 29") and Action Center
-- actions sent ("AC-61 sent · Oct 4").
--
-- Pins are saved on the brand, so the whole team sees the same lines; like
-- every brand setting they're written by admins and managers (the brands
-- update policy). Ids of competitors deleted since are ignored on read.

alter table public.brands
  add column if not exists insights_pinned_competitors uuid[] not null default '{}'
    constraint brands_insights_pinned_competitors_max
      check (cardinality(insights_pinned_competitors) <= 5);

comment on column public.brands.insights_pinned_competitors is
  'Competitors pinned on the Insights visibility trend (VIS-007, 00136), in pin order; at most five.';

-- Per UTC day (the trend's days), the prompts created for the brand (in the
-- topic, when the trend is filtered to one) and the actions a person sent
-- from it. Actions the nightly generator created have no actor on their
-- "created" event and aren't markers.
create or replace function public.insights_trend_markers(
  p_brand_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_topic_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'prompts_added', coalesce(
      (select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
       from (
         select (p.created_at at time zone 'utc')::date as day, count(*) as n
         from public.prompts p
         join public.prompt_sets ps on ps.id = p.prompt_set_id
         where ps.brand_id = p_brand_id
           and (p_topic_id is null or p.topic_id = p_topic_id)
           and (p_from is null or p.created_at >= p_from)
           and (p_to is null or p.created_at <= p_to)
         group by 1
       ) d),
      '[]'::jsonb),
    'actions_sent', coalesce(
      (select jsonb_agg(jsonb_build_object('day', d.day, 'action_nos', d.nos) order by d.day)
       from (
         select (a.created_at at time zone 'utc')::date as day,
                array_agg(a.action_no order by a.action_no) as nos
         from public.actions a
         where a.brand_id = p_brand_id
           and (p_from is null or a.created_at >= p_from)
           and (p_to is null or a.created_at <= p_to)
           and exists (
                 select 1 from public.action_events e
                 where e.action_id = a.id
                   and e.event = 'created'
                   and e.actor_id is not null)
         group by 1
       ) d),
      '[]'::jsonb)
  );
$$;

revoke all on function public.insights_trend_markers(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.insights_trend_markers(uuid, timestamptz, timestamptz, uuid)
  to authenticated, service_role;

comment on function public.insights_trend_markers(uuid, timestamptz, timestamptz, uuid) is
  'Insights trend markers (VIS-007, 00136): per UTC day, the prompts created for the brand (optionally in one topic) and the Action Center actions a person sent, between two optional bounds. Security invoker.';
