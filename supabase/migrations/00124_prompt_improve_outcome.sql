-- Did an Improve action move the prompt's positions? (PROMPT-008)
--
-- actions.baseline already holds the prompt's last 7 days per platform at
-- send time (fromPromptImprove.js). position_outcome is the same 7-day read
-- taken again every day while the action is open and for 30 days after it is
-- completed (improveOutcome.js), shown by the action's Outcome card, the
-- Positions panel and History:
--
--   { measuredAt, window: { from, to }, final,
--     platforms: [{ platform, before, after, verdict }],
--     summary: { total, measurable, improved, declined, avgBefore, avgAfter } }
--
-- verdict is improved | declined | unchanged | not_enough_data. final is true
-- for the read at day 30 after completion, which is not refreshed again.
alter table public.actions add column if not exists position_outcome jsonb;

comment on column public.actions.position_outcome is
  'Improve actions (PROMPT-008): the latest 7-day positions per platform next to the baseline, refreshed daily until 30 days after completion. Null for other kinds.';

-- The baseline is what the outcome is measured against, so it is fixed once
-- the action exists. Enforced here rather than trusted to every writer.
create or replace function public.actions_keep_improve_baseline()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.kind = 'prompt_improve' and new.baseline is distinct from old.baseline then
    raise exception 'The baseline of an Improve action cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists actions_keep_improve_baseline on public.actions;
create trigger actions_keep_improve_baseline
  before update of baseline on public.actions
  for each row execute function public.actions_keep_improve_baseline();
