-- ============================================================================
-- 00433: whether a brand's tracking snippet is on its site (AI Traffic)
-- ============================================================================
-- AI Traffic said "Not detected" for a snippet that hadn't sent an AI visit
-- in the last week, so a site with the snippet and no AI visitors read the
-- same as one without it, and MCP and Chat answered 0 visits either way.
-- The snippet sends nothing for other visitors, and won't: no request is
-- added to customers' pages. Instead the server reads the brand's home page
-- when a person asks (Check again) and when the brand is set up, and looks
-- for the snippet (backend/src/lib/trackingSnippetCheck.js).
--
--   * brands.snippet_checked_at: when the home page was last read for it.
--   * brands.snippet_found_at: when that read found it; null when it didn't
--     (or none has run). A read that fails changes neither.
--
-- A brand with any AI visit stored has the snippet too, checked or not.

alter table public.brands
  add column if not exists snippet_checked_at timestamptz,
  add column if not exists snippet_found_at timestamptz;

comment on column public.brands.snippet_checked_at is
  'AI Traffic: when the server last read the brand''s home page for its tracking snippet (Check again, brand setup).';
comment on column public.brands.snippet_found_at is
  'AI Traffic: when that read found the snippet (its t.js tag or the tracking code); null when it did not, or none has run.';

notify pgrst, 'reload schema';
