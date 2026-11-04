-- ============================================================================
-- 00408: a person's Chat settings — the rest of Settings › General, the
-- panel and rail they left, and what Chat already showed them once
-- ============================================================================
-- Chat's settings follow the person to every device (DECISIONS N3), so they
-- live on chat_user_prefs (00400) with the menu, focus, model and effort.
-- Behind CHAT_AGENTIC: nothing reads them while the flag is off. The person
-- reads and writes their own row (00400's policies); the server checks what
-- their plan and role allow before it acts on one (Full auto, Slack).
--
--   * rail_open: the app sidebar on Chat screens, expanded (true) or the
--     56px rail (false, the default; CHAT-01 4f).
--   * panel_size: the side panel's last size (CHAT-01 item 16): compact
--     (420px, the default), wide (640px) or full screen.
--   * default_mode: the mode a new chat starts in (Settings › General;
--     CHAT-23 chatSettings.defaultMode): Ask me first, Auto (the default) or
--     Full auto, which the server allows only where the plan and the
--     workspace's switch do (CHAT-20 §5).
--   * answer_language: the language Chat answers in, a BCP 47 tag ('tr',
--     'pt-BR'). Null: the language the person writes in. The app itself
--     stays in English.
--   * notify_via: when an agent needs them (CHAT-23 chatSettings.notifyChannel):
--     Inbox and email (the default), Inbox only, or Inbox and Slack (offered
--     once Slack is connected).
--   * show_thought: "Thought for N s" under answers.
--   * panel_on_pages: Ask Chat · Ctrl J in every app page's header.
--   * focus_prompted_at: when the focus picker (CHAT-24) was last shown, so
--     it isn't shown again too soon; focus itself (00400) stays null until
--     they pick or skip.
--   * usage_notice_period: the first day of the AI usage period whose 80%
--     notice they saw (CHAT-04 item 16: once per person per period). Null:
--     none seen yet.
--   * legacy_imported_at: when their Agent Chat conversations
--     (agent_conversations, 00009) were copied into Chat, keeping their ids,
--     on their first visit to Chat. Null: not copied yet.

alter table public.chat_user_prefs
  add column if not exists rail_open boolean not null default false,
  add column if not exists panel_size text not null default 'compact'
    check (panel_size in ('compact', 'wide', 'full')),
  add column if not exists default_mode text not null default 'auto'
    check (default_mode in ('ask_first', 'auto', 'full_auto')),
  add column if not exists answer_language text
    check (answer_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  add column if not exists notify_via text not null default 'inbox_email'
    check (notify_via in ('inbox_email', 'inbox', 'inbox_slack')),
  add column if not exists show_thought boolean not null default true,
  add column if not exists panel_on_pages boolean not null default true,
  add column if not exists focus_prompted_at timestamptz,
  add column if not exists usage_notice_period date,
  add column if not exists legacy_imported_at timestamptz;

comment on column public.chat_user_prefs.rail_open is
  'The app sidebar on Chat screens: expanded (true) or the 56px rail (false, the default; CHAT-01 4f).';
comment on column public.chat_user_prefs.panel_size is
  'The side panel''s last size (CHAT-01 item 16): compact (420px), wide (640px) or full.';
comment on column public.chat_user_prefs.default_mode is
  'The mode a new chat starts in: ask_first, auto or full_auto (Full auto only where the plan and the workspace allow; the server checks).';
comment on column public.chat_user_prefs.answer_language is
  'The language Chat answers in (BCP 47). Null: the language the person writes in.';
comment on column public.chat_user_prefs.notify_via is
  'When an agent needs them: inbox_email, inbox or inbox_slack (CHAT-23 chatSettings.notifyChannel).';
comment on column public.chat_user_prefs.usage_notice_period is
  'The first day of the AI usage period whose 80% notice they saw (CHAT-04 item 16). Null: none yet.';
comment on column public.chat_user_prefs.legacy_imported_at is
  'When their Agent Chat conversations (00009) were copied into Chat with their ids. Null: not yet.';

comment on table public.chat_user_prefs is
  'Chat (00400, 00408): a person''s Chat settings, on the server so they follow them to every device (DECISIONS N3): menu, rail and panel, where pages open, focus areas, model, effort, default mode, answer language, notifications, Thought for N s, Ask Chat on pages, and the one-time notices and copy. Theirs to read and write.';

notify pgrst, 'reload schema';
