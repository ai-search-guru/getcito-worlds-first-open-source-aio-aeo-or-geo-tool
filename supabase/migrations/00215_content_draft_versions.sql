-- ============================================================================
-- 00215: a draft's version history, for the editor's History menu
-- ============================================================================
-- History (Content Editor spec v2 §8, CE-018) lists a draft's earlier
-- versions with their time and origin, and restores any of them:
--   * import: the live page, as Start imported it from its address;
--   * agent_before: the page before an agent's suggestions were accepted
--     (CE-018 part C writes it);
--   * ready: each Mark ready;
--   * publish: each publish (CE-013 writes it);
--   * restore: the page a restore replaced, so a restore loses nothing.
-- "Now" is the draft itself. Versions are kept 90 days: the server's daily
-- run prunes older ones (content_draft_versions_prune), and reads leave them
-- out until then. A draft keeps its newest 50 (History lists 50), and a
-- version that would repeat the draft's latest one (a restore after a
-- restore, Mark ready on an unchanged page) isn't kept again. Members write
-- import, agent_before and ready versions; publish is the server's.
--
-- A version is a copy of the draft's own title and body, which every save
-- checks against the draft allow-list. So members only read versions; the two
-- functions below write them from the draft row, and a hand-made version
-- with unchecked HTML can't be restored into a draft.
create table if not exists public.content_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  origin text not null
    check (origin in ('import', 'agent_before', 'ready', 'publish', 'restore')),
  title text not null default '',
  body_html text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_draft_versions_draft_idx
  on public.content_draft_versions (draft_id, created_at desc);
-- The daily prune walks the oldest first.
create index if not exists content_draft_versions_created_idx
  on public.content_draft_versions (created_at);

alter table public.content_draft_versions enable row level security;

-- A draft the member can read is one in their organization (content_drafts'
-- own member policies), so its versions follow it.
create policy "content_draft_versions: member select"
  on public.content_draft_versions
  for select
  using (draft_id in (select d.id from public.content_drafts d));

grant select on public.content_draft_versions to authenticated;

comment on table public.content_draft_versions is
  'Content Editor (CE-018): a draft''s earlier versions — the imported live page, each Mark ready and publish, the page before agent changes or a restore. Written by content_draft_snapshot / content_draft_restore; kept 90 days.';

-- Whether the caller may change the draft: a member of the organization that
-- owns its brand, or the server.
create or replace function public.content_draft_member(p_draft_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.role() = 'service_role' or exists (
    select 1
    from public.content_drafts d
    join public.brands b on b.id = d.brand_id
    join public.profiles pf on pf.organization_id = b.organization_id
    where d.id = p_draft_id and pf.id = auth.uid()
  );
$$;

revoke all on function public.content_draft_member(uuid) from public, anon;
grant execute on function public.content_draft_member(uuid) to authenticated, service_role;

-- Keeps the draft as it is now as a version of the given origin, unless its
-- latest version is already this page (that one's id comes back), and keeps
-- only the draft's newest 50. Called by the two functions below, not by
-- members.
create or replace function public.content_draft_keep_version(p_draft_id uuid, p_origin text)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_latest public.content_draft_versions%rowtype;
  v_id uuid;
begin
  select * into v_latest
  from public.content_draft_versions v
  where v.draft_id = p_draft_id
  order by v.created_at desc, v.id desc
  limit 1;
  if v_latest.id is not null and exists (
    select 1 from public.content_drafts d
    where d.id = p_draft_id and d.title = v_latest.title and d.body_html = v_latest.body_html
  ) then
    return v_latest.id;
  end if;

  insert into public.content_draft_versions (draft_id, origin, title, body_html, created_by)
  select d.id, p_origin, d.title, d.body_html, auth.uid()
  from public.content_drafts d
  where d.id = p_draft_id
  returning id into v_id;

  delete from public.content_draft_versions v
  where v.draft_id = p_draft_id
    and v.id not in (
      select o.id from public.content_draft_versions o
      where o.draft_id = p_draft_id
      order by o.created_at desc, o.id desc
      limit 50
    );
  return v_id;
end;
$$;

revoke all on function public.content_draft_keep_version(uuid, text)
  from public, anon, authenticated;

-- Keeps the draft as it is now as a version of the given origin. Returns the
-- version's id, or null when the caller can't change the draft, or (a
-- publish) isn't the server.
create or replace function public.content_draft_snapshot(p_draft_id uuid, p_origin text)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  -- A restore keeps its own version (content_draft_restore).
  if p_origin is null or p_origin not in ('import', 'agent_before', 'ready', 'publish') then
    raise exception 'content_draft_snapshot: unknown origin %', p_origin using errcode = '22023';
  end if;
  if not public.content_draft_member(p_draft_id)
     or (p_origin = 'publish' and auth.role() is distinct from 'service_role') then
    return null;
  end if;

  v_id := public.content_draft_keep_version(p_draft_id, p_origin);
  return v_id;
end;
$$;

revoke all on function public.content_draft_snapshot(uuid, text) from public, anon;
grant execute on function public.content_draft_snapshot(uuid, text) to authenticated, service_role;

-- Restores a version: the draft as it is now is kept first (origin restore),
-- then the draft takes the version's title and body; a draft that is already
-- that page is left as it is. Only versions past the draft's newest 50 are
-- ever deleted.
-- Returns the draft's title, body and updated_at after, or null when the
-- version is unknown, past its 90 days, or the caller can't change the draft.
create or replace function public.content_draft_restore(p_version_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_version public.content_draft_versions%rowtype;
  v_draft public.content_drafts%rowtype;
begin
  select * into v_version
  from public.content_draft_versions v
  where v.id = p_version_id and v.created_at >= now() - interval '90 days';
  if v_version.id is null or not public.content_draft_member(v_version.draft_id) then
    return null;
  end if;

  select * into v_draft from public.content_drafts d where d.id = v_version.draft_id;
  -- Already this page: nothing to keep or change.
  if v_draft.title is distinct from v_version.title
     or v_draft.body_html is distinct from v_version.body_html then
    perform public.content_draft_keep_version(v_version.draft_id, 'restore');

    update public.content_drafts d
    set title = v_version.title, body_html = v_version.body_html
    where d.id = v_version.draft_id
    returning * into v_draft;
  end if;

  return jsonb_build_object(
    'title', v_draft.title,
    'bodyHtml', v_draft.body_html,
    'updatedAt', v_draft.updated_at
  );
end;
$$;

revoke all on function public.content_draft_restore(uuid) from public, anon;
grant execute on function public.content_draft_restore(uuid) to authenticated, service_role;

-- Deletes at most p_limit versions older than p_before, oldest first; the
-- server's daily run calls it until fewer come back.
create or replace function public.content_draft_versions_prune(
  p_before timestamptz,
  p_limit integer
)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  delete from public.content_draft_versions v
  where v.id in (
    select o.id from public.content_draft_versions o
    where o.created_at < p_before
    order by o.created_at
    limit p_limit
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.content_draft_versions_prune(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.content_draft_versions_prune(timestamptz, integer)
  to service_role;
