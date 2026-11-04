-- ============================================================================
-- 00248: the sources an agent's suggestion was written from
-- ============================================================================
-- Content Editor v1.1, CE-033: the Content Agent writes from the sources the
-- Sources tab keeps (prompts, fan-outs, cited pages, Search Console queries),
-- numbered, and says which ones each suggestion used and the words each one
-- supports. The editor shows them as "Based on" chips under the suggestion
-- and ¹ ² marks on its words; a chip opens its source in Sources. A number
-- the agent adds with no source is not kept (contentSources.js).
--
-- sources: [{ "kind", "ref", "label" }], kind one of prompt, fanout,
-- cited_page, gsc_query; ref as the Sources tab keys its row (a prompt's id,
-- a normalized query, a page's address).
--
-- source_marks: [{ "start", "end", "source" }], offsets into the words a
-- replace puts in (after_text) or an insert's HTML read as text; source is an
-- index into sources. A page rewritten whole names its sources, with no marks.
alter table public.content_draft_suggestions
  add column if not exists sources jsonb
    check (
      sources is null
      or (
        jsonb_typeof(sources) = 'array'
        and jsonb_array_length(sources) between 1 and 8
      )
    ),
  add column if not exists source_marks jsonb
    check (
      source_marks is null
      or (
        kind in ('replace', 'insert')
        and sources is not null
        and jsonb_typeof(source_marks) = 'array'
        and jsonb_array_length(source_marks) between 1 and 12
      )
    );

comment on column public.content_draft_suggestions.sources is
  'The sources an agent suggestion was written from: [{ "kind", "ref", "label" }] (00248).';
comment on column public.content_draft_suggestions.source_marks is
  'The words each source supports: [{ "start", "end", "source" }], offsets into after_text (a replace) or an insert''s text, source an index into sources (00248).';
