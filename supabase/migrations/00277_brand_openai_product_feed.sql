-- ============================================================================
-- 00277: a brand's word that it sends OpenAI a direct product feed (#1281)
-- ============================================================================
-- In the US, ChatGPT Shopping picks products from OpenAI's own product
-- index. There's no public API to check whether a catalog is in it, so the
-- Shopping page shows what we can know: the brand's own word that it sends a
-- direct feed (this column), else whether its own products appear in tracked
-- US ChatGPT Shopping answers. Off by default. Admins and managers change it,
-- as the rest of a brand (brands: admin/manager update).

alter table public.brands
  add column if not exists openai_product_feed boolean not null default false;

comment on column public.brands.openai_product_feed is
  'Shopping (#1281): the brand says it sends OpenAI a direct product feed, so its catalog is in OpenAI''s product index (ChatGPT Shopping, US). Off by default.';
