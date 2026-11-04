-- ============================================================================
-- 00366: why an action was dismissed (learning A5)
-- ============================================================================
-- Dismissing an Action Center action asked nothing, so a dismissal taught
-- nothing: the same definition could open again 14 days later for the same
-- reason it was turned down. The person now says why, as a content
-- opportunity's dismissal does (CONTENT-006): the reason is kept while the
-- action stays dismissed, and cleared when it's set to another status.
-- Nothing reads it to rank or rest actions yet (phase B).

alter table public.actions
  add column if not exists dismiss_reason text;

alter table public.actions
  drop constraint if exists actions_dismiss_reason_check;

alter table public.actions
  add constraint actions_dismiss_reason_check
  check (
    dismiss_reason is null
    or dismiss_reason in ('not_relevant', 'already_done', 'wrong_data', 'not_now')
  );

comment on column public.actions.dismiss_reason is
  'Why the action was dismissed (00366, learning A5): not_relevant, already_done, wrong_data or not_now; null when no reason was given or the action is not dismissed.';

notify pgrst, 'reload schema';
