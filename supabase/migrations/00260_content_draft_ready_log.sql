-- ============================================================================
-- 00260: Mark ready anyway, logged (Content Editor Quality, CE-041)
-- ============================================================================
-- Before you publish (Quality spec §7) warns when a page's Trust is under 60
-- and still lets the person mark it ready: "Mark ready anyway (logged)".
-- Each time, a row keeps the Trust the page had, the check the warning named
-- (its id, e.g. claimsSourced, and how many it counted) and who marked it.
--
-- A member adds a row as themselves, only for a draft of their brand that is
-- ready, and gives only the draft, the Trust and the reason: who and when
-- are the database's. Members read them; nothing changes or deletes them,
-- and they go with the draft.

create table if not exists public.content_draft_ready_log (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  trust smallint not null check (trust between 0 and 100),
  reason text check (reason is null or reason ~ '^[A-Za-z]{1,40}$'),
  reason_count integer check (reason_count is null or reason_count >= 0),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_draft_ready_log_draft_idx
  on public.content_draft_ready_log (draft_id, created_at desc);

alter table public.content_draft_ready_log enable row level security;
revoke all on table public.content_draft_ready_log from anon, authenticated;
grant select on table public.content_draft_ready_log to authenticated;
grant insert (draft_id, trust, reason, reason_count)
  on table public.content_draft_ready_log to authenticated;
grant all on table public.content_draft_ready_log to service_role;

drop policy if exists "content_draft_ready_log: member select" on public.content_draft_ready_log;
create policy "content_draft_ready_log: member select"
  on public.content_draft_ready_log
  for select
  using (public.content_draft_member(draft_id));

drop policy if exists "content_draft_ready_log: member insert" on public.content_draft_ready_log;
create policy "content_draft_ready_log: member insert"
  on public.content_draft_ready_log
  for insert
  with check (
    public.content_draft_member(draft_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.content_drafts d
      where d.id = draft_id and d.status = 'ready'
    )
  );

comment on table public.content_draft_ready_log is
  'Content Editor Quality (CE-041): each "Mark ready anyway" past the Trust < 60 warning — the Trust the page had, the check the warning named and its count, who and when. Added by members as themselves for a ready draft; never changed.';
