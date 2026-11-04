-- ============================================================================
-- 00449: The sites a brand trusts as sources
-- ============================================================================
-- Customer priorities item 6 (owner decision, 2026-11-01): Site Audit's
-- "Outbound authority links" counts a shared list of official, research and
-- news sites. A brand adds the sites it trusts besides, such as its
-- industry's association or the docs it cites, in Settings › Content:
--
--   * Site Audit counts a link to one of them, or one of its pages, as an
--     authority link;
--   * the Content Editor's Trust reads it as a primary source.
--
-- trusted_sources: hosts as the app saves them (lower case, no scheme, no
-- www.), at most 50. Admins and managers change them, as the brand's other
-- settings (brands: admin/manager update).

alter table public.brands
  add column if not exists trusted_sources text[] not null default '{}'
    check (cardinality(trusted_sources) <= 50);

comment on column public.brands.trusted_sources is
  'Customer priorities item 6 (00449): sites the brand trusts as sources (hosts, at most 50); Site Audit counts links to them as authority links and the Content Editor''s Trust as primary sources.';

notify pgrst, 'reload schema';
