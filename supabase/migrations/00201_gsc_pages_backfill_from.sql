-- ============================================================================
-- 00201: the Search Console page backfill resumes where it stopped
-- ============================================================================
-- Follow-up from #1177's review (AT-008). The page sync read the property's
-- 190 days again on every run until one got through them all
-- (gsc_pages_backfilled_property, 00181), so a window that kept failing made
-- every daily run read the whole history again. It now reads a week at a
-- time (gscSync.js), and keeps how far back the backfill has read:
--
--   * gsc_pages_backfilled_property: the property the brand's page rows
--     belong to. Set once its last 28 days are read, and when it names
--     another property, that one's page rows are dropped first.
--   * gsc_pages_backfill_from: the oldest day the property's backfill has
--     read so far, while it hasn't reached its 190 days; null once it has.
--     A sync cut short resumes the day after.
--
-- A brand backfilled before this column (property set, this null) reads as
-- done, as it was.

alter table public.brands
    add column if not exists gsc_pages_backfill_from date;

comment on column public.brands.gsc_pages_backfill_from is
  'AI Traffic (AT-008): the oldest day the Search Console page backfill for gsc_pages_backfilled_property has read while it hasn''t reached its 190 days; null once it has (gscSync.js).';
