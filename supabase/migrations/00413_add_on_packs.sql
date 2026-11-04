-- ============================================================================
-- 00413: Add-on packs — AI credits and storage, bought with Stripe
-- ============================================================================
-- CHAT-18 (and CHAT-04 item 11, CHAT-06 item 26), behind CHAT_AGENTIC: no
-- pack is offered or granted while the flag is off. A workspace that used
-- its monthly AI limit or its storage buys more in the product; nothing is
-- granted before Stripe says it was paid.
--
--   * add_on_products: the packs on sale (CHAT-18 §A), a table and not code,
--     so staff change them without a release. AI credits are one payment,
--     valid 12 months, and add half their price to the AI budget (2x the
--     model cost; grant_ai_usd); storage is monthly, renewed with the plan,
--     and adds grant_bytes (1 GB = 1024³ bytes). stripe_price_id is set per
--     deployment (test prices on a test deployment); a pack without one is
--     never sold. highlight is the "Most picked" one on its tab. Seeded with
--     the owner's packs below. Server only: the grants are dollars of model
--     cost, which no browser gets (CHAT-18 item 3); the server tells the
--     page what each pack adds for its plan.
--   * add_on_purchases: one row per Checkout an Admin started (CHAT-18 §D):
--     pending until Stripe's webhook says paid or failed (checkout.session
--     .completed, invoice.paid), each Checkout once (its id is unique);
--     refunded by staff in Stripe; a storage pack's subscription item ended
--     is cancelled. The workspace's Admins read their purchases (Settings ›
--     Billing › Add-ons); the server writes.
--   * ai_credit_grants: what a paid AI pack added: its dollars of model cost,
--     how much was used, and until when (12 months). The budget draws on
--     them after the month's included limit, oldest first (CHAT-18 item 19).
--     A refund takes the unused part away (usd_total down to usd_used).
--     Server only.
--   * storage_grants: what a paid storage pack adds, until the end of the
--     period paid for (each invoice.paid moves active_until on). Server only.
--   * prompt_improve_usage.grant_id: the AI credit grant a ledger row drew on
--     (CHAT-18 Data notes); null when it drew on the included budget. A step
--     that crosses from one to the other is written as two rows.

-- ─── Packs on sale ──────────────────────────────────────────────────────────

create table if not exists public.add_on_products (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  kind text not null check (kind in ('ai', 'storage')),
  name text not null check (char_length(name) between 1 and 100),
  -- The price in the currency's smallest unit (cents).
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  billing text not null check (billing in ('one_time', 'monthly')),
  -- AI: the dollars of model cost it adds (price ÷ 2). Storage: the bytes.
  grant_ai_usd numeric(12, 2) check (grant_ai_usd > 0),
  grant_bytes bigint check (grant_bytes > 0),
  -- AI: how long its credits last. Storage: null, it lasts while it renews.
  valid_months smallint check (valid_months > 0),
  stripe_price_id text check (stripe_price_id ~ '^price_[A-Za-z0-9]{1,200}$'),
  active boolean not null default true,
  -- "Most picked" on its tab.
  highlight boolean not null default false,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'ai') = (grant_ai_usd is not null)),
  check ((kind = 'storage') = (grant_bytes is not null)),
  check (kind <> 'ai' or (billing = 'one_time' and valid_months is not null)),
  check (kind <> 'storage' or (billing = 'monthly' and valid_months is null))
);

drop trigger if exists trg_add_on_products_updated_at on public.add_on_products;
create trigger trg_add_on_products_updated_at
  before update on public.add_on_products
  for each row execute function public.handle_updated_at();

comment on table public.add_on_products is
  'Add-on packs on sale (CHAT-18 §A): AI credits (one payment, 12 months, grant_ai_usd = price ÷ 2 of model cost) and storage (monthly, grant_bytes). Staff-edited; stripe_price_id per deployment, a pack without one isn''t sold. Server only.';

-- The owner's packs (CHAT-18 items 2 and 4; "Most picked": $50 and +25 GB).
-- Run again, it leaves them as staff may have changed them.
insert into public.add_on_products
  (id, kind, name, price_cents, billing, grant_ai_usd, grant_bytes, valid_months, highlight, sort)
values
  ('ai_10', 'ai', 'AI credits $10', 1000, 'one_time', 5, null, 12, false, 1),
  ('ai_50', 'ai', 'AI credits $50', 5000, 'one_time', 25, null, 12, true, 2),
  ('ai_250', 'ai', 'AI credits $250', 25000, 'one_time', 125, null, 12, false, 3),
  ('ai_1000', 'ai', 'AI credits $1,000', 100000, 'one_time', 500, null, 12, false, 4),
  ('storage_25', 'storage', 'Storage +25 GB', 500, 'monthly', null, 26843545600, null, true, 1),
  ('storage_100', 'storage', 'Storage +100 GB', 1500, 'monthly', null, 107374182400, null, false, 2),
  ('storage_250', 'storage', 'Storage +250 GB', 2900, 'monthly', null, 268435456000, null, false, 3)
