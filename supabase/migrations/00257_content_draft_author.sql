-- ============================================================================
-- 00257: a page's author (Content Editor Quality, CE-038)
-- ============================================================================
-- content_drafts.author_id: the real person the page is by (content_authors,
-- 00256). It is page metadata: the editor shows it in its Page info strip,
-- outside the page, and GetCito sends it to the CMS author field; it is
-- never in the page's text. (The draft's `author` column, 'user' or 'agent',
-- says who wrote the text: another thing.)
--
--   * A new draft gets its brand's default author (content_author_defaults),
--     the server's drafts too; none means the organization byline
--     ("{Brand} Team").
--   * The author must be one of the brand's organization's.

alter table public.content_drafts
  add column if not exists author_id uuid
    references public.content_authors(id) on delete set null;

create index if not exists content_drafts_author
  on public.content_drafts (author_id)
  where author_id is not null;

comment on column public.content_drafts.author_id is
  'Content Editor Quality (CE-038): the person the page is by (content_authors), page metadata — never the page''s text. A new draft gets its brand''s default; null is the organization byline.';

-- As the member who writes (RLS reads their organization's defaults and
-- authors); the server bypasses RLS and reads them all.
create or replace function public.content_draft_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.author_id is null then
    select d.author_id into new.author_id
    from public.content_author_defaults d
    where d.brand_id = new.brand_id;
  end if;
  if new.author_id is not null
     and (tg_op = 'INSERT' or new.author_id is distinct from old.author_id)
     and not exists (
       select 1
       from public.content_authors a
       join public.brands b on b.organization_id = a.organization_id
       where a.id = new.author_id and b.id = new.brand_id
     )
  then
    raise exception 'content draft author is not one of the brand''s organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_drafts_author on public.content_drafts;
create trigger content_drafts_author
  before insert or update of author_id on public.content_drafts
  for each row execute function public.content_draft_author();
