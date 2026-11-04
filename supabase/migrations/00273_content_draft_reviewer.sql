-- ============================================================================
-- 00273: Quality CE-049 — a qualified reviewer for regulated pages
-- ============================================================================
-- A consumer page that advises on health, finance or law (the page read's
-- `regulated`, 00270) asks for a qualified reviewer: "Reviewed by {name,
-- credential}", from Authors only (Quality spec §4b). Like the author
-- (00257), it is page metadata: the editor shows it outside the page,
-- never in the page's text.
--
--   * content_drafts.reviewer_id: one of the brand's organization's authors,
--     else null.

alter table public.content_drafts
  add column if not exists reviewer_id uuid
    references public.content_authors(id) on delete set null;

create index if not exists content_drafts_reviewer
  on public.content_drafts (reviewer_id)
  where reviewer_id is not null;

comment on column public.content_drafts.reviewer_id is
  'Quality CE-049 (00273): the qualified person who reviewed a regulated page (content_authors), page metadata — never the page''s text; null when none.';

create or replace function public.content_draft_reviewer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reviewer_id is not null
     and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id)
     and not exists (
       select 1
       from public.content_authors a
       join public.brands b on b.organization_id = a.organization_id
       where a.id = new.reviewer_id and b.id = new.brand_id
     )
  then
    raise exception 'content draft reviewer is not one of the brand''s organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_drafts_reviewer on public.content_drafts;
create trigger content_drafts_reviewer
  before insert or update of reviewer_id on public.content_drafts
  for each row execute function public.content_draft_reviewer();

notify pgrst, 'reload schema';
