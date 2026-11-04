-- ============================================================================
-- 00465: workspace skills added from the Library, and the weekly update check
-- ============================================================================
-- Chat Wave 4 (CHAT-17, W4-19 and W4-31), behind CHAT_AGENTIC. The Library
-- ("701 · MIT") is a catalog in the repository (web lib/chat/skills/
-- marketplace.json); adding one of its skills takes the import path of 00458
-- (cleanup, scan, MIT, an Admin's approval), from the commit the catalog
-- pins. The GetCito skills in /skills (lib/chat/skills/library.ts) are
-- another thing and stay out of this table.
--
--   * chat_skills.source gains library: a skill added from the Library. Like
--     an import it carries its license, source URL and pinned commit, and
--     never updates by itself.
--   * chat_skills.library_ref: the catalog row it came from, once in the
--     workspace (the Library card's Added state). Only a Library skill has
--     one.
--   * chat_skills.update_checked_at: when the weekly check last looked at an
--     imported or Library skill's source (W4-31); update_sha (00458) says
--     what it found.

-- ─── Library as a source ────────────────────────────────────────────────────

alter table public.chat_skills
  drop constraint if exists chat_skills_source_check;
alter table public.chat_skills
  add constraint chat_skills_source_check
    check (source in ('user', 'import', 'library'));

-- 00458's unnamed rule that only an import has a source URL and a commit:
-- found by what it says, since PostgreSQL named it, and given a name.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.chat_skills'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%''import''::text%'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%source_url IS NULL%'
  loop
    execute format('alter table public.chat_skills drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.chat_skills
  drop constraint if exists chat_skills_source_pin_check;
alter table public.chat_skills
  add constraint chat_skills_source_pin_check
    check (source in ('import', 'library') or (source_url is null and commit_sha is null));

-- ─── The catalog row, and the update check ──────────────────────────────────

alter table public.chat_skills
  add column if not exists library_ref text check (
    char_length(library_ref) between 1 and 300 and library_ref ~ '^[A-Za-z0-9._/-]+$'
  ),
  add column if not exists update_checked_at timestamptz;

-- A Library skill names its catalog row and its pinned commit; nothing else
-- names a row.
alter table public.chat_skills
  drop constraint if exists chat_skills_library_check;
alter table public.chat_skills
  add constraint chat_skills_library_check
    check (
      ((source = 'library') = (library_ref is not null))
      and (source <> 'library' or commit_sha is not null)
    );

-- Added once per workspace.
create unique index if not exists chat_skills_library_ref_uidx
  on public.chat_skills (organization_id, library_ref)
  where library_ref is not null;

-- The weekly check's queue: the pinned skills it looked at longest ago.
create index if not exists chat_skills_update_checked_idx
  on public.chat_skills (update_checked_at nulls first)
  where commit_sha is not null;

comment on column public.chat_skills.source is
  'user (made in Chat), import (an upload or a pinned GitHub commit, 00458) or library (added from the Library catalog at the commit it pins, 00465).';
comment on column public.chat_skills.library_ref is
  'The Library catalog row a library skill came from (00465; marketplace.json''s id), once per workspace. Null for other skills.';
comment on column public.chat_skills.update_checked_at is
  'When the weekly update check last read the skill''s source (00465; W4-31). Null until it has.';

notify pgrst, 'reload schema';
