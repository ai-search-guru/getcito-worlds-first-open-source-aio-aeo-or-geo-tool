-- ============================================================================
-- 00422: daily suggestions — one Action Center action a day, in Chat's Inbox
-- ============================================================================
-- Daily improvement suggestions (CHAT-26), behind CHAT_AGENTIC: nothing
-- writes here while the flag is off. A nightly server job picks, by rules
-- and with no AI call, at most one open action a day per person and brand
-- (at most 7 in a rolling week), from what already waits in their Action
-- Center. The action itself is never touched. Off for the demo brand, a
-- read-only workspace and people without Action Center access.
--
--   * chat_suggestion_feeds: one per person and brand (CHAT-26 §10: what
--     one person ignores doesn't stop it for the others). on; paused by the
--     job after 30 days with no suggestion used (opened, started, put off or
--     removed: seeing the Inbox doesn't count), and on again only by the
--     person's click; off by the person (Settings › Notifications). The
--     first suggestion after turning it back on comes the next morning.
--     reminded_at: the one "Daily suggestions are paused · Turn back on"
--     line Chat Home showed after a pause.
--   * chat_suggestions: one per suggestion sent (§4): the action, the day it
--     was sent in the person's time zone (sent_on: one a day per feed), what
--     the person did with it (seen, opened, started in Chat or the Content
--     Editor, put off until, removed) and the texts and data row as sent
--     (summary). The Inbox shows the last 7 days; the nightly job deletes
--     rows older than 14 days ("renews every 14 days").
--
-- The server writes every row (service role): the person's clicks go
-- through its API, which also keeps the feed's last_used_at. A person reads
-- only their own rows, in the workspace they belong to now.

-- ─── Feeds ──────────────────────────────────────────────────────────────────

create table if not exists public.chat_suggestion_feeds (
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'on' check (status in ('on', 'paused', 'off')),
  paused_at timestamptz,
  last_used_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, brand_id),
  check ((status = 'paused') = (paused_at is not null))
);

create index if not exists chat_suggestion_feeds_brand_idx
  on public.chat_suggestion_feeds (brand_id);
create index if not exists chat_suggestion_feeds_organization_idx
  on public.chat_suggestion_feeds (organization_id);

drop trigger if exists trg_chat_suggestion_feeds_updated_at on public.chat_suggestion_feeds;
create trigger trg_chat_suggestion_feeds_updated_at
  before update on public.chat_suggestion_feeds
  for each row execute function public.handle_updated_at();

comment on table public.chat_suggestion_feeds is
  'Chat (00422): a person''s daily suggestions for one brand (CHAT-26): on, paused after 30 days unused (back on only by their click), or off; when they last used one, and the one Home reminder after a pause. Theirs to read; the server writes.';

-- ─── Suggestions ────────────────────────────────────────────────────────────

create table if not exists public.chat_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  action_id uuid not null references public.actions(id) on delete cascade,
  -- The day it was sent, in the person's time zone (or the workspace's).
  sent_on date not null,
  sent_at timestamptz not null default now(),
  seen_at timestamptz,
  opened_at timestamptz,
  -- Started with Do it with Chat (or the detail page's composer), or in the Content Editor.
  started_at timestamptz,
  started_via text check (started_via in ('chat', 'editor')),
  -- Not now: back in a week if the action is still open.
  snoozed_until timestamptz,
  removed_at timestamptz,
  -- The texts and data row as sent, assembled with no model call (§3 item 5).
  summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 32000
  ),
  -- One a day per person and brand: the job's backstop if it runs twice.
  unique (user_id, brand_id, sent_on),
  check ((started_at is null) = (started_via is null))
);

-- The Inbox: a person's last 7 days, newest first.
create index if not exists chat_suggestions_user_sent_idx
  on public.chat_suggestions (user_id, sent_at desc);
-- The picker: an action suggested to this person in the last 14 days.
create index if not exists chat_suggestions_user_action_idx
  on public.chat_suggestions (user_id, action_id, sent_at desc);
-- The nightly delete of rows older than 14 days.
create index if not exists chat_suggestions_sent_idx
  on public.chat_suggestions (sent_at);
create index if not exists chat_suggestions_brand_idx
  on public.chat_suggestions (brand_id);
create index if not exists chat_suggestions_action_idx
  on public.chat_suggestions (action_id);
create index if not exists chat_suggestions_organization_idx
  on public.chat_suggestions (organization_id);

comment on table public.chat_suggestions is
  'Chat (00422): a daily suggestion sent to a person (CHAT-26 §4): the action, the day, what they did with it, and the texts as sent. Shown 7 days, deleted after 14; the action is never touched. Theirs to read; the server writes.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_suggestion_feeds enable row level security;
alter table public.chat_suggestions enable row level security;

revoke all on table public.chat_suggestion_feeds from anon, authenticated;
revoke all on table public.chat_suggestions from anon, authenticated;

grant select on table public.chat_suggestion_feeds to authenticated;
grant select on table public.chat_suggestions to authenticated;

grant all on table public.chat_suggestion_feeds to service_role;
grant all on table public.chat_suggestions to service_role;

-- A person's own, in the workspace they belong to now.
drop policy if exists "chat_suggestion_feeds: own select" on public.chat_suggestion_feeds;
create policy "chat_suggestion_feeds: own select"
  on public.chat_suggestion_feeds
  for select
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "chat_suggestions: own select" on public.chat_suggestions;
create policy "chat_suggestions: own select"
  on public.chat_suggestions
  for select
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
