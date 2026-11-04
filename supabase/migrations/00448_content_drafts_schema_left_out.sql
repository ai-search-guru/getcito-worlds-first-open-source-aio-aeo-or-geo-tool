-- ============================================================================
-- 00448: The page's Article schema, left out by the person
-- ============================================================================
-- Customer priorities item 7 (owner decision A, 2026-11-01): an article
-- page goes to the CMS and to exports with its Article JSON-LD, the author
-- in it (the draft's author as a Person, else the brand as the
-- Organization). GetCito adds it by itself; the page's text doesn't
-- change. A CMS that writes its own Article schema would give the page two,
-- so the person can leave GetCito's out, draft by draft, in Before you
-- publish, and add it back there.
--
--   * schema_left_out: true while the person left it out; the default adds it.

alter table public.content_drafts
  add column if not exists schema_left_out boolean not null default false;

comment on column public.content_drafts.schema_left_out is
  'Customer priorities item 7 (00448): true when the person left out the Article JSON-LD GetCito adds to the page it sends to a CMS and exports; false adds it.';

notify pgrst, 'reload schema';
