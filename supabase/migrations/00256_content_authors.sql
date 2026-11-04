-- ============================================================================
-- 00256: the workspace's authors (Content Editor Quality, CE-037)
-- ============================================================================
-- Settings › Authors (Quality spec §9): the real people a page is by. A
-- page's author is its metadata, never its content: the editor shows it as
-- a byline outside the page, GetCito sets the CMS author field on publish,
-- and Person schema names it. "Real people only. Content Agent can't add,
-- edit or invent authors": the server has no path that writes these.
--
--   * content_authors: one row per person, in an organization: name, title,
--     a short bio, profile links (sameAs), a photo. user_id is the member
--     the author is, when they are one: only that member links or unlinks
--     themself, and each member is one author at most.
--   * Anyone in the workspace adds authors; whoever added one, the author
--     themself or an admin edits and deletes it. Its organization, who
--     added it and when stay as they were.
--   * content_author_defaults: one default author per brand, which every
--     new page of the brand gets; admins and managers set it, as the
--     workspace's other settings. With none, a page is by the organization
--     ("{Brand} Team").

-- Profile links feed Person schema's sameAs and Site trust, and members
-- write the table from their own sessions, so the table holds the rule the
-- action checks: each link https, at most 300 characters.
create or replace function public.content_author_links_ok(links text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(l ~ '^https://\S+$' and char_length(l) <= 300), true)
  from unnest(links) as l
$$;

create table if not exists public.content_authors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  title text check (title is null or char_length(title) <= 120),
  bio text check (bio is null or char_length(bio) <= 400),
  photo_url text check (
    photo_url is null or (photo_url ~ '^https://' and char_length(photo_url) <= 2048)
  ),
  same_as text[] not null default '{}' check (
    cardinality(same_as) <= 10 and public.content_author_links_ok(same_as)
  ),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_authors_organization
  on public.content_authors (organization_id, name);

-- A member is one author of their organization at most.
create unique index if not exists content_authors_member
  on public.content_authors (organization_id, user_id)
  where user_id is not null;

create or replace trigger content_authors_updated_at
  before update on public.content_authors
  for each row execute function public.handle_updated_at();

-- What RLS can't say: an author's organization, who added it and when never
-- change, and user_id changes only as its member linking or unlinking
-- themself.
create or replace function public.guard_content_author_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A role that bypasses RLS is server-side (service role, migrations).
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'content author column can''t change'
      using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id
     and not (old.user_id is null and new.user_id = auth.uid())
     and not (old.user_id = auth.uid() and new.user_id is null)
  then
    raise exception 'only a member links or unlinks themself as an author'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace trigger content_authors_guard
  before update on public.content_authors
  for each row execute function public.guard_content_author_columns();

alter table public.content_authors enable row level security;

create policy "content_authors: member select"
  on public.content_authors
  for select
  using (organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid()));

-- Added by the member, as no one or as themself.
create policy "content_authors: member insert"
  on public.content_authors
  for insert
  with check (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and created_by = auth.uid()
    and (user_id is null or user_id = auth.uid())
  );

-- Whoever added it, the author themself, or an admin of the organization.
create policy "content_authors: owner or admin update"
  on public.content_authors
  for update
  using (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and (
      created_by = auth.uid()
      or user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  )
  with check (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
  );

create policy "content_authors: owner or admin delete"
  on public.content_authors
  for delete
  using (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and (
      created_by = auth.uid()
      or user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

-- Every policy needs auth.uid(); revoking anon keeps it so if one is loosened.
revoke all on table public.content_authors from anon;
grant select, insert, update, delete on public.content_authors to authenticated;

comment on table public.content_authors is
  'Content Editor Quality (CE-037): the workspace''s authors — real people a page is by (page metadata, never content). Anyone adds; whoever added it, the author themself or an admin edits. The server never writes them.';

create table if not exists public.content_author_defaults (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  author_id uuid not null references public.content_authors(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists content_author_defaults_author
  on public.content_author_defaults (author_id);

alter table public.content_author_defaults enable row level security;

create policy "content_author_defaults: member select"
  on public.content_author_defaults
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- Admins and managers of the brand's organization, with an author of it.
create policy "content_author_defaults: manager write"
  on public.content_author_defaults
  for all
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and author_id in (
      select a.id from public.content_authors a
      join public.brands b on b.organization_id = a.organization_id
      where b.id = content_author_defaults.brand_id
    )
    and updated_by = auth.uid()
  );

revoke all on table public.content_author_defaults from anon;
grant select, insert, update, delete on public.content_author_defaults to authenticated;

comment on table public.content_author_defaults is
  'Content Editor Quality (CE-037): the author every new page of a brand gets; none means the organization byline. Admins and managers set it.';
