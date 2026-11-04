-- What a content opportunity asks for, given the brand's existing pages
-- (#857, Phase 2): write a new page, or work on one the site already has.
--
-- Decided at generation from the site page inventory (00104). The pages it
-- refers to are kept in source_data.targetPages. Opportunities from before
-- this keep decision null.

alter table public.content_opportunities
  add column decision text
    check (decision in ('create', 'optimize', 'expand', 'refresh', 'consolidate', 'defend'));