on conflict (id) do nothing;

-- ─── Purchases ──────────────────────────────────────────────────────────────

create table if not exists public.add_on_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id text not null references public.add_on_products(id) on update cascade,
  -- The Admin who bought it.
  bought_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  stripe_checkout_session_id text unique check (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]{1,250}$'),
  stripe_invoice_id text check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]{1,250}$'),
  -- A storage pack's item on the plan's subscription.
  stripe_subscription_item_id text unique
    check (stripe_subscription_item_id ~ '^si_[A-Za-z0-9_]{1,250}$'),
  amount_paid_cents integer check (amount_paid_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  granted_at timestamptz,
  -- AI credits: granted_at + the pack's months. Storage: null.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Paid, and what came after paying, were granted.
  check (status in ('pending', 'failed') or granted_at is not null)
);

-- Settings › Billing › Add-ons: the workspace's purchases, newest first.
create index if not exists add_on_purchases_organization_created_idx
  on public.add_on_purchases (organization_id, created_at desc);
create index if not exists add_on_purchases_product_idx
  on public.add_on_purchases (product_id);
create index if not exists add_on_purchases_bought_by_idx
  on public.add_on_purchases (bought_by) where bought_by is not null;
create index if not exists add_on_purchases_invoice_idx
  on public.add_on_purchases (stripe_invoice_id) where stripe_invoice_id is not null;

drop trigger if exists trg_add_on_purchases_updated_at on public.add_on_purchases;
create trigger trg_add_on_purchases_updated_at
  before update on public.add_on_purchases
  for each row execute function public.handle_updated_at();

comment on table public.add_on_purchases is
  'Add-on packs bought (CHAT-18 §D–E): one row per Checkout, pending until the Stripe webhook says paid or failed (each Checkout once), refunded by staff, cancelled when a storage item ends. The workspace''s Admins read; the server writes.';

-- ─── What a paid pack grants ────────────────────────────────────────────────

create table if not exists public.ai_credit_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null unique references public.add_on_purchases(id) on delete cascade,
  -- Dollars of model cost (the pack's grant_ai_usd), and how much is used.
  usd_total numeric(12, 6) not null check (usd_total >= 0),
  usd_used numeric(12, 6) not null default 0 check (usd_used >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (usd_used <= usd_total)
);

-- The budget's draw: a workspace's grants still valid, oldest first.
create index if not exists ai_credit_grants_organization_expires_idx
  on public.ai_credit_grants (organization_id, expires_at);

drop trigger if exists trg_ai_credit_grants_updated_at on public.ai_credit_grants;
create trigger trg_ai_credit_grants_updated_at
  before update on public.ai_credit_grants
  for each row execute function public.handle_updated_at();

comment on table public.ai_credit_grants is
  'AI credits a paid pack added (CHAT-18 §F): dollars of model cost, used, valid until; drawn after the month''s included limit, oldest first. A refund lowers usd_total to usd_used. Server only: dollars never reach a browser.';

create table if not exists public.storage_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null unique references public.add_on_purchases(id) on delete cascade,
  bytes bigint not null check (bytes > 0),
  -- The end of the period paid for; each paid renewal moves it on.
  active_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storage_grants_organization_active_idx
  on public.storage_grants (organization_id, active_until);

drop trigger if exists trg_storage_grants_updated_at on public.storage_grants;
create trigger trg_storage_grants_updated_at
  before update on public.storage_grants
  for each row execute function public.handle_updated_at();

comment on table public.storage_grants is
  'Storage a paid pack adds (CHAT-18 item 21): bytes, until the end of the period paid for (moved on by each paid renewal). The limit is the plan''s plus these, worked out on the server. Server only.';

-- ─── The ledger's grant ─────────────────────────────────────────────────────

alter table public.prompt_improve_usage
  add column if not exists grant_id uuid
    references public.ai_credit_grants(id) on delete set null;

comment on column public.prompt_improve_usage.grant_id is
  'The AI credit grant this row drew on (00413); null when it drew on the month''s included budget.';

create index if not exists prompt_improve_usage_grant_idx
  on public.prompt_improve_usage (grant_id)
  where grant_id is not null;

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.add_on_products enable row level security;
alter table public.add_on_purchases enable row level security;
alter table public.ai_credit_grants enable row level security;
alter table public.storage_grants enable row level security;

revoke all on table public.add_on_products from anon, authenticated;
revoke all on table public.add_on_purchases from anon, authenticated;
revoke all on table public.ai_credit_grants from anon, authenticated;
revoke all on table public.storage_grants from anon, authenticated;

grant select on table public.add_on_purchases to authenticated;

grant all on table public.add_on_products to service_role;
grant all on table public.add_on_purchases to service_role;
grant all on table public.ai_credit_grants to service_role;
grant all on table public.storage_grants to service_role;

-- Billing is the Admins': the workspace's Admins read its purchases, while
-- they belong to it.
drop policy if exists "add_on_purchases: admin select" on public.add_on_purchases;
create policy "add_on_purchases: admin select"
  on public.add_on_purchases
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
