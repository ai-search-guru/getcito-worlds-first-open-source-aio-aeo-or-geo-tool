-- ============================================================================
-- 00275: Quality phase 2, CE-051 — hand it off to the Content Agent
-- ============================================================================
-- Hand off has the Content Agent fix every fixable Quality suggestion in one
-- run, as suggestions the person reviews: a run of its own kind. A brand may
-- hand off its new and optimized pages on their own (Settings › Content,
-- off by default); each such draft gets its automatic run once.
--
--   * content_agent_runs.kind gains 'handoff'; origin says who started a
--     run: a person, or the editor on its own ('auto'), one a draft;
--   * brands.content_quality_handoff: the brand's setting;
--   * content_drafts.quality_handoff: the setting as it was when the draft
--     was made (a trigger copies it; a member can't change it), so turning
--     it on reaches new drafts only.

alter table public.content_agent_runs drop constraint if exists content_agent_runs_kind_check;
alter table public.content_agent_runs
  add constraint content_agent_runs_kind_check
  check (kind in ('fix', 'rewrite', 'write', 'brief', 'handoff'));

alter table public.content_agent_runs
  add column if not exists origin text not null default 'person'
  check (origin in ('person', 'auto'));

-- An automatic hand-off is once a draft: its row is the claim.
create unique index if not exists content_agent_runs_auto_handoff
  on public.content_agent_runs (draft_id)
  where kind = 'handoff' and origin = 'auto';

comment on column public.content_agent_runs.origin is
  'Content Agent run (00275): who started it — a person, or the editor on its own (auto: Quality''s hand-off, once a draft).';

alter table public.brands
  add column if not exists content_quality_handoff boolean not null default false;

comment on column public.brands.content_quality_handoff is
  'Quality CE-051 (00275): hand off quality fixes automatically — new and optimized pages get the Content Agent''s hand-off run, its changes left for review. Off by default.';

alter table public.content_drafts
  add column if not exists quality_handoff boolean not null default false;

comment on column public.content_drafts.quality_handoff is
  'Quality CE-051 (00275): the brand''s hand-off setting when the draft was made (a trigger copies it); its automatic hand-off runs once.';

-- As the member who makes the draft (RLS reads their brand); the server
-- bypasses RLS. A change by a member is undone: only the server sets it.
create or replace function public.content_draft_quality_handoff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select b.content_quality_handoff into new.quality_handoff
    from public.brands b
    where b.id = new.brand_id;
    new.quality_handoff := coalesce(new.quality_handoff, false);
  elsif new.quality_handoff is distinct from old.quality_handoff
    and not (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user)
  then
    new.quality_handoff := old.quality_handoff;
  end if;
  return new;
end;
$$;

drop trigger if exists content_drafts_quality_handoff on public.content_drafts;
create trigger content_drafts_quality_handoff
  before insert or update of quality_handoff on public.content_drafts
  for each row execute function public.content_draft_quality_handoff();

notify pgrst, 'reload schema';
