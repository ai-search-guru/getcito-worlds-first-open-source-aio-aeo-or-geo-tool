-- ============================================================================
-- 00208: a draft sent to the Action Center (Content Editor, CE-015)
-- ============================================================================
-- Start asks who does the page (Content Editor spec v2 §5): Me opens the
-- editor; Team sends it to the Action Center as an action (§15), for someone
-- on the team to write. The draft keeps the action it was sent as:
--
--   * content_drafts.action_id: the action, set by the server when it
--     creates it (fromContentDraft.js). Like the draft's author and
--     scores, it is the server's to write: guard_content_draft_server_columns
--     (00204) is redefined to keep members from setting or changing it, so a
--     draft can't claim another action.

alter table public.content_drafts
  add column if not exists action_id uuid references public.actions(id) on delete set null;

comment on column public.content_drafts.action_id is
  'Content Editor (CE-015): the Action Center action the draft was sent as (Start › Team). Server-set.';

create index if not exists content_drafts_action_idx
  on public.content_drafts (action_id)
  where action_id is not null;

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
  elsif new.brand_id is distinct from old.brand_id
     or new.author is distinct from old.author
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.score_before is distinct from old.score_before
     or new.score_after is distinct from old.score_after
     or new.action_id is distinct from old.action_id
  then
    raise exception 'content draft column is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
