-- ============================================================================
-- 00362: the catalog as a prompt-suggestion source (product visibility, part 14)
-- ============================================================================
-- Shopping questions drawn from the brand's catalog categories and their price
-- bands (ECOM-003) carry source 'catalog', with the category behind them in
-- source_data. Without it in the check the suggestion insert fails outright,
-- so this lands with the generator that writes those rows.

alter table public.prompt_suggestions drop constraint prompt_suggestions_source_check;
alter table public.prompt_suggestions add constraint prompt_suggestions_source_check
  check (source = any (array['llm', 'heuristic', 'gsc', 'ga', 'catalog']));
