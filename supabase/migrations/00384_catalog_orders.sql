-- ============================================================================
-- 00384: orders from store connectors (#1275)
-- ============================================================================
-- Store connectors may sync order totals and line items for revenue reporting.
-- This deliberately excludes buyer/customer fields: no names, emails, phone
-- numbers, addresses, billing/shipping blobs, or raw order payloads are stored.
--
-- last_orders_synced_at is the incremental WooCommerce modified-time cursor.
-- An order sync advances it only after the normalized orders and line items
-- have been persisted successfully.

alter table public.catalog_sources
  add column if not exists last_orders_synced_at timestamptz;

create table if not exists public.catalog_orders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  source text not null check (source ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id text not null check (char_length(external_id) between 1 and 300),
  placed_at timestamptz not null,
  modified_at timestamptz,
  status text not null default '' check (char_length(status) <= 50),
  channel text not null default '' check (char_length(channel) <= 100),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  total numeric(14, 2) not null default 0 check (total >= 0),
  refunded_total numeric(14, 2) not null default 0 check (refunded_total >= 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, source, external_id)
);

create index if not exists catalog_orders_brand_placed_idx
  on public.catalog_orders (brand_id, placed_at desc);
create index if not exists catalog_orders_source_modified_idx
  on public.catalog_orders (source, modified_at asc);

create table if not exists public.catalog_order_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  order_id uuid not null references public.catalog_orders(id) on delete cascade,
  external_line_id text not null check (char_length(external_line_id) between 1 and 300),
  external_product_id text not null check (char_length(external_product_id) between 1 and 300),
  external_variation_id text check (
    external_variation_id is null or char_length(external_variation_id) between 1 and 300
  ),
  quantity integer not null check (quantity > 0),
  revenue numeric(14, 2) not null default 0 check (revenue >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, external_line_id)
);

create index if not exists catalog_order_items_order_idx
  on public.catalog_order_items (order_id);
create index if not exists catalog_order_items_brand_product_idx
  on public.catalog_order_items (brand_id, external_product_id);

-- Orders and their product/variation identifiers are available to workspace
-- members; only the service role writes them.
do $$
declare
  t text;
begin
  foreach t in array array['catalog_orders', 'catalog_order_items']
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

-- A removed source takes its orders with it, as it does its products (00279):
-- same function, one more delete; the order lines go with their orders (on
-- delete cascade).
create or replace function public.catalog_sources_forget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.catalog_products
  where brand_id = old.brand_id
    and source = 'src_' || replace(old.id::text, '-', '');
  delete from public.catalog_variants
  where brand_id = old.brand_id
    and source = 'src_' || replace(old.id::text, '-', '');
  delete from public.catalog_orders
  where brand_id = old.brand_id
    and source = 'src_' || replace(old.id::text, '-', '');
  return old;
end;
$$;

revoke all on function public.catalog_sources_forget() from public, anon, authenticated;

comment on table public.catalog_orders is
  'Store order summaries for revenue reporting. Contains ids, dates, status, source channel and money totals only; never buyer personal data.';
comment on table public.catalog_order_items is
  'Store order line items by external product/variation id, quantity and revenue. No product payload or buyer personal data.';
comment on column public.catalog_sources.last_orders_synced_at is
  'Incremental cursor for order changes; advanced only after normalized orders and line items are stored.';
