-- ============================================================================
-- 00365: an action's result can read "mixed" (learning A4)
-- ============================================================================
-- The validation sweep (backend/src/lib/action-center/validate.js) compares an
-- action's metrics before it was raised and after it closed. One metric up
-- and another down used to read as "improved", which taught that anything
-- moving up was the work paying off. It now reads "mixed", as does a Site
-- Audit fix whose pages, audited again, only partly pass. The action's main
-- metric decides when it was measured; see deriveOutcome.

alter table public.actions
  drop constraint if exists actions_outcome_check;

alter table public.actions
  add constraint actions_outcome_check
  check (outcome in (
    'pending_measurement',
    'improved',
    'mixed',
    'no_meaningful_change',
    'declined',
    'not_measurable'
  ));

notify pgrst, 'reload schema';
