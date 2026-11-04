-- ============================================================================
-- 00247: a whole-page suggestion (Content Editor, Rewrite the page to these rules)
-- ============================================================================
-- Apply rules with Agent leaves at most 8 small edits a run, which can't
-- bring a 19,000-character page to an 8,000-character Length (about 2% a
-- run on prod, 2026-10-23). Rewrite the page to these rules has the Content
-- Agent rewrite the whole page in one call, left as ONE suggestion the
-- person compares with their page and accepts or rejects:
--
--   * kind 'page': after_text is the whole page's HTML, up to 500,000
--     characters (the editor's body limit), not 20,000;
--   * before_html: the page as the agent read it, which the editor checks
--     the page against before applying it and puts back on Undo. A page
--     suggestion has it; the others don't;
--   * before_text stays '' for it, as for an insert.
--
-- Rows are still written by the server only; the decide RPC (00217) and
-- RLS are unchanged.
--
-- content_drafts.agent_run says which run holds the draft ('write' or
-- 'rewrite'), so every device knows a failed rewrite from a failed Start;
-- 00219's guard keeps it server-set.

alter table public.content_draft_suggestions
  add column if not exists before_html text;

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_kind_check,
  add constraint content_draft_suggestions_kind_check
    check (kind in ('replace', 'insert', 'page'));

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_after_text_check,
  add constraint content_draft_suggestions_after_text_check
    check (char_length(after_text) between 1 and case when kind = 'page' then 500000 else 20000 end);

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_check,
  add constraint content_draft_suggestions_check
    check (kind in ('insert', 'page') or before_text <> '');

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_before_html_check,
  add constraint content_draft_suggestions_before_html_check
    check ((kind = 'page') = (before_html is not null)
           and char_length(coalesce(before_html, '')) <= 500000);

comment on column public.content_draft_suggestions.before_html is
  'A page suggestion''s page as the agent read it (kind ''page'', 00247): checked against the editor''s page before applying, and put back on Undo. Null for the others.';

-- Which run holds the draft, or last held it (agent_state): Start with Agent
-- ('write': a new page, or suggestions on a live one) or Rewrite the page to
-- these rules ('rewrite'). The editor reads it to say which run failed and to
-- try that one again, on any device: a failed rewrite tried again is a
-- rewrite to compare, never a new page over the current one. Server-set,
-- with agent_state.
alter table public.content_drafts
  add column if not exists agent_run text;

alter table public.content_drafts
  drop constraint if exists content_drafts_agent_run_check,
  add constraint content_drafts_agent_run_check
    check (agent_run is null or agent_run in ('write', 'rewrite'));

comment on column public.content_drafts.agent_run is
  'Content Editor: the run that holds the draft or last held it (00247): ''write'' (Start with Agent) or ''rewrite'' (Rewrite the page to these rules). Server-set, with agent_state.';

-- 00219's guard, with agent_run among the columns only the server sets.
create or replace function public.guard_content_draft_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A role that bypasses RLS is server-side (service role, migrations).
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.score_before is not null or new.score_after is not null then
      raise exception 'content draft scores are set server-side'
        using errcode = '42501';
    end if;
    if new.action_id is not null then
      raise exception 'content draft action is set server-side'
        using errcode = '42501';
    end if;
    if new.agent_state is not null or new.agent_state_at is not null
       or new.agent_run is not null then
      raise exception 'content draft agent state is set server-side'
        using errcode = '42501';
    end if;
  elsif new.brand_id is distinct from old.brand_id
     or new.author is distinct from old.author
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.score_before is distinct from old.score_before
     or new.score_after is distinct from old.score_after
     or new.action_id is distinct from old.action_id
     or new.agent_state is distinct from old.agent_state
     or new.agent_state_at is distinct from old.agent_state_at
     or new.agent_run is distinct from old.agent_run
  then
    raise exception 'content draft column is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
