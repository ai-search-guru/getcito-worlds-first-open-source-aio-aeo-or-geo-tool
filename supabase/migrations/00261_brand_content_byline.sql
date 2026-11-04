-- ============================================================================
-- 00261: Add byline to content, per brand (Content Editor Quality, CE-057)
-- ============================================================================
-- The author is page metadata: a CMS's own author field shows the byline,
-- and nothing of it goes into the content (Quality spec §9). For a CMS with
-- no author support (rare), a brand can opt in: its exports then put one
-- byline line under the H1. Off by default. Admins and managers change it,
-- as the rest of a brand (brands: admin/manager update).

alter table public.brands
  add column if not exists content_byline boolean not null default false;

comment on column public.brands.content_byline is
  'Content Editor Quality (CE-057): add one byline line under the H1 in exports, for a CMS with no author field. Off by default.';
