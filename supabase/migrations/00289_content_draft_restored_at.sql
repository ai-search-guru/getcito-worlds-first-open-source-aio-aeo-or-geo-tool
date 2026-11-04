-- ============================================================================
-- 00289: when a draft's page was last restored from History
-- ============================================================================
-- The editor opens the agent's card closed when its latest batch is from
-- before the page was last restored: that batch was for the page before
-- (#1522's follow-up, #1536). The "restore" version can't say when: it is
-- kept only when the page differs from the draft's latest version (00215,
-- content_draft_keep_version), so a restore right after Mark ready, or after
-- an Undo all, leaves none.
--
-- content_drafts.restored_at is set by content_draft_restore (00215) each
-- time it changes the page; a restore of the page the draft already is
-- leaves it as it was, and says so ('restored': false), so the editor sets
-- nothing aside for it. Null for a draft never restored, and for one
-- restored before this: no backfill, as an update to content_drafts moves
-- its updated_at (the Library's order, an open editor's save base), and
-- #1522 hasn't shipped. It is the server's to write:
-- guard_content_draft_server_columns (00262) refuses a member's.

alter table public.content_drafts
  add column if not exists restored_at timestamptz;

comment on column public.content_drafts.restored_at is
  'When content_draft_restore last changed the page to a History version (00289): the agent''s batch from before it was for the page before. Null when never restored.';

-- As 00215's, with restored_at set when the page changes, and whether it did.
create or replace function public.content_draft_restore(p_version_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_version public.content_draft_versions%rowtype;
  v_draft public.content_drafts%rowtype;
  v_changed boolean;
begin
  select * into v_version
  from public.content_draft_versions v
  where v.id = p_version_id and v.created_at >= now() - interval '90 days';
  if v_version.id is null or not public.content_draft_member(v_version.draft_id) then
    return null;
  end if;

  select * into v_draft from public.content_drafts d where d.id = v_version.draft_id;
  -- Already this page: nothing to keep or change.
  v_changed := v_draft.title is distinct from v_version.title
    or v_draft.body_html is distinct from v_version.body_html;
  if v_changed then
    perform public.content_draft_keep_version(v_version.draft_id, 'restore');

    update public.content_drafts d
    set title = v_version.title, body_html = v_version.body_html, restored_at = now()
    where d.id = v_version.draft_id
    returning * into v_draft;
  end if;

  return jsonb_build_object(
    'title', v_draft.title,
    'bodyHtml', v_draft.body_html,
    'updatedAt', v_draft.updated_at,
    'restored', v_changed
  );
end;
$$;

revoke all on function public.content_draft_restore(uuid) from public, anon;
grant execute on function public.content_draft_restore(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- When the page was restored is the server's: as 00262's, with restored_at.
-- ----------------------------------------------------------------------------
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
    if new.published_url is not null or new.published_at is not null then
      raise exception 'content draft live address is set server-side'
        using errcode = '42501';
    end if;
    if new.restored_at is not null then
      raise exception 'content draft restore time is set server-side'
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
     or new.published_url is distinct from old.published_url
     or new.published_at is distinct from old.published_at
     or new.restored_at is distinct from old.restored_at
  then
    raise exception 'content draft column is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
