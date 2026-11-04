-- ============================================================================
-- 00281: Quality phase 3, CE-053 — a brand's live variants, by its brand
-- ============================================================================
-- The Content Editor finds a product page's product in the brand's catalog
-- (00278) by the page's URL: the product's own (catalog_products_brand_live_idx
-- serves that read), else a variant's, when a feed gives a variant its own
-- page. This index serves the variants' read the same way, so it reads the
-- brand's live variants only, not every brand's.

create index if not exists catalog_variants_brand_live_idx
  on public.catalog_variants (brand_id)
  where removed_at is null;
