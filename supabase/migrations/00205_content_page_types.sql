-- ============================================================================
-- 00205: the brand's site type, and where a draft's page type comes from
--        (Content Editor, CE-023)
-- ============================================================================
-- Page types depend on the kind of site (Content Editor spec v2 §4): a B2B
-- SaaS site writes feature, comparison and pricing pages, a shop product and
-- category pages, a B2C site destination and help pages.
--
--   * brands.site_type: b2b, ecommerce or b2c, set in the brand's settings.
--     Null until someone chooses; until then the app guesses it from the
--     industry and Shopping mode. Updated under the brands policies, as the
--     industry is (admins and managers).
--   * content_drafts.page_type_source: 'detected' while the app keeps
--     page_type in step with the page (its URL, schema and title), 'user'
--     once a person picks the type. A picked type is never detected over.
--     New drafts start detected.

alter table public.brands
  add column if not exists site_type text
    check (site_type in ('b2b', 'ecommerce', 'b2c'));

comment on column public.brands.site_type is
  'Content Editor (CE-023): b2b, ecommerce or b2c; sets the page types the editor offers. Null = guessed from industry and shopping_mode_enabled.';

alter table public.content_drafts
  add column if not exists page_type_source text not null default 'detected'
    check (page_type_source in ('detected', 'user'));

comment on column public.content_drafts.page_type_source is
  'Content Editor (CE-023): detected = page_type follows the page as it changes; user = a person picked it.';
