-- ============================================================================
-- 00375: approving a task waiting for review over the API and MCP (AC-010)
-- ============================================================================
-- approve_action_task_review (00293) takes the reviewer from auth.uid(), so
-- it only works for a signed-in admin or manager. The MCP tools authenticate
-- with an API key and reach the database as the service role, where
-- auth.uid() is null.
--
-- Restated with p_user_id: the person the service role approves for, the API
-- key's owner. It counts only for the service role; a signed-in caller is
-- always auth.uid(), whatever it passes. Either way the person must be an
-- admin or manager of the review's organization, and the trail says they
-- added the task, as from the dashboard. Nothing else changes.
--
-- The 3-argument function is dropped rather than overloaded: a call with
-- three arguments would match both, and the dashboard's call keeps working
-- through p_user_id's default.

drop function if exists public.approve_action_task_review(uuid, text, jsonb);

create or replace function public.approve_action_task_review(
  p_review_id uuid,
  p_title text,
  p_details jsonb,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.action_task_reviews%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_task_id uuid;
  -- Who approves: the API key's owner for the service role, else the caller.
  v_person uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
begin
  -- The person's role first, before any row is read or locked.
  if not exists (
    select 1 from public.profiles p
    where p.id = v_person and p.role in ('admin', 'manager')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Only a row of the person's own organization: another's reads as not there.
  select r.* into v_review
  from public.action_task_reviews r
  join public.actions a on a.id = r.action_id
  join public.brands b on b.id = a.brand_id
  join public.profiles p on p.organization_id = b.organization_id
  where r.id = p_review_id
    and p.id = v_person
  for update of r;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from public.actions a
    where a.id = v_review.action_id
      and (a.deleted_at is not null or a.status in ('completed', 'dismissed'))
  ) then
    raise exception 'action closed' using errcode = '55000';
  end if;

  if char_length(v_title) not between 1 and 200
    or jsonb_typeof(p_details) is distinct from 'object'
    or nullif(btrim(coalesce(p_details->>'url', '')), '') is null
    or nullif(btrim(coalesce(p_details->'change'->>'after', '')), '') is null
    or nullif(btrim(coalesce(p_details->>'doneWhen', '')), '') is null
    or coalesce(p_details->>'check', '') not in ('auto', 'rerun', 'manual')
  then
    raise exception 'incomplete task' using errcode = '22023';
  end if;

  insert into public.action_tasks (action_id, position, title, status, mode, permission, details)
  select
    v_review.action_id,
    coalesce(max(t.position), 0) + 1,
    v_title,
    'todo',
    'human',
    'read',
    -- The reviewer's task now: Regenerate keeps it (task-writer keepsTask).
    p_details || jsonb_build_object('source', 'reviewed')
  from public.action_tasks t
  where t.action_id = v_review.action_id
  returning id into v_task_id;

  delete from public.action_task_reviews where id = v_review.id;

  insert into public.action_events (action_id, event, data, actor_id)
  values (v_review.action_id, 'task_added', jsonb_build_object('title', v_title), v_person);

  update public.actions set updated_at = now() where id = v_review.action_id;

  return v_task_id;
end;
$$;

revoke all on function public.approve_action_task_review(uuid, text, jsonb, uuid)
  from public, anon;
grant execute on function public.approve_action_task_review(uuid, text, jsonb, uuid)
  to authenticated, service_role;

comment on function public.approve_action_task_review(uuid, text, jsonb, uuid) is
  'Action Center (AC-010): a task waiting for review (action_task_reviews) onto its action''s task list, after its last task, with the exact page, the change, Done when and how it is checked filled, as the reviewer''s (source reviewed); the review row goes and the trail says a task was added. Admins and managers of the brand''s organization only, on an action neither deleted nor closed; p_user_id is the person the service role approves for (00375), a signed-in caller is always auth.uid(). Null when the row is gone or another organization''s.';

notify pgrst, 'reload schema';
