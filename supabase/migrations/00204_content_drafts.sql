-- ============================================================================
-- 00204: content drafts, the Content Library's rows (Content Editor, CE-002)
-- ============================================================================
-- The Content area writes and improves pages in GetCito (Content Editor spec
-- v2). Every page someone, or an agent, writes or changes there is a draft:
-- the Library lists them, the editor opens one.
--
--   * method: create (a new page) or optimize (an existing page).
--   * status: draft → in_review (an agent's draft waiting for a person) →
--     ready (Mark ready) → published (the person gives the live URL).
--     GetCito never publishes on its own.
--   * page_type: a key from the web's page type list (feature_page,
--     product_page, destination_page…). Not an enum: a new page type must not
--     take a migration.
--   * author: who wrote it, a person or the Content Agent. created_by is the
--     person who started it (null for an agent's draft).
--   * score_before / score_after: the page's AEO score before and after the
--     changes, once scoring runs (null until then).
--
-- Any member of the brand's organization reads and writes drafts, as with
-- reports and site audits: writing content is the team's daily work, not a
-- setting. No delete policy: nothing in the app deletes a draft yet.

create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 300),
  page_type text check (page_type ~ '^[a-z_]{1,40}$'),
  method text not null default 'create' check (method in ('create', 'optimize')),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'ready', 'published')),
  body_html text not null default '',
  author text not null default 'user' check (author in ('user', 'agent')),
  created_by uuid references public.profiles(id) on delete set null,
  score_before smallint check (score_before between 0 and 100),
  score_after smallint check (score_after between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.content_drafts is
  'Content Editor (CE-002): pages written or changed in GetCito by a person or the Content Agent. The Content Library lists them.';

create index if not exists content_drafts_brand_updated_idx
  on public.content_drafts (brand_id, updated_at desc);

create or replace trigger content_drafts_updated_at
  before update on public.content_drafts
  for each row execute function public.handle_updated_at();

-- Who wrote a draft, its brand and its scores are the server's to set (the
-- Content Agent, scoring), as with guard_organization_server_columns (00062):
-- a member can't pass their draft off as the agent's, or score it.
create or replace function public.guard_content_draft_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A role that bypasses RLS is server-side (service role, migrations).
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.score_before is not null or new.score_after is not null then
      raise exception 'content draft scores are set server-side'
        using errcode = '42501';
    end if;
  elsif new.brand_id is distinct from old.brand_id
     or new.author is distinct from old.author
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.score_before is distinct from old.score_before
     or new.score_after is distinct from old.score_after
  then
    raise exception 'content draft column is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace trigger content_drafts_guard_server_columns
  before insert or update on public.content_drafts
  for each row execute function public.guard_content_draft_server_columns();

alter table public.content_drafts enable row level security;

create policy "content_drafts: member select"
  on public.content_drafts
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- A person's own draft: the app writes created_by = the signed-in user, and
-- an agent's draft comes through the service role, which RLS doesn't apply to.
create policy "content_drafts: member insert"
  on public.content_drafts
  for insert
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
    and author = 'user'
    and created_by = auth.uid()
  );

-- The row being changed and the row it becomes both stay in the member's
-- organization, so an update can't move a draft to another brand's.
create policy "content_drafts: member update"
  on public.content_drafts
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  )
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );
