-- ============================================================================
-- 00187: the AI Traffic weekly digest (AT-013)
-- ============================================================================
-- Spec §3.8: "A weekly e-mail digest with the summary line and the top three
-- changes." Sent on Mondays for the week before, per brand, to the Daily
-- Pulse's recipients (00036), unless the pulse is off (frequency 'off').
--
--   * pulse_settings.traffic_digest — on unless an admin or manager turns it
--     off in Settings › Notifications. A brand with no settings row gets it.
--   * ai_traffic_digests — one row per brand and week: the claim that stops
--     a second send, what went out, and when (sent_at, set just before the
--     e-mail goes, so a stop after the send never mails the week twice). A
--     claim with no sent_at was left by a sweep that stopped before sending;
--     the next one (through Wednesday) takes it over.
--
-- Written by the Express server's service-role client; members read their
-- brands' rows, as with sent_pulses.

alter table public.pulse_settings
  add column if not exists traffic_digest boolean not null default true;

comment on column public.pulse_settings.traffic_digest is
  'Whether the AI Traffic weekly digest (AT-013) is e-mailed for the brand, to the pulse''s recipients.';

create table if not exists public.ai_traffic_digests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- The Monday the reported week starts on (UTC).
  week_start date not null,
  payload jsonb not null default '{}'::jsonb,
  email_sent boolean not null default false,
  email_recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (brand_id, week_start)
);

alter table public.ai_traffic_digests enable row level security;

grant select on public.ai_traffic_digests to authenticated;

create policy "ai_traffic_digests: member select" on public.ai_traffic_digests
  for select using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.ai_traffic_digests is
  'AI Traffic weekly digests sent (AT-013): one per brand and week, claimed before sending so a week is never mailed twice.';
