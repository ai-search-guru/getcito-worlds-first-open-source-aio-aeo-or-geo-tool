-- Positions panel → Improve → Send Actions (PROMPT-004): the selected
-- suggestions become one Action Center action with a task each.
--
-- action_tasks.details: what a task sent from a suggestion carries beyond its
-- title — the body the user wrote or kept, the platform it is for, and the
-- evidence it was based on: { body, platform, platformLabel, sources: [{ type,
-- ref }] }. Null for library and hand-added tasks, which render as before.
alter table public.action_tasks add column if not exists details jsonb;

comment on column public.action_tasks.details is
  'Extra content for a task sent from the Improve tab (PROMPT-004): { body, platform, platformLabel, sources: [{ type, ref }] }. Null otherwise.';

-- prompt_improve_suggestions.sent_actions: every send of this set, newest
-- last — [{ actionId, actionNo, sentAt, setGeneratedAt, suggestionIds }]. The
-- panel shows "Open in Actions" for the newest send of the current set while
-- its action is still open, and marks the suggestions it carried.
alter table public.prompt_improve_suggestions
  add column if not exists sent_actions jsonb not null default '[]'::jsonb;
