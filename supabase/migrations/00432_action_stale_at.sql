-- ============================================================================
-- 00432: stale actions
-- ============================================================================
-- An action could stay New for months: only candidates went stale (when
-- nothing detected them any more), so a list held months-old actions side by
-- side with last night's, all reading the same. The nightly pass now marks an
-- action that is still New and that no one has touched (assigned, edited, a
-- task moved, sent) for 30 days as stale, here; it stays New, and is neither
-- closed nor dismissed. Still relevant clears it and starts the clock again,
-- and so does anyone's change to the action, or its leaving New.
--
-- A column, not a status: a stale action is still New to everything that
-- reads its status (the open list, the nightly rescoring, the dedup index),
-- so actions_status_check stays as it is.

alter table public.actions
  add column if not exists stale_at timestamptz;

comment on column public.actions.stale_at is
  'When the nightly pass found the action New with no one''s event for 30 days (00432); null when it is not stale. Cleared by Still relevant, by anyone''s change, and when it leaves New.';

-- The Stale filter, and the nightly pass's clearing of actions no longer stale.
create index if not exists actions_brand_stale_idx
  on public.actions (brand_id)
  where stale_at is not null;

notify pgrst, 'reload schema';
