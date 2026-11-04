-- ============================================================================
-- 00293: tasks waiting for review (AC-010)
-- ============================================================================
-- Every task an agent writes says the exact page, the change, when it is
-- done and how that is checked (AC-010; the fields live in
-- action_tasks.details). A task the AI task writer gives without one of
-- them doesn't reach the people doing the work: it waits here, for an
-- admin or a manager of the brand's organization to fill what it misses.
--
--   * action_task_reviews: one row per task waiting, with the task as it was
--     written (title and details) and the fields it misses ('url', 'change',
--     'doneWhen', 'check'). Not a task yet, so nothing that reads
--     action_tasks (the lists, counts, exports, the runner) sees it.
--   * approve_action_task_review: the reviewed task, its four fields filled,
--     goes onto the action's task list, after its last task, and the review
--     row goes, in one transaction. The trail says a task was added. It is
--     the reviewer's task now (source 'reviewed'): Regenerate tasks keeps
--     it, as it keeps a task someone added. Not on an action that is
--     deleted or closed.
--   * Admins and managers read and dismiss (delete) the rows; the server
--     writes them (service role). Edits go into the task on approval.

create table if not exists public.action_task_reviews (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  details jsonb not null default '{}'::jsonb,
  missing text[] not null default '{}'
    check (missing <@ array['url', 'change', 'doneWhen', 'check']::text[]),
  source text not null default 'ai' check (source in ('ai', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists action_task_reviews_action_idx
  on public.action_task_reviews (action_id);

-- Read and dismissed by admins and managers (the policies below); written by the server.
alter table public.action_task_reviews enable row level security;
revoke all on table public.action_task_reviews from anon, authenticated;
grant select, delete on table public.action_task_reviews to authenticated;
grant all on table public.action_task_reviews to service_role;

drop policy if exists "action_task_reviews: manager select" on public.action_task_reviews;
create policy "action_task_reviews: manager select"
  on public.action_task_reviews
  for select
  using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

drop policy if exists "action_task_reviews: manager delete" on public.action_task_reviews;
create policy "action_task_reviews: manager delete"
  on public.action_task_reviews
  for delete
  using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

comment on table public.action_task_reviews is
  'Action Center (AC-010): tasks an agent wrote without the exact page, the change, Done when or how it is checked (missing), waiting for an admin or a manager. Not tasks yet: approve_action_task_review puts one on its action''s list. The server writes them.';

-- The reviewed task onto its action's list, its four fields filled, and the
-- review row gone. Null when the row isn't there (approved or dismissed
-- meanwhile, or another organization's); an error when the caller isn't an
-- admin or a manager, the action is deleted or closed, or a field is still
-- missing.
create or replace function public.approve_action_task_review(
  p_review_id uuid,
  p_title text,
  p_details jsonb
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
begin
  -- The caller's role first, before any row is read or locked.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'manager')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Only a row of the caller's own organization: another's reads as not there.
  select r.* into v_review
  from public.action_task_reviews r
  join public.actions a on a.id = r.action_id
  join public.brands b on b.id = a.brand_id
  join public.profiles p on p.organization_id = b.organization_id
  where r.id = p_review_id
    and p.id = auth.uid()
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
  values (v_review.action_id, 'task_added', jsonb_build_object('title', v_title), auth.uid());

  update public.actions set updated_at = now() where id = v_review.action_id;

  return v_task_id;
end;
$$;

revoke all on function public.approve_action_task_review(uuid, text, jsonb) from public, anon;
grant execute on function public.approve_action_task_review(uuid, text, jsonb) to authenticated;

comment on function public.approve_action_task_review(uuid, text, jsonb) is
  'Action Center (AC-010): a task waiting for review (action_task_reviews) onto its action''s task list, after its last task, with the exact page, the change, Done when and how it is checked filled, as the reviewer''s (source reviewed); the review row goes and the trail says a task was added. Admins and managers of the brand''s organization only, on an action neither deleted nor closed. Null when the row is gone or another organization''s.';

notify pgrst, 'reload schema';
