-- ============================================================================
-- 00271: Quality — the page's author confirmed by the person (E-E-A-T)
-- ============================================================================
-- E-E-A-T counts who stands behind a page: a real, named author (the
-- byline) with a profile (a bio and links). Many sites already show their
-- author through the CMS, so picking one of GetCito's authors isn't the
-- only way: the person can confirm, page by page,
--
--   * author_real:    the page's author is a real person, named on our site;
--   * author_profile: their profile there has a bio and links.
--
-- Each is the person's own statement, kept with who made it and when; a
-- trigger stamps both from the session, so no one confirms in another's
-- name, and unticking clears them.

alter table public.content_drafts
  add column if not exists author_real_at timestamptz,
  add column if not exists author_real_by uuid references public.profiles(id) on delete set null,
  add column if not exists author_profile_at timestamptz,
  add column if not exists author_profile_by uuid references public.profiles(id) on delete set null;

comment on column public.content_drafts.author_real_at is
  'Quality (00271): when a member confirmed the page''s author is a real person named on the site (E-E-A-T byline); null when not confirmed.';
comment on column public.content_drafts.author_profile_at is
  'Quality (00271): when a member confirmed the author''s profile on the site has a bio and links (E-E-A-T profile); null when not confirmed.';

-- Who and when come from the session, not the request: a confirmation is
-- stamped now, by the member making it; a change to who alone is undone,
-- clearing it too. Only a role that bypasses RLS changes who alone: the
-- profiles FK's on delete set null, run as the table's owner. On insert
-- OLD is null: a draft starts with only what the session stamps.
create or replace function public.content_drafts_author_confirmed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_real_at is distinct from old.author_real_at then
    if new.author_real_at is null then
      -- Unticked: the profile's word goes with the author's.
      new.author_real_by := null;
      new.author_profile_at := null;
      new.author_profile_by := null;
      return new;
    end if;
    new.author_real_at := now();
    new.author_real_by := auth.uid();
  elsif new.author_real_by is distinct from old.author_real_by
    and (tg_op = 'INSERT'
         or not (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user)) then
    new.author_real_by := old.author_real_by;
  end if;
  if new.author_profile_at is distinct from old.author_profile_at then
    if new.author_profile_at is null then
      new.author_profile_by := null;
    else
      new.author_profile_at := now();
      new.author_profile_by := auth.uid();
    end if;
  elsif new.author_profile_by is distinct from old.author_profile_by
    and (tg_op = 'INSERT'
         or not (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user)) then
    new.author_profile_by := old.author_profile_by;
  end if;
  return new;
end;
$$;

drop trigger if exists content_drafts_author_confirmed on public.content_drafts;
create trigger content_drafts_author_confirmed
  before insert or update on public.content_drafts
  for each row execute function public.content_drafts_author_confirmed();

notify pgrst, 'reload schema';
