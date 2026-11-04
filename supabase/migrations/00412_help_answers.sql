-- ============================================================================
-- 00412: Chat's Help answers — the answers it already gave, and the
-- questions Help couldn't answer
-- ============================================================================
-- Help in Chat (CHAT-19 §4–§6), behind CHAT_AGENTIC: nothing writes here
-- while the flag is off. A Help answer is written from the Help articles in
-- the repository (help/{area}/{slug}.md) alone: no workspace's data, files
-- or history goes into it (§5), so one answer serves every workspace.
-- Server only: staff read both tables with the service role.
--
--   * help_answer_cache: step 2 of §5's cheapest path. The same Help
--     question, normalized (case, spacing, punctuation), in the same
--     language and app version gets the answer given before, with no model
--     call. articles lists the articles it was written from ({area}/{slug}),
--     so an article that changes clears the answers built on it.
--   * help_gaps: a question Help had no good match for (§4 "Gaps"), for the
--     weekly list of articles to write: the question as asked, the page the
--     person was on, the closest article and its score. No workspace's or
--     person's id is kept: the log is anonymous.

-- ─── Answers given ──────────────────────────────────────────────────────────

create table if not exists public.help_answer_cache (
  id uuid primary key default gen_random_uuid(),
  -- The question as normalized, and its sha-256 (hex), the key.
  question text not null check (char_length(question) between 1 and 500),
  question_hash text not null check (question_hash ~ '^[0-9a-f]{64}$'),
  -- The language the answer is in (BCP 47) and the app version it is for.
  lang text not null check (lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  app_version text not null check (char_length(app_version) between 1 and 40),
  answer_md text not null check (char_length(answer_md) between 1 and 20000),
  -- The articles it was written from, as {area}/{slug}.
  articles text[] not null default '{}' check (cardinality(articles) <= 10),
  -- The model that wrote it.
  model text check (char_length(model) between 1 and 200),
  hits integer not null default 0 check (hits >= 0),
  created_at timestamptz not null default now(),
  last_hit_at timestamptz,
  unique (question_hash, lang, app_version)
);

-- An article that changed: the answers built on it.
create index if not exists help_answer_cache_articles_idx
  on public.help_answer_cache using gin (articles);

comment on table public.help_answer_cache is
  'Help in Chat (00412): a Help answer by normalized question, language and app version (CHAT-19 §5 step 2), written from the listed Help articles only, with no workspace data. Cleared for an article when it changes. Server only.';

-- ─── Questions with no good answer ──────────────────────────────────────────

create table if not exists public.help_gaps (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 1 and 500),
  lang text not null check (lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  -- The app page the person asked from.
  route text check (char_length(route) between 1 and 500),
  -- The closest article ({area}/{slug}) and its retrieval score; null when
  -- nothing matched at all.
  best_article text check (char_length(best_article) between 1 and 200),
  best_score real check (best_score >= 0),
  app_version text check (char_length(app_version) between 1 and 40),
  created_at timestamptz not null default now()
);

-- The weekly list, newest first.
create index if not exists help_gaps_created_idx
  on public.help_gaps (created_at desc);

comment on table public.help_gaps is
  'Help in Chat (00412): questions Help had no good match for (CHAT-19 §4 Gaps), anonymous: the question, the page, the closest article and its score. For the weekly list of new articles. Server only.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.help_answer_cache enable row level security;
alter table public.help_gaps enable row level security;

revoke all on table public.help_answer_cache from anon, authenticated;
revoke all on table public.help_gaps from anon, authenticated;

grant all on table public.help_answer_cache to service_role;
grant all on table public.help_gaps to service_role;

notify pgrst, 'reload schema';
