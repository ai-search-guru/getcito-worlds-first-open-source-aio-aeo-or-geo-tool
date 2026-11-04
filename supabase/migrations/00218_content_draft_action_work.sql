-- ============================================================================
-- 00218: one draft per action's work (Content Editor, CE-022)
-- ============================================================================
-- An Action Center action's writing task opens the Content Editor with a
-- draft linked to the action (content_drafts.action_id, 00208): "Create
-- content" for a new page, "Optimize page" for one of the pages the action
-- names. Opening it again opens the same draft. An action can hold both kinds
-- of work and name several pages, so the draft is one per action, method and
-- page; this index makes a second start (two clicks, two tabs) find the first
-- rather than write a second draft.
--
-- Start › Team (00208) links one draft to the action it creates, so the
-- drafts linked so far already meet it.
--
-- The page is indexed by its md5: an address may run to 2,048 characters,
-- and a non-ASCII one near that would pass btree's ~2.7 KB row limit and
-- fail the insert.

create unique index if not exists content_drafts_action_work_key
  on public.content_drafts (action_id, method, md5(coalesce(source_url, '')))
  where action_id is not null;

comment on index public.content_drafts_action_work_key is
  'Content Editor (CE-022): one draft per action, method and page.';
