-- ============================================================================
-- 00467: a scheduled job's e-mails to addresses outside the workspace, each
-- sent only with a click
-- ============================================================================
-- Chat Wave 4 (W4-28, Wave 4 decision 16), behind CHAT_AGENTIC. A job still
-- e-mails the people of its workspace by itself (00457's recipient_ids).
-- For an outside address it only prepares the e-mail: someone clicks Send
-- on the Inbox card, every time (an EXECUTE; the go-live permission never
-- covers it). Nothing reads or writes these yet.
--
--   * chat_schedules.external_recipients: up to 5 outside addresses on a
--     job, lowercase and once each. Only Admins and Managers add them, on
--     Starter and up (the server checks role and plan).
--   * chat_outbound_emails: one prepared e-mail per run and address:
--       - what: the address, the subject, the 3–5 line summary (an outside
--         reader gets no link that asks them to sign in) and the files to
--         attach (the report's PDF);
--       - state: pending, then sent (with when, who clicked, and Resend's
--         id), cancelled, or expired 7 days after it was prepared. A failed
--         send stays pending with why, so Send can be tried again.
--     The workspace's sends a day (50 at most) are counted from its sent
--     rows.
--   * Read as the job is (00457): its creator and the Admins, within the
--     brands they can access. The server writes.

-- ─── Outside addresses on a job ─────────────────────────────────────────────

alter table public.chat_schedules
  add column if not exists external_recipients text[] not null default '{}' check (
    cardinality(external_recipients) <= 5
    and public.chat_text_array_distinct(external_recipients)
    and octet_length(public.chat_text_array_words(external_recipients)) <= 1300
    and public.chat_text_array_words(external_recipients)
      ~ '^([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}( [a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})*)?$'
  );

comment on column public.chat_schedules.external_recipients is
  'Up to 5 addresses outside the workspace (00467; W4-28): the job prepares their e-mails (chat_outbound_emails) and someone clicks Send each time. Lowercase, once each.';

-- ─── Prepared e-mails ───────────────────────────────────────────────────────

create table if not exists public.chat_outbound_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.chat_schedules(id) on delete cascade,
  -- The run that prepared it. Null once the run's row is gone.
  schedule_run_id uuid references public.chat_schedule_runs(id) on delete set null,
  to_address text not null check (
    char_length(to_address) <= 254
    and to_address ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
  ),
  subject text not null check (char_length(subject) between 1 and 200),
  -- The answer's first lines (the job e-mail's summary), no sign-in link.
  summary text not null check (char_length(summary) between 1 and 2000),
  -- [{path, name, bytes}]: what goes attached (the report's PDF).
  files jsonb not null default '[]'::jsonb check (
    jsonb_typeof(files) = 'array'
    and jsonb_array_length(files) <= 5
    and octet_length(files::text) <= 8000
  ),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  -- Who clicked Send; Reply-to is theirs.
  approved_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  resend_id text check (char_length(resend_id) between 1 and 200),
  -- Why the last Send failed, in plain words: never a raw error.
  send_error text check (char_length(send_error) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null)),
  check (resend_id is null or status = 'sent'),
  check (send_error is null or status = 'pending'),
  check (expires_at > created_at)
);

-- One e-mail per run and address.
create unique index if not exists chat_outbound_emails_run_address_uidx
  on public.chat_outbound_emails (schedule_run_id, to_address)
  where schedule_run_id is not null;
-- A job's e-mails, newest first (the Inbox cards, the job's history).
create index if not exists chat_outbound_emails_schedule_created_idx
  on public.chat_outbound_emails (schedule_id, created_at desc);
-- The workspace's sends in the last day (the daily limit).
create index if not exists chat_outbound_emails_organization_sent_idx
  on public.chat_outbound_emails (organization_id, sent_at)
  where status = 'sent';
-- What expires next.
create index if not exists chat_outbound_emails_pending_expires_idx
  on public.chat_outbound_emails (expires_at)
  where status = 'pending';
create index if not exists chat_outbound_emails_approved_by_idx
  on public.chat_outbound_emails (approved_by) where approved_by is not null;

drop trigger if exists trg_chat_outbound_emails_updated_at on public.chat_outbound_emails;
create trigger trg_chat_outbound_emails_updated_at
  before update on public.chat_outbound_emails
  for each row execute function public.handle_updated_at();

comment on table public.chat_outbound_emails is
  'Chat (00467; W4-28): a scheduled job''s e-mail to an address outside the workspace, prepared by its run and sent only when someone clicks Send (pending → sent, cancelled, or expired after 7 days). Read as the job is; the server writes.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_outbound_emails enable row level security;
revoke all on table public.chat_outbound_emails from anon, authenticated;
grant select on table public.chat_outbound_emails to authenticated;
grant all on table public.chat_outbound_emails to service_role;

-- A job's e-mails follow it (its creator and the Admins, within brand access).
drop policy if exists "chat_outbound_emails: schedule select" on public.chat_outbound_emails;
create policy "chat_outbound_emails: schedule select"
  on public.chat_outbound_emails
  for select
  to authenticated
  using (schedule_id in (select s.id from public.chat_schedules s));

notify pgrst, 'reload schema';
