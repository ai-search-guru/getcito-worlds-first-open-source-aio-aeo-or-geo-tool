-- ============================================================================
-- 00274: Quality phase 2, CE-050 — the page read's checks
-- ============================================================================
-- The page read (00270) also says, in the page's own words:
--
--   * answerFirst: whether the paragraph right after the H1 answers it;
--   * recommends: where the page puts the brand forward among options;
--   * disclosure: where it says the brand makes what it recommends;
--   * balance: a real limit of the brand's own product, or where another
--     option wins;
--   * how: how the page's content was made (who, how, why);
--   * cut: whether the model read less than the whole page (a check not
--     found may be in the rest).
--
-- Each found one names its paragraph by its hash, as the read's items do;
-- null when the page wasn't read for them (a read before this, a missed one).

alter table public.content_quality_pages
  add column if not exists checks jsonb
    check (
      checks is null
      or (jsonb_typeof(checks) = 'object' and octet_length(checks::text) <= 4096)
    );

comment on column public.content_quality_pages.checks is
  'Quality CE-050 (00274): { answerFirst: { block_hash, answers } | null, recommends | disclosure | balance | how: { quote, block_hash } | null, cut: boolean }; null when the page wasn''t read for them.';

notify pgrst, 'reload schema';
