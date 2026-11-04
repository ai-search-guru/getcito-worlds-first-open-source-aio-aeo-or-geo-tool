-- AC-009, part 3: the nightly check that every action's count and its list agree.
--
-- An action keeps its list once, when it is created (action_entities, 00244),
-- and everything it shows counts from it. The daily health e-mail now says
-- how many open actions disagree with their own list, and names a few:
--
--   * missing:  an action about something (a targetCount) made since lists
--     are kept that kept none;
--   * mismatch: one whose list holds another number than the count it saved.
--     A new action keeps up to 1000 (MAX_TARGET_IDS): a list cut there is
--     the cap, not a mismatch;
--   * tasks:    one with a planned task naming another count of the same
--     thing than the action saved ("across 13 prompts" under 12).
--
-- The last two judge only lists kept as their action was created
-- (action_entities.kept_at): an action from before 00244 got the list its
-- payload still named, and an older count may never have matched it.
-- Each should be 0; the server's health report raises any that isn't.

create or replace function public.action_count_drift(p_examples integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_actions as (
    select a.id, a.action_no, a.created_at, a.payload->>'targetEntity' as entity, x.target_count
    from public.actions a
    -- A number only: anything else in the payload is no count to check.
    cross join lateral (
      select case when jsonb_typeof(a.payload->'targetCount') = 'number'
                  then (a.payload #>> '{targetCount}')::numeric end as target_count
    ) x
    where a.deleted_at is null
      and a.status not in ('completed', 'dismissed')
      and x.target_count > 0
      and coalesce(a.payload->>'targetEntity', '') <> ''
  ),
  -- Lists started being kept here: actions before had theirs written by
  -- 00244's backfill, from what their payload still named, if anything.
  since as (
    select coalesce(min(kept_at), '-infinity'::timestamptz) as at from public.action_entities
  ),
  kept as (
    select o.id, o.action_no, o.created_at, o.target_count, l.total, l.at_creation
    from open_actions o
    -- Each action's own rows, through the primary key.
    cross join lateral (
      select count(*) as total,
             -- Kept as it was created (the trigger), not by the backfill.
             coalesce(bool_or(e.kept_at <= o.created_at + interval '1 minute'), false) as at_creation
      from public.action_entities e
      where e.action_id = o.id and e.entity_type = o.entity
    ) l
  ),
  missing as (
    select k.action_no from kept k, since
    where k.total = 0 and k.created_at >= since.at
  ),
  mismatch as (
    select action_no from kept
    where at_creation
      and total > 0
      and total <> target_count
      -- The cap a list was cut at, not a mismatch.
      and not (total = 1000 and target_count > total)
  ),
  tasks as (
    select distinct k.action_no
    from kept k
    join open_actions o on o.id = k.id
    join public.action_tasks t on t.action_id = o.id
    cross join lateral (
      select case when jsonb_typeof(t.title_params->'count') = 'number'
                  then (t.title_params #>> '{count}')::numeric end as task_count
    ) c
    where k.at_creation
      and t.title_params->>'entity' = o.entity
      and c.task_count <> o.target_count
  )
  -- The newest first: a regression shows before the long-open ones.
  select jsonb_build_object(
    'checked', (select count(*) from open_actions),
    'missing', jsonb_build_object(
      'count', (select count(*) from missing),
      'examples', coalesce((select jsonb_agg(action_no order by action_no desc)
                            from (select action_no from missing order by action_no desc limit p_examples) x), '[]'::jsonb)),
    'mismatch', jsonb_build_object(
      'count', (select count(*) from mismatch),
      'examples', coalesce((select jsonb_agg(action_no order by action_no desc)
                            from (select action_no from mismatch order by action_no desc limit p_examples) x), '[]'::jsonb)),
    'tasks', jsonb_build_object(
      'count', (select count(*) from tasks),
      'examples', coalesce((select jsonb_agg(action_no order by action_no desc)
                            from (select action_no from tasks order by action_no desc limit p_examples) x), '[]'::jsonb))
  );
$$;

comment on function public.action_count_drift(integer) is
  'AC-009: open actions whose saved count and kept list (action_entities) disagree, by kind (missing list, list ≠ count, a task naming another count), with a few action numbers each; read by the daily health report. Each should be 0.';

revoke all on function public.action_count_drift(integer) from public, anon, authenticated;
grant execute on function public.action_count_drift(integer) to service_role;
