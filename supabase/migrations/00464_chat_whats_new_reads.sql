-- ============================================================================
-- 00464: which What's new entries a person has read
-- ============================================================================
-- What's new (CHAT-11 §E, Wave 4), behind CHAT_AGENTIC. The entries
-- themselves live in the repository (whats-new/{slug}.md, approved ones in
-- web lib/chat/whats-new/entries.json, Wave 4 decision 13); this table only
-- keeps who read which, so Home's New line, the chip's dot and
-- `?unread=true` leave read entries out.
--
--   * chat_whats_new_reads: one row per person and entry, by the entry's
--     slug, with when it was read: shown in a What's new answer, its Show me
--     sent, or its link opened (CHAT-11 item 18). Per person, the same in
--     the side panel and on the full page. Rows go with the person's
--     account. Home's line also drops an entry 14 days after it was
--     published (decision 14), which the entry's own date tells: no row.
--   * A person reads only their own rows; the server writes them.

create table if not exists public.chat_whats_new_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The entry's file name without .md: lowercase words and single hyphens.
  entry_slug text not null check (
    char_length(entry_slug) <= 80 and entry_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  read_at timestamptz not null default now(),
  primary key (user_id, entry_slug)
);

comment on table public.chat_whats_new_reads is
  'What''s new (00464; CHAT-11 §E): the entries a person has read, by slug. Their own rows only; the server writes.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_whats_new_reads enable row level security;
revoke all on table public.chat_whats_new_reads from anon, authenticated;
grant select on table public.chat_whats_new_reads to authenticated;
grant all on table public.chat_whats_new_reads to service_role;

drop policy if exists "chat_whats_new_reads: own select" on public.chat_whats_new_reads;
create policy "chat_whats_new_reads: own select"
  on public.chat_whats_new_reads
  for select
  to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
