-- ============================================================================
-- 00222: why a customer cancels, or asks for three days first
-- ============================================================================
-- Settings › Billing › Cancel Subscription asks what went wrong before the
-- plan is cancelled: a few reasons to tick and a message, both optional. The
-- customer then either cancels (at the end of the period, as before) or asks
-- the team to act within three days, and the plan stays as it is.
--
-- Each answer is e-mailed to the team (CANCEL_FEEDBACK_EMAILS on the server)
-- and kept here, so a failed e-mail loses nothing and the reasons can be
-- counted later.
--
-- Written and read by the Express server's service-role client only: RLS on,
-- no policies, and the default grants to anon and authenticated revoked (as
-- 00183 does), since the table holds customers' free-text messages.

create table if not exists public.cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  reasons text[] not null default '{}',
  message text not null default '' check (char_length(message) <= 2000),
  -- 'cancel': cancelled the plan; 'wait': asked the team to act within three days.
  choice text not null check (choice in ('cancel', 'wait')),
  -- The plan and its state when the answer was given.
  plan text,
  subscription_status text,
  -- What became of the e-mail: sent, refused, unknown or skipped (see backend/src/lib/email.js).
  email_status text,
  created_at timestamptz not null default now()
);

create index if not exists cancellation_feedback_org_created_idx
  on public.cancellation_feedback (organization_id, created_at desc);

alter table public.cancellation_feedback enable row level security;
revoke all on public.cancellation_feedback from anon, authenticated;

comment on table public.cancellation_feedback is
  'Why a customer cancels, or asks the team for three days first (Settings › Billing). E-mailed to CANCEL_FEEDBACK_EMAILS; server-only.';
