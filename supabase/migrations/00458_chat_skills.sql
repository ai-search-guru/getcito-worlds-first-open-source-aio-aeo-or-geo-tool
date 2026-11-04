-- ============================================================================
-- 00458: Chat's workspace skills — the skills a workspace made or imported,
-- and the GetCito library skills it turned off
-- ============================================================================
-- Skills (CHAT-13, Wave 3), behind CHAT_AGENTIC: nothing reads or writes
-- these while the flag is off. The GetCito library stays in the repository
-- (/skills, read by web lib/chat/skills/library.ts); these are a workspace's
-- own. The server writes every row (service role), after checking the file
-- with checkSkillFile and scanSkillText (web lib/chat/skills/format.ts), the
-- role and the plan's limits.
--
--   * chat_skills: one skill (CHAT-13 Data notes):
--       - what it is: name (the /command: 1–64 lowercase letters, digits and
--         single hyphens; once in the workspace), title, description
--         (1–1,024), the Markdown body (at most 50 KB, item 2),
--         compatibility, license and its text.
--       - where it came from: user (made in Chat: the workspace's own) or
--         import (an upload or a GitHub URL: third party, instruction-only);
--         the source URL and the commit it is pinned to, and the SHA-256 of
--         the cleaned file (a skill whose checksum stops matching is turned
--         off, item 19). An import carries one of the licenses the owner
--         accepted (Wave 3 decision 6): MIT, Apache-2.0, BSD-2-Clause,
--         BSD-3-Clause or ISC.
--       - review: what the scan found and what the cleanup removed, the
--         status (pending_review, approved, rejected, blocked: blocked can't
--         be approved, item 18) and the Admin who approved it.
--       - use: private (its creator and the Admins) or workspace (every
--         member, once approved), on or off (only an approved skill is on),
--         and the newer commit an update would bring.
--   * chat_settings.disabled_skills: the GetCito library skills the
--     workspace turned off, by name (Wave 3 decision 10: workspace-wide).

-- ─── Skills ─────────────────────────────────────────────────────────────────

create table if not exists public.chat_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The /command (CHAT-13 item 1; format.ts SKILL_NAME and MAX_NAME).
  name text not null check (char_length(name) <= 64 and name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- metadata.title, else the name with spaces: what the step and / menu show.
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 1024),
  -- The cleaned Markdown body: at most 50 KB (format.ts MAX_BYTES).
  body text not null check (char_length(body) >= 1 and octet_length(body) <= 51200),
  compatibility text check (char_length(compatibility) between 1 and 500),
  license text check (
    license in ('MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC')
  ),
  license_text text check (char_length(license_text) between 1 and 30000),
  source text not null default 'user' check (source in ('user', 'import')),
  source_url text check (char_length(source_url) <= 2048 and source_url ~ '^https://'),
  -- The commit a URL import is pinned to: it never updates by itself.
  commit_sha text check (commit_sha ~ '^[0-9a-f]{40}$'),
  -- SHA-256 of the cleaned file.
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- scanSkillText's {blocks, warns}, and the removed parts ("scripts/ (3
  -- files)", "allowed-tools", …) the review lists (items 15–17).
  scan_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(scan_json) = 'object' and octet_length(scan_json::text) <= 64000
  ),
  removed_json jsonb not null default '[]'::jsonb check (
    jsonb_typeof(removed_json) = 'array' and octet_length(removed_json::text) <= 16000
  ),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'blocked')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  enabled boolean not null default false,
  -- A newer commit of the skill's folder: "Update available" (item 19).
  update_sha text check (update_sha ~ '^[0-9a-f]{40}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One name per workspace (item 1).
  unique (organization_id, name),
  check (not enabled or status = 'approved'),
  -- A third-party skill carries a license the owner accepted.
  check (source = 'user' or license is not null),
  check (license_text is null or license is not null),
  -- Only an import has a source; a pinned commit has its URL; an update its pin.
  check (source = 'import' or (source_url is null and commit_sha is null)),
  check (commit_sha is null or source_url is not null),
  check (update_sha is null or commit_sha is not null)
);

-- My skills and the review queue: the workspace's skills by status.
create index if not exists chat_skills_organization_status_idx
  on public.chat_skills (organization_id, status);
create index if not exists chat_skills_created_by_idx
  on public.chat_skills (created_by) where created_by is not null;

drop trigger if exists trg_chat_skills_updated_at on public.chat_skills;
create trigger trg_chat_skills_updated_at
  before update on public.chat_skills
  for each row execute function public.handle_updated_at();

comment on table public.chat_skills is
  'Chat (00458): a workspace''s own skill (CHAT-13): name (once in the workspace), title, description, body (≤ 50 KB), license; made in Chat (user) or imported (an upload or a pinned GitHub commit, with its checksum); scan, removed parts and review status; private or workspace, on or off. Private: its creator and the Admins; workspace: every member once approved. The server writes.';
comment on column public.chat_skills.license is
  'The license an import carries: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC (Wave 3 decision 6). Null for a skill made in Chat.';
comment on column public.chat_skills.checksum_sha256 is
  'SHA-256 of the cleaned file (CHAT-13 item 19): a skill whose file no longer matches it is turned off.';

-- ─── Library skills a workspace turned off ──────────────────────────────────

alter table public.chat_settings
  add column if not exists disabled_skills text[] not null default '{}' check (
    cardinality(disabled_skills) <= 100
    and public.chat_text_array_distinct(disabled_skills)
    and public.chat_text_array_words(disabled_skills)
      ~ '^([a-z0-9]+(-[a-z0-9]+)*( [a-z0-9]+(-[a-z0-9]+)*)*)?$'
  );

comment on column public.chat_settings.disabled_skills is
  'The GetCito library skills (/skills) the workspace turned off, by name (CHAT-13; workspace-wide, by an Admin). Its own skills turn off with chat_skills.enabled.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_skills enable row level security;
revoke all on table public.chat_skills from anon, authenticated;
grant select on table public.chat_skills to authenticated;
grant all on table public.chat_skills to service_role;

-- A private skill, or one not approved yet: its creator and the workspace's
-- Admins (who review it). An approved workspace skill: every member, while
-- they belong to the workspace.
drop policy if exists "chat_skills: member select" on public.chat_skills;
create policy "chat_skills: member select"
  on public.chat_skills
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or chat_skills.created_by = auth.uid()
          or (chat_skills.visibility = 'workspace' and chat_skills.status = 'approved')
        )
    )
  );

notify pgrst, 'reload schema';
