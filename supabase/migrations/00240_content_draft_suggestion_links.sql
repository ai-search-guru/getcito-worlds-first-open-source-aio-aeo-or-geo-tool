-- ============================================================================
-- 00240: the links on an agent's replace suggestion
-- ============================================================================
-- Content Agent rule gaps, A: the agent could never meet the Internal links,
-- Outbound links or Cite sources inline rules, because a replace's new words
-- were plain text (00217) and it had nowhere to link to. The server now gives
-- it the brand's own pages and the draft's sources, and keeps a link only to
-- one of those URLs.
--
-- A replace's after_text stays plain text: the editor finds an accepted one
-- again by its words. Its links sit beside it, each the words from start to
-- end (offsets into after_text) linked to href, and the editor puts them on
-- as link marks when the suggestion is accepted. An insert keeps its links in
-- its HTML, as its other blocks.
alter table public.content_draft_suggestions
  add column if not exists after_links jsonb
    check (
      after_links is null
      or (
        kind = 'replace'
        and jsonb_typeof(after_links) = 'array'
        and jsonb_array_length(after_links) between 1 and 20
      )
    );

comment on column public.content_draft_suggestions.after_links is
  'A replace''s links: [{ "start", "end", "href" }], offsets into after_text (00240).';
