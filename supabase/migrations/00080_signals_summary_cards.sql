-- Signals summary v2: everything the five mockup cards show (issue: Action
-- Center Signals page).
--
-- The first version conflated "total" with "new": both counted detected_at
-- in the window, so the two cards could never differ. With the dedup model
-- (one row per ongoing condition, re-detections bump last_detected_at) the
-- honest semantics are:
--
--   total     — conditions ACTIVE in the window: detected before its end and
--               still open, or resolved inside it (i.e. lifetime overlaps).
--   new       — conditions FIRST detected inside the window.
--   important — the high-impact subset of total.
--   resolved  — conditions resolved inside the window.
--
-- Every count carries its previous-window twin for the ↑/↓ deltas, and a
-- per-day series for the card sparklines. Per-day "active" counts scan
-- signals × days, which is fine at per-brand signal counts (tens).

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
  active as (
    select * from public.signals, bounds
    where brand_id = p_brand_id
      and detected_at < cur_to
      and (resolved_at is null or resolved_at >= cur_from)
  ),
  prev_active as (
    select * from public.signals, bounds
    where brand_id = p_brand_id
      and detected_at < prev_to
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
    'important', (select count(*) from active where impact = 'high'),
    'prev_important', (select count(*) from prev_active where impact = 'high'),
    'new', (
      select count(*) from public.signals, bounds
      where brand_id = p_brand_id and detected_at >= cur_from and detected_at < cur_to
    ),
    'prev_new', (
      select count(*) from public.signals, bounds
      where brand_id = p_brand_id and detected_at >= prev_from and detected_at < prev_to
    ),
    'resolved', (
      select count(*) from public.signals, bounds
      where brand_id = p_brand_id and resolved_at >= cur_from and resolved_at < cur_to
    ),
    'prev_resolved', (
      select count(*) from public.signals, bounds
      where brand_id = p_brand_id and resolved_at >= prev_from and resolved_at < prev_to
    ),
    'by_day_active', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(s.id) as cnt
        from days d
        left join public.signals s
          on s.brand_id = p_brand_id
         and s.detected_at::date <= d.day
         and (s.resolved_at is null or s.resolved_at::date >= d.day)
        group by d.day
      ) t
    ),
    'by_day_important', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(s.id) as cnt
        from days d
        left join public.signals s
          on s.brand_id = p_brand_id
         and s.impact = 'high'
         and s.detected_at::date <= d.day
         and (s.resolved_at is null or s.resolved_at::date >= d.day)
        group by d.day
      ) t
    ),
    'by_day_new', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(s.id) as cnt
        from days d
        left join public.signals s
          on s.brand_id = p_brand_id and s.detected_at::date = d.day
        group by d.day
      ) t
    ),
    'by_day_resolved', (
      select coalesce(jsonb_object_agg(day, cnt), '{}'::jsonb)
      from (
        select d.day, count(s.id) as cnt
        from days d
        left join public.signals s
          on s.brand_id = p_brand_id and s.resolved_at::date = d.day
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
