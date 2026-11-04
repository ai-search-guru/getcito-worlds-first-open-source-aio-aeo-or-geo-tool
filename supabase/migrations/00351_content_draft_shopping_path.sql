-- ============================================================================
-- 00351: a draft's shopping path (shopping path, part 2)
-- ============================================================================
-- On an online shop, a buying guide, a best-of list or a comparison should
-- send its readers, and the AI answers that quote it, to the right category
-- page and to products that are in stock and that Google Merchant Center
-- accepts. The API picks them from the brand's catalog (00278, 00296, 00350)
-- for the draft's topic; the Brief tab shows them, the person swaps, removes,
-- locks or adds, and the Content Agent writes with them.
--
--   * content_drafts.shopping_path: the path as jsonb — {version, builtAt,
--     pageType, categories: [{name, url, title}], products: [{id, title,
--     url, price, salePrice, currency, availability, image, issues, score}],
--     leftOut: [{id, title, reason}], locked, removed, added}. Null until
--     built, and for a page or a brand it doesn't fit. A member changes it
--     like the brief, so it isn't a server column.

alter table public.content_drafts
  add column if not exists shopping_path jsonb
    check (
      shopping_path is null
      or (jsonb_typeof(shopping_path) = 'object' and octet_length(shopping_path::text) <= 65536)
    );

comment on column public.content_drafts.shopping_path is
  'The draft''s shopping path (shopping path, part 2): the category pages and catalog products the page links, the products left out and why, and the person''s locks, removals and additions. Null until built.';

notify pgrst, 'reload schema';
