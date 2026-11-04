-- Normalized shopping cards.
--
-- `prompt_results.shopping_cards` stores the raw provider JSON (snake_case
-- for Perplexity, camelCase for Google AI Mode and Microsoft Copilot).
-- That's fine for archival but useless for analytics — "show me cards
-- where a competitor's product appears alongside mine" today means
-- scanning every prompt_result and JSON-parsing in app code.
--
-- This table is one row per card per prompt_result with the fields we
-- query on hoisted to real columns + the original card preserved in
-- `raw` for forward-compat. Populated by the worker after the
-- prompt_results insert (see backend/src/lib/cloroResultHandler.js)
-- and backfilled by backend/src/scripts/backfillShoppingCards.js.

create table if not exists public.prompt_result_shopping_cards (
  id uuid primary key default gen_random_uuid(),
  prompt_result_id uuid not null references public.prompt_results(id) on delete cascade,
  -- denormalized from prompt_results.brand_id so org-scoped queries don't
  -- have to join the parent row.
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Position within the provider's `shopping_cards` array (0-indexed).
  -- Combined with prompt_result_id, this is the natural identity of a card
  -- and the key the backfill script uses to stay idempotent.
  position integer not null,

  -- Hoisted analytical columns.
  product_title text,
  product_brand text,
  price_amount numeric,
  price_currency text,
  image_url text,
  merchant_url text,
  merchant_domain text,
  rating numeric,
  review_count integer,

  -- Original card JSON. Lets us re-parse if the schema evolves without
  -- needing another backfill from the provider.
  raw jsonb not null,

  -- Brand matching, computed at insert time.
  --
  --   role = 'own'        → matched_brand_id points to brands.id (the tracked brand)
  --   role = 'competitor' → matched_brand_id points to competitors.id
  --   role = 'other'      → matched_brand_id is null
  --
  -- Intentionally polymorphic (no FK) so a single column can express both
  -- relations. ON DELETE of the underlying row doesn't cascade — analytics
  -- on historical mentions stay intact even if the brand or competitor
  -- record is later removed.
  matched_brand_id uuid,
  matched_brand_role text not null default 'other'
    check (matched_brand_role in ('own', 'competitor', 'other')),

  -- Denormalized for fast "show me Copilot shopping cards in TR last week".
  platform text not null,
  region text,
  created_at timestamptz not null default now(),

  unique (prompt_result_id, position)
);

-- Indexes targeted at the Shopping dashboard's three top-level queries:
--   "show me competitor products"          → (brand_id, matched_brand_role)
--   "rank product brands by mention count" → (product_brand)
--   "merchant domain leaderboard"          → (merchant_domain)
create index if not exists prompt_result_shopping_cards_brand_role_idx
  on public.prompt_result_shopping_cards (brand_id, matched_brand_role);
create index if not exists prompt_result_shopping_cards_product_brand_idx
  on public.prompt_result_shopping_cards (product_brand);
create index if not exists prompt_result_shopping_cards_merchant_domain_idx
  on public.prompt_result_shopping_cards (merchant_domain);

alter table public.prompt_result_shopping_cards enable row level security;

-- RLS mirrors `prompt_results`: org members can read their org's cards,
-- service role inserts + deletes everything. The worker writes through
-- supabaseAdmin which bypasses RLS, but the explicit policy keeps the
-- table reachable from a future authenticated-write surface.
create policy "shopping_cards: org member select"
  on public.prompt_result_shopping_cards
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      where b.organization_id in (
        select organization_id
        from public.profiles
        where id = auth.uid()
      )
    )
  );

create policy "Service role can insert shopping cards"
  on public.prompt_result_shopping_cards
  for insert
  with check (true);

create policy "Service role can delete shopping cards"
  on public.prompt_result_shopping_cards
  for delete
  using (true);

comment on table public.prompt_result_shopping_cards is
  'One row per shopping card extracted from a prompt_result, normalized across providers. Source of truth for the Shopping dashboard and the MCP shopping tools.';
comment on column public.prompt_result_shopping_cards.matched_brand_id is
  'Polymorphic uuid: brands.id when role=own, competitors.id when role=competitor, null when role=other. Intentionally no FK so deletes don''t orphan historical analytics.';
comment on column public.prompt_result_shopping_cards.raw is
  'Original card JSON as the provider returned it. Kept for re-parsing if columns evolve.';
