-- 00020_brand_is_active.sql
-- Add a pause/resume switch to brands.
--
-- A brand can now be temporarily paused: pausing suspends daily tracking
-- (and all on-demand tracking spend) while keeping every bit of historical
-- data viewable. Resuming re-enables tracking on the next cron run.
--
-- Existing brands default to active so behavior is unchanged on rollout.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN brands.is_active IS
  'When false, the brand is paused: the daily tracking cron and on-demand tracking skip it. Historical data stays viewable. Defaults to true.';
