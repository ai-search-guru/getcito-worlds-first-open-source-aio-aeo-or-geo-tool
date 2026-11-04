-- ============================================================================
-- 00213: a draft's rules, for the editor's Rules tab (Content Editor, CE-009)
-- ============================================================================
-- The Rules tab (Content Editor spec v2 §10) lists the rules a page of its
-- type is written to — the type's own, then the shared groups (length and
-- structure, fan-outs and keywords, links and sources, style) — and reads
-- each one's status from the page as written. The rules themselves are the
-- app's (frontend/src/lib/content/rules.ts); a draft keeps only what the person
-- changed for it.
--
--   * content_drafts.rules: {set, overrides} — the page type whose set
--     applies (null follows the draft's type) and, per rule, whether it is
--     on and the value the draft uses ("Rule updated for this draft"). Null
--     until something changes. A member edits it like the body, so it isn't
--     a server column.

alter table public.content_drafts
  add column if not exists rules jsonb
    check (rules is null or (jsonb_typeof(rules) = 'object' and octet_length(rules::text) <= 32768));

comment on column public.content_drafts.rules is
  'The draft''s rule choices (CE-009): the page type whose rule set applies (null = the draft''s type) and per-rule overrides {on, value}. Null until changed.';
