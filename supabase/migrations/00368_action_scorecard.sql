-- ============================================================================
-- 00368: what worked at a brand, by kind of action (learning B3)
-- ============================================================================
-- Each completed action keeps its result (server action-center/validate.js,
-- read a week, two weeks and a month after it closed) and a dismissed one
-- why it was turned down (00366). Read one at a time, a brand can't see
-- which kinds of work pay off for it. This sums the brand's actions raised
-- since a day by kind: how many were completed, what their results read,
-- the median change in each one's main metric, and how many were dismissed
-- and why. One brand's own actions only, never another's: the History tab
-- reads it with the member's session (RLS keeps it to their organization),
-- the API with the service role.

create or replace function public.action_scorecard(
  p_brand_id uuid,
  p_since timestamptz default null
)
returns table (
  kind text,
  completed integer,
  improved integer,
  mixed integer,
  no_change integer,
  declined integer,
  not_measurable integer,
  pending integer,
  final integer,
  median_change numeric,
  dismissed integer,
  dismiss_reasons jsonb
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with closed as (
    select a.kind,
           a.status,
           a.outcome,
           a.dismiss_reason,
           a.validation->>'final' = 'true' as is_final,
           -- The relative change in its main metric (learning A4), when the
           -- metric was read before and after and had a before to scale by.
           (select (m->>'after')::numeric / nullif((m->>'before')::numeric, 0) - 1
              from jsonb_array_elements(
                     case when jsonb_typeof(a.validation->'metrics') = 'array'
                          then a.validation->'metrics' else '[]'::jsonb end
                   ) as m
             where m->>'metric' = a.validation->>'primary'
               and jsonb_typeof(m->'before') = 'number'
               and jsonb_typeof(m->'after') = 'number'
             limit 1) as change
      from public.actions a
     where a.brand_id = p_brand_id
       and a.deleted_at is null
       and a.status in ('completed', 'dismissed')
       and (p_since is null or a.created_at >= p_since)
  )
  select c.kind,
         count(*) filter (where c.status = 'completed')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'improved')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'mixed')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'no_meaningful_change')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'declined')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'not_measurable')::integer,
         count(*) filter (
           where c.status = 'completed'
             and (c.outcome is null or c.outcome = 'pending_measurement')
         )::integer,
         count(*) filter (where c.status = 'completed' and c.is_final)::integer,
         -- The median, so one small page that went from 1 to 20 doesn't
         -- read as the kind's typical result. Over the results with a
         -- verdict only.
         round(
           (percentile_cont(0.5) within group (order by c.change) filter (
             where c.status = 'completed'
               and c.outcome in ('improved', 'mixed', 'no_meaningful_change', 'declined')
           ))::numeric,
           4
         ),
         count(*) filter (where c.status = 'dismissed')::integer,
         coalesce(
           (select jsonb_object_agg(r.reason, r.n)
              from (select coalesce(d.dismiss_reason, 'none') as reason, count(*) as n
                      from closed d
                     where d.kind = c.kind and d.status = 'dismissed'
                     group by 1) as r),
           '{}'::jsonb
         )
    from closed c
   group by c.kind;
$$;

revoke all on function public.action_scorecard(uuid, timestamptz) from public, anon;
grant execute on function public.action_scorecard(uuid, timestamptz) to authenticated, service_role;

comment on function public.action_scorecard(uuid, timestamptz) is
  'A brand''s actions raised since a day, by kind: completed, results, median change in the main metric, dismissed and why (00368, learning B3). RLS applies to the caller.';

notify pgrst, 'reload schema';
