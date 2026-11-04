-- ============================================================================
-- 00456: Mobile app as a brand's site type
-- ============================================================================
-- A brand's site type (00205) was b2b, ecommerce or b2c. A brand whose
-- business is a mobile app now picks 'app' (Agent Center's business type of
-- the same key): its Content Editor page types, opportunities and task
-- wording follow it. The two tables keyed by the brand's site type take it
-- too: My rules saved for an app brand (content_rule_sets, 00227) and its
-- pages' quality reads (content_quality_pages, 00270). Same checks, with
-- 'app' added. Constraint swaps on small tables: existing rows already pass.

alter table public.brands
  drop constraint if exists brands_site_type_check;

alter table public.brands
  add constraint brands_site_type_check
    check (site_type in ('b2b', 'ecommerce', 'b2c', 'app'));

comment on column public.brands.site_type is
  'Content Editor (CE-023): b2b, ecommerce, b2c or app (a mobile app, 00456); sets the page types the editor offers. Null = guessed from industry and shopping_mode_enabled.';

alter table public.content_rule_sets
  drop constraint if exists content_rule_sets_site_type_check;

alter table public.content_rule_sets
  add constraint content_rule_sets_site_type_check
    check (site_type in ('b2b', 'ecommerce', 'b2c', 'app'));

comment on column public.content_rule_sets.site_type is
  'Content Editor (CE-009): the kind of site the set is for (b2b, ecommerce, b2c or app, as brands.site_type); a brand''s drafts start from its own kind''s set.';

alter table public.content_quality_pages
  drop constraint if exists content_quality_pages_site_type_check;

alter table public.content_quality_pages
  add constraint content_quality_pages_site_type_check
    check (site_type in ('b2b', 'ecommerce', 'b2c', 'app'));
