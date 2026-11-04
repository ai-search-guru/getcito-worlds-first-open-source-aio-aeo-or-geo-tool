-- ============================================================================
-- 00278: the product catalog (#1263, part 1)
-- ============================================================================
-- One shape every catalog source writes into: a store connection, a product
-- feed URL, a CSV upload. Everything is a brand's:
--
--   * catalog_products: a product, keyed by (brand, source, external id). A
--     feed's item group is one product; an item with no group is its own.
--   * catalog_variants: what's sold: SKU, GTIN, MPN, a marketplace's item id
--     (ASIN), price, availability and the options that make it (color,
--     size, material, as `attributes`).
--   * catalog_images: a product's or a variant's images, in order.
--   * catalog_categories: a flat list per brand (a feed's product type, as
--     written), and catalog_product_categories, a product's (several).
--
-- Only the server writes (the service role), through one batch sync
-- (backend/src/lib/catalog/sync.js) that updates rows in place and marks a
-- product or variant gone from its source as removed (removed_at), never
-- deleting it. `content_hash` is the sync's: a row whose content didn't
-- change isn't written again. Members read their brands' rows.

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  source text not null check (source ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id text not null check (char_length(external_id) between 1 and 300),
  title text not null check (char_length(title) between 1 and 1000),
  description text check (description is null or char_length(description) <= 20000),
  product_brand text check (product_brand is null or char_length(product_brand) <= 300),
  url text check (url is null or (char_length(url) <= 2048 and url ~ '^https?://')),
  product_type text check (product_type is null or char_length(product_type) <= 750),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{40}$'),
  removed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, source, external_id)
);

create index if not exists catalog_products_brand_live_idx
  on public.catalog_products (brand_id)
  where removed_at is null;

create table if not exists public.catalog_variants (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  source text not null check (source ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id text not null check (char_length(external_id) between 1 and 300),
  title text check (title is null or char_length(title) <= 1000),
  sku text check (sku is null or char_length(sku) <= 300),
  gtin text check (gtin is null or char_length(gtin) <= 50),
  mpn text check (mpn is null or char_length(mpn) <= 300),
  marketplace_item_id text check (marketplace_item_id is null or char_length(marketplace_item_id) <= 300),
  url text check (url is null or (char_length(url) <= 2048 and url ~ '^https?://')),
  price numeric(14, 2) check (price is null or price >= 0),
  sale_price numeric(14, 2) check (sale_price is null or sale_price >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  availability text check (availability is null or char_length(availability) <= 50),
  condition text check (condition is null or char_length(condition) <= 50),
  attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 4096),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{40}$'),
  removed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, source, external_id)
);

create index if not exists catalog_variants_product_idx on public.catalog_variants (product_id);
create index if not exists catalog_variants_brand_gtin_idx
  on public.catalog_variants (brand_id, gtin)
  where gtin is not null;

create table if not exists public.catalog_images (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  variant_id uuid references public.catalog_variants(id) on delete cascade,
  url text not null check (char_length(url) <= 2048 and url ~ '^https?://'),
  position smallint not null default 0 check (position >= 0)
);

create index if not exists catalog_images_product_idx on public.catalog_images (product_id);
create index if not exists catalog_images_variant_idx on public.catalog_images (variant_id);

create table if not exists public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 750),
  created_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table if not exists public.catalog_product_categories (
  brand_id uuid not null references public.brands(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  category_id uuid not null references public.catalog_categories(id) on delete cascade,
  primary key (product_id, category_id)
);

create index if not exists catalog_product_categories_category_idx
  on public.catalog_product_categories (category_id);

-- Members read their brands' catalog; only the service role writes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'catalog_products',
    'catalog_variants',
    'catalog_images',
    'catalog_categories',
    'catalog_product_categories'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || ': member select', t);
    execute format(
      'create policy %I on public.%I for select using (
         brand_id in (
           select b.id from public.brands b
           join public.profiles p on p.organization_id = b.organization_id
           where p.id = auth.uid()
         )
       )',
      t || ': member select',
      t
    );
  end loop;
end $$;

comment on table public.catalog_products is
  'Catalog (#1263, 00278): a brand''s products from a source (store, feed, CSV), keyed by (brand, source, external id); removed_at once gone from the source. Server writes, members read.';
comment on table public.catalog_variants is
  'Catalog (#1263, 00278): a product''s variants: SKU, GTIN, MPN, marketplace item id, price, availability and options (attributes). Server writes, members read.';
comment on table public.catalog_images is
  'Catalog (#1263, 00278): a product''s or variant''s images, in order. Server writes, members read.';
comment on table public.catalog_categories is
  'Catalog (#1263, 00278): a brand''s categories, a flat list (a feed''s product type as written). Server writes, members read.';
comment on table public.catalog_product_categories is
  'Catalog (#1263, 00278): the categories a product is in. Server writes, members read.';

notify pgrst, 'reload schema';
