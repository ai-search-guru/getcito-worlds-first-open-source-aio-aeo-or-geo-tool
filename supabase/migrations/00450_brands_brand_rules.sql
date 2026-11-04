-- ============================================================================
-- 00450: A brand's rules, in its own words
-- ============================================================================
-- Customer priorities item 8 (owner decision, 2026-11-01): one list of
-- rules per brand, such as "no topics comparing us with a named competitor"
-- or "cite official sources for health claims", set in Settings › Content
-- and read by the server where it writes for the brand:
--
--   * Site Audit's AI recommendations;
--   * new content opportunities;
--   * the Content Agent (writer, agent, rewrite), before the person's own
--     rules, which it outranks.
--
-- The rules shape what's suggested and written; scores don't change.
--
-- brand_rules: at most 30 rules of at most 300 characters each, as the app
-- saves them (trimmed, each once). Admins and managers change them, as the
-- brand's other settings (brands: admin/manager update).

alter table public.brands
  add column if not exists brand_rules text[] not null default '{}'
    check (
      cardinality(brand_rules) <= 30
      and char_length(array_to_string(brand_rules, '')) <= 9000
    );

comment on column public.brands.brand_rules is
  'Customer priorities item 8 (00450): the brand''s rules in its own words (at most 30, 300 characters each), read by Site Audit''s AI recommendations, the opportunity generator and the Content Agent.';

notify pgrst, 'reload schema';
