-- Signal groups: count copies of one finding once (AC-002).
--
-- A brand can track the same prompt text several times, in different topics
-- or with different locations, and the detectors write one signal per
-- prompt. On production one pass wrote ten identical "Citations lost for
-- '…'" rows, and every card counted all ten. The Signals list now shows such
-- copies as one row, so the cards count them as one too.
--
-- signal_group_key names the group a signal belongs to: signals of one kind,
-- about one prompt text (case, spacing and the closing "?" ignored), found in
-- one pass. Signals not about a prompt are their own group. The web list has
-- the same rule in frontend/src/lib/signals/group.ts; change both together.
--
-- signals_summary is 00080's, counting groups instead of rows. A group is
-- detected when its first copy was, high impact when any copy is, and
-- resolved only once every copy is, on the day the last one was: a finding
-- with copies still open has not been resolved.
--
-- signals_new_count is the Action Center tab badge, the untriaged groups.

create or replace function public.signal_group_key(
  p_id uuid,
  p_kind text,
  p_detected_at timestamptz,
  p_payload jsonb
) returns text
language sql
stable
set search_path = public
as $$
  select case
    when jsonb_typeof(p_payload -> 'promptId') = 'string'
     and jsonb_typeof(p_payload -> 'promptText') = 'string'
    then p_kind || '|'
      || lower(regexp_replace(
           btrim(regexp_replace(p_payload ->> 'promptText', '[ \t\n\r\f\v]+', ' ', 'g')),
           '[ ?.!]+$', ''))
      || '|' || (extract(epoch from p_detected_at) * 1000)::bigint::text
    else p_id::text
  end;
$$;

create or replace function public.signals_summary(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select p_from as cur_from, p_to as cur_to,
           p_from - (p_to - p_from) as prev_from, p_from as prev_to
  ),
  groups as (
    select
      public.signal_group_key(id, kind, detected_at, payload) as group_key,
      min(detected_at) as detected_at,
      case when bool_and(resolved_at is not null) then max(resolved_at) end as resolved_at,
      bool_or(impact = 'high') as important,
      -- One kind per group, so one category and one set of sources.
      min(category) as category,
      min(source) as source
    from public.signals
    where brand_id = p_brand_id
    group by 1
  ),
  active as (
    select * from groups, bounds
    where detected_at < cur_to
      and (resolved_at is null or resolved_at >= cur_from)
  ),
  prev_active as (
    select * from groups, bounds
    where detected_at < prev_to
      and (resolved_at is null or resolved_at >= prev_from)
  ),
  days as (
    select generate_series(
      (select cur_from from bounds)::date,
      (select cur_to from bounds)::date - 1,
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'total', (select count(*) from active),
    'prev_total', (select count(*) from prev_active),
    'important', (select count(*) from active where important),
    'prev_important', (select count(*) from prev_active where important),
    'new', (
      select count(*) from groups, bounds
      where detected_at >= cur_from and detected_at < cur_to
    ),
    'prev_new', (
      select count(*) from groups, bounds
      where detected_at >= prev_from and detected_at < prev_to
    ),
    'resolved', (
      select count(*) from groups, bounds
      where resolved_at >= cur_from and resolved_at < cur_to
    ),
    'prev_resolved', (
      select count(*) from groups, bounds
      where resolved_at >= prev_from and resolved_at < prev_to
    ),
    'by_day_active', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(g.group_key) as cnt
        from days d
        left join groups g
          on g.detected_at::date <= d.day
         and (g.resolved_at is null or g.resolved_at::date >= d.day)
        group by d.day
      ) t
    ),
    'by_day_important', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(g.group_key) as cnt
        from days d
        left join groups g
          on g.important
         and g.detected_at::date <= d.day
         and (g.resolved_at is null or g.resolved_at::date >= d.day)
        group by d.day
      ) t
    ),
    'by_day_new', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(g.group_key) as cnt
        from days d
        left join groups g on g.detected_at::date = d.day
        group by d.day
      ) t
    ),
    'by_day_resolved', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(g.group_key) as cnt
        from days d
        left join groups g on g.resolved_at::date = d.day
        group by d.day
      ) t
    ),
    'by_category', (
      select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb)
      from (select category, count(*) as cnt from active group by 1) c
    ),
    'by_source', (
      select coalesce(jsonb_object_agg(src, cnt), '{}'::jsonb)
      from (select unnest(source) as src, count(*) as cnt from active group by 1) s
    )
  );
$$;

create or replace function public.signals_new_count(p_brand_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(distinct public.signal_group_key(id, kind, detected_at, payload))::integer
  from public.signals
  where brand_id = p_brand_id and status = 'new';
$$;
