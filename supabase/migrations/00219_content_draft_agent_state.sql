-- ============================================================================
-- 00219: the Content Agent writing a draft (Content Editor, CE-015)
-- ============================================================================
-- "Agent" in Start (spec v2 §5): the Content Agent writes the page, and the
-- person reviews it in Library › In review. The writing runs on the server
-- after Start closes, so the draft says where it is:
--
--   * content_drafts.agent_state: 'writing' while the agent works on it,
--     'failed' when it couldn't finish (the person writes it, or tries
--     again), null otherwise. A 'writing' left by a server that stopped
--     reads as failed after a while (the app's WRITING_STALE_MS);
--   * content_drafts.agent_state_at: when it last changed.
--
-- Like the draft's author and action, they are the server's to write:
-- guard_content_draft_server_columns (00208) is redefined to keep members
-- from setting or changing them.

alter table public.content_drafts
  add column if not exists agent_state text,
  add column if not exists agent_state_at timestamptz;

alter table public.content_drafts
  drop constraint if exists content_drafts_agent_state_check;
alter table public.content_drafts
  add constraint content_drafts_agent_state_check
  check (agent_state is null or agent_state in ('writing', 'failed'));

comment on column public.content_drafts.agent_state is
  'Content Editor (CE-015): writing while the Content Agent writes the draft, failed when it could not finish, else null. Server-set.';
comment on column public.content_drafts.agent_state_at is
  'Content Editor (CE-015): when agent_state last changed. Server-set.';

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
    if new.agent_state is not null or new.agent_state_at is not null then
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
  then
    raise exception 'content draft column is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
