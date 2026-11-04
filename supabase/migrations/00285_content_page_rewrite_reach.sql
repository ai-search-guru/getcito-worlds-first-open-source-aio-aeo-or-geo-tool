-- ============================================================================
-- 00285: what a page rewrite was asked for and came to (Length's reach)
-- ============================================================================
-- In the live editor test of 2026-10-25, a page kept 78% of its Length in
-- passages AI answers quote and tables, and the editor kept recommending
-- Rewrite page: three rewrites came to 5,468, 6,843 and 7,335 characters for
-- a Length of 4,000. A rewrite that missed isn't offered again for the same
-- Length, so a page rewrite (kind 'page', 00247) now says:
--
--   * `length_target`: the Length it was written to; null with Length off
--     (the page kept its own length, which says nothing about a Length).
--   * `kept_chars`: the characters it kept word for word (quoted passages,
--     tables…): a passage unlocked since lets a rewrite go shorter.
--   * `after_chars`: the characters it came to, counted once here, so the
--     editor reads a number, not the rewritten page.
--
-- All three are written by the API (contentWriter.js) and are null on other
-- suggestions and on page rewrites made before this. Adding nullable columns
-- with no default rewrites nothing.

alter table public.content_draft_suggestions
  add column if not exists length_target integer
    check (length_target is null or length_target > 0),
  add column if not exists kept_chars integer
    check (kept_chars is null or kept_chars >= 0),
  add column if not exists after_chars integer
    check (after_chars is null or after_chars >= 0);

comment on column public.content_draft_suggestions.length_target is
  'A page rewrite''s Length target (00285); null with Length off and on other suggestions.';
comment on column public.content_draft_suggestions.kept_chars is
  'The characters a page rewrite kept word for word (00285).';
comment on column public.content_draft_suggestions.after_chars is
  'The characters a page rewrite came to (00285).';
