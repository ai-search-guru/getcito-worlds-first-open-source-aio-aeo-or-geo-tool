-- ============================================================================
-- 00212: a draft's brief, for the editor's Brief tab (Content Editor, CE-007)
-- ============================================================================
-- The Brief tab (Content Editor spec v2 §10) shows what the page should do:
-- the page type and target address, then its goal, audience and length, and
-- an outline whose H2s each answer one of the searches AI engines ran
-- (a fan-out) on a platform. Rebuild outline writes it from the draft's
-- sources (the Sources tab, 00211); Edit brief changes it by hand.
--
--   * content_drafts.brief: the brief as jsonb — {goal, audience, outline:
--     [{heading, keyPoints, fanout, platform}], keywords, origin, builtAt,
--     builtFrom}. Null until one is built; the tab then offers the brief of
--     the opportunity the draft started from, if it has one. A member edits
--     it like the body, so it isn't a server column.
--   * prompt_improve_usage.content_draft_id: a rebuild is metered from the
--     organization's AI usage, the monthly budget the Improve tab and the
--     Action Center's task writer draw from (00120, 00150), not the content
--     brief quota, which stays with Opportunities' Generate Brief (spec §3).
--     The row names the draft it wrote the brief for.

alter table public.content_drafts
  add column if not exists brief jsonb
    check (brief is null or (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 65536));

comment on column public.content_drafts.brief is
  'The draft''s brief (CE-007): goal, audience, outline (each H2 with the fan-out and platform it answers), keywords, and how it was made (origin, builtAt, builtFrom). Null until built.';

alter table public.prompt_improve_usage
  add column if not exists content_draft_id uuid references public.content_drafts(id) on delete set null;

comment on column public.prompt_improve_usage.content_draft_id is
  'The Content Editor draft whose brief this generation rebuilt (CE-007). Null for an Improve tab or task-writer generation.';
