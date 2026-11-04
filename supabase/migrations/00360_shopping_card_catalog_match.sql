-- ============================================================================
-- 00360: the catalog product behind an AI shopping card (product visibility, part 2)
-- ============================================================================
-- Product Visibility's Shelf, Products and Categories (ECOM-005…008) count a
-- brand's products on the AI "shelf": which catalog product (00278) each
-- product card in an AI answer (prompt_result_shopping_cards) shows. A card
-- the brand's own (matched_brand_role 'own') is matched to the brand's
-- catalog when it's written, and again after the catalog changes:
--
--   * by the marketplace listing it links (an ASIN, an eBay item id) to a
--     variant's marketplace_item_id;
--   * by a GTIN the card carries, to a variant's;
--   * by its link, to a product's or a variant's page;
--   * else by its title, close enough to one product's and to no other.
--
--   * catalog_product_id: the product, null for none (a rival's card, or a
--     product the catalog doesn't have); catalog_match: how it was found,
--     read only with a product. A product deleted from the catalog leaves
--     its cards' catalog_match behind until the next sweep clears it.
--   * set_shopping_card_matches: the API writes a brand's matches in bulk
--     after a catalog sync. Members read the cards as before (RLS); only
--     the server writes these.

alter table public.prompt_result_shopping_cards
  add column if not exists catalog_product_id uuid
    references public.catalog_products(id) on delete set null,
  add column if not exists catalog_match text
    check (catalog_match is null or catalog_match in ('listing', 'gtin', 'url', 'title'));

create index if not exists prompt_result_shopping_cards_catalog_product_idx
  on public.prompt_result_shopping_cards (brand_id, catalog_product_id)
  where catalog_product_id is not null;

-- A catalog product's cards by the product alone: what `on delete set null`
-- looks up when a product is deleted, which the index above can't serve.
create index if not exists prompt_result_shopping_cards_catalog_product_id_idx
  on public.prompt_result_shopping_cards (catalog_product_id)
  where catalog_product_id is not null;

comment on column public.prompt_result_shopping_cards.catalog_product_id is
  'Product visibility (00360): the brand''s catalog product this card shows, matched by its listing, GTIN, link or title; null for none.';
comment on column public.prompt_result_shopping_cards.catalog_match is
  'How catalog_product_id was found: listing, gtin, url or title (00360).';

-- A brand's cards' matches, in bulk: [{"id", "product_id", "match"}], a null
-- product_id clearing one. Only the brand's own cards change, and only those
-- whose match changed; returns how many did.
create or replace function public.set_shopping_card_matches(p_brand_id uuid, p_matches jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with m as (
    select
      (e->>'id')::uuid as id,
      nullif(e->>'product_id', '')::uuid as product_id,
      nullif(e->>'match', '') as match
    from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) as e
  ),
  changed as (
    update public.prompt_result_shopping_cards c
    set catalog_product_id = m.product_id,
        catalog_match = case when m.product_id is null then null else m.match end
    from m
    where c.id = m.id
      and c.brand_id = p_brand_id
      and (
        c.catalog_product_id is distinct from m.product_id
        or c.catalog_match is distinct from (case when m.product_id is null then null else m.match end)
      )
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke all on function public.set_shopping_card_matches(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_shopping_card_matches(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
