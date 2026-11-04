-- An opportunity can come from an Action Center task (AC-004): "Send to
-- Content" on a content task makes one, with the task's target, reasons and
-- steps, and a link back to the action it came from.

alter table public.content_opportunities
  drop constraint if exists content_opportunities_source_check;
alter table public.content_opportunities
  add constraint content_opportunities_source_check
  check (source in ('system', 'manual', 'prompt', 'action'));

-- One open opportunity per task: two sends at once (two tabs, two people)
-- make one, and the second finds it. An archived one frees the task to be
-- sent again.
create unique index if not exists content_opportunities_action_task_idx
  on public.content_opportunities ((source_data -> 'fromAction' ->> 'taskId'))
  where source = 'action' and status <> 'archived';
