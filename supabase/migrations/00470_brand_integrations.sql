-- ============================================================================
-- 00470: brand access — integrations per brand: the Account's sign-ins, and
-- which one each brand uses
-- ============================================================================
-- BRAND-ACCESS PR 14 (Integrations 1). Every integration becomes per brand
-- (D5): Google (Search Console, Analytics, Merchant Center) and the CMS sites
-- (Webflow, WordPress, Framer, Wix). One Google login may serve several brands
-- without signing in again (D6), so a sign-in lives once in the Account's pool
-- and each brand names the one it uses:
--
--   * integration_accounts: the Account's sign-ins, one row each: a Google
--     login for one Google product (Composio keeps one connected account per
--     product), or a brand's CMS site. Composio's entity and connected
--     account ids, as integration_connections (00045) and
--     brand_cms_connections (00283) keep them; no token ever. `label` is what
--     the sign-in is called on a card: a CMS site's name for now (a Google
--     login's e-mail comes with the Brand settings cards, PR 15).
--   * brand_integrations: the sign-in a brand uses for each provider, one per
--     brand and provider. `settings` is for the brand's own choices on it (a
--     property, a site, a collection); nothing writes it yet: the Search
--     Console and Analytics properties stay on brands.gsc_property and
--     brands.ga_property_id, and the CMS site and collection on
--     brand_cms_connections, which everything reads as before.
--
-- The switch-over (D7) copies what there is, and nothing disconnects:
--
--   * the Account's Google rows (integration_connections) become pool
--     sign-ins used by every brand of the Account, the demo brand too, as
--     every brand used them before. A brand added later uses them as well.
--   * each brand's CMS connection becomes a sign-in that brand uses, so the
--     CMS cards don't change.
--   * Until the Brand settings cards (PR 15) connect per brand, the old
--     tables stay the ones written: Settings › Integrations and the CMS cards
--     write them, and the triggers below keep the pool in step (a removed
--     connection takes its sign-in, and the brands' use of it, with it).
--     The API server reads a brand's connection from the pool (its
--     lib/brandIntegrations.js, and the web's lib/brandIntegrations.ts),
--     which names the connected account it calls Composio with: several
--     sign-ins may share one Composio entity.
--
-- Nothing anyone sees changes: every brand uses the Account's Google
-- connection as before, and its CMS site.
--
-- Who reads what (BRAND-ACCESS §3.3): a brand's integrations are read by the
-- people who can access the brand, and a sign-in by the people who can
-- access a brand that uses it. Only the server writes them. The server
-- writes integration_connections too: its admin and manager write policy
-- (00045, never used by the app) goes, since the pool now follows that
-- table and the API calls Composio with the account it names.

-- ── integration_accounts ────────────────────────────────────────────────────

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    constraint integration_accounts_organization_id_fkey
    references public.organizations(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 100),
  composio_entity_id text,
  composio_account_id text,
  label text check (label is null or char_length(label) <= 300),
  status text not null default 'pending' check (char_length(status) between 1 and 40),
  connected_by uuid
    constraint integration_accounts_connected_by_fkey
    references public.profiles(id) on delete set null,
  -- Where the sign-in comes from while the old tables are the ones written.
  integration_connection_id uuid unique
    constraint integration_accounts_integration_connection_id_fkey
    references public.integration_connections(id) on delete cascade,
  cms_connection_id uuid unique
    constraint integration_accounts_cms_connection_id_fkey
    references public.brand_cms_connections(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_accounts_one_source
    check (num_nonnulls(integration_connection_id, cms_connection_id) <= 1)
);

create index if not exists integration_accounts_organization_provider_idx
  on public.integration_accounts (organization_id, provider);

comment on table public.integration_accounts is
  'Integrations per brand (00470): the Account''s sign-ins, one per Google login and product or CMS site, with Composio''s entity and connected account ids (never a token). Brands use them through brand_integrations. Read by people who can access a brand that uses one; written by the server.';
comment on column public.integration_accounts.status is
  'pending, connected or disconnected (a Google sign-in, as integration_connections keeps it); connected or auth_failed (a CMS site, as brand_cms_connections keeps it).';
comment on column public.integration_accounts.label is
  'What the sign-in is called on a card: the CMS site''s name (or address, or id). A Google login''s e-mail comes with PR 15.';
comment on column public.integration_accounts.integration_connection_id is
  'The Account''s Google row (00045) this sign-in follows while Settings › Integrations writes that table. Removed with it.';
comment on column public.integration_accounts.cms_connection_id is
  'The brand''s CMS connection (00283) this sign-in follows while the CMS cards write that table. Removed with it.';

-- ── brand_integrations ──────────────────────────────────────────────────────

create table if not exists public.brand_integrations (
  brand_id uuid not null
    constraint brand_integrations_brand_id_fkey
    references public.brands(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 100),
  account_id uuid not null
    constraint brand_integrations_account_id_fkey
    references public.integration_accounts(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (
    jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 8192
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, provider)
);

-- The brands that use a sign-in (the pool's policy, a removed sign-in's cascade).
create index if not exists brand_integrations_account_id_idx
  on public.brand_integrations (account_id);

comment on table public.brand_integrations is
  'Integrations per brand (00470): the sign-in (integration_accounts) a brand uses for each provider. settings: the brand''s own choices on it, written by nothing yet (the Google properties stay on brands, the CMS site on brand_cms_connections). Read by people who can access the brand; written by the server.';

-- A brand uses a sign-in of its own organization, for the provider it names.
create or replace function public.check_brand_integration_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.integration_accounts a
    join public.brands b on b.organization_id = a.organization_id
    where a.id = new.account_id
      and a.provider = new.provider
      and b.id = new.brand_id
  ) then
    raise exception 'brand_integrations: sign-in % is not a % sign-in of the organization of brand %',
      new.account_id, new.provider, new.brand_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists brand_integrations_check_account on public.brand_integrations;
create trigger brand_integrations_check_account
  before insert or update on public.brand_integrations
  for each row execute function public.check_brand_integration_account();

-- ── Who reads them ──────────────────────────────────────────────────────────

alter table public.integration_accounts enable row level security;
revoke all on table public.integration_accounts from anon, authenticated;
grant select on table public.integration_accounts to authenticated;
grant all on table public.integration_accounts to service_role;

alter table public.brand_integrations enable row level security;
revoke all on table public.brand_integrations from anon, authenticated;
grant select on table public.brand_integrations to authenticated;
grant all on table public.brand_integrations to service_role;

drop policy if exists "brand_integrations: member select" on public.brand_integrations;
create policy "brand_integrations: member select" on public.brand_integrations
  for select
  to authenticated
  using (brand_id in (select public.user_brand_ids()));

-- A sign-in a brand the person can access uses: through brand_integrations'
-- own policy.
drop policy if exists "integration_accounts: member select" on public.integration_accounts;
create policy "integration_accounts: member select" on public.integration_accounts
  for select
  to authenticated
  using (id in (select bi.account_id from public.brand_integrations bi));

-- integration_connections: the server writes it (00045 said so); the pool
-- follows it now, so a person can't write it under RLS.
drop policy if exists "integration_connections: admin write" on public.integration_connections;
revoke insert, update, delete, truncate on table public.integration_connections from anon, authenticated;

-- ── Keeping the pool in step with the old tables ────────────────────────────
-- Security definer: the server writes the old tables, and a person adding a
-- brand (createBrand, under RLS) fires the brand trigger; only the server
-- writes the pool. Made before the copy below, so a connection written while
-- this migration runs is copied by one or the other.

-- The Account's Google row → its sign-in; a new row is used by every brand of
-- the Account that uses none for that product yet.
create or replace function public.sync_integration_connection_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  insert into public.integration_accounts as a (
    organization_id, provider, composio_entity_id, composio_account_id, status,
    connected_by, integration_connection_id, created_at, updated_at
  )
  values (
    new.organization_id, new.provider, new.composio_entity_id, new.composio_account_id,
    new.status, new.connected_by, new.id, new.created_at, new.updated_at
  )
  on conflict (integration_connection_id) do update set
    composio_entity_id = excluded.composio_entity_id,
    composio_account_id = excluded.composio_account_id,
    status = excluded.status,
    connected_by = excluded.connected_by,
    updated_at = excluded.updated_at
  returning a.id into v_account_id;

  if tg_op = 'INSERT' then
    insert into public.brand_integrations (brand_id, provider, account_id)
    select b.id, new.provider, v_account_id
    from public.brands b
    where b.organization_id = new.organization_id
    on conflict (brand_id, provider) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.sync_integration_connection_account() from public, anon, authenticated;

drop trigger if exists integration_connections_sync_account on public.integration_connections;
create trigger integration_connections_sync_account
  after insert or update on public.integration_connections
  for each row execute function public.sync_integration_connection_account();

-- A brand's CMS connection → its sign-in, used by that brand.
create or replace function public.sync_cms_connection_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  insert into public.integration_accounts as a (
    organization_id, provider, composio_entity_id, composio_account_id, label, status,
    connected_by, cms_connection_id, created_at, updated_at
  )
  select
    b.organization_id, new.provider, new.composio_entity_id, new.composio_account_id,
    left(coalesce(nullif(new.site_name, ''), new.site_url, new.site_id), 300), new.status,
    new.connected_by, new.id, new.created_at, new.updated_at
  from public.brands b
  where b.id = new.brand_id
  on conflict (cms_connection_id) do update set
    composio_entity_id = excluded.composio_entity_id,
    composio_account_id = excluded.composio_account_id,
    label = excluded.label,
    status = excluded.status,
    connected_by = excluded.connected_by,
    updated_at = excluded.updated_at
  returning a.id into v_account_id;

  if tg_op = 'INSERT' and v_account_id is not null then
    insert into public.brand_integrations (brand_id, provider, account_id)
    values (new.brand_id, new.provider, v_account_id)
    on conflict (brand_id, provider) do update set
      account_id = excluded.account_id,
      updated_at = now();
  end if;
  return null;
end;
$$;

revoke all on function public.sync_cms_connection_account() from public, anon, authenticated;

drop trigger if exists brand_cms_connections_sync_account on public.brand_cms_connections;
create trigger brand_cms_connections_sync_account
  after insert or update on public.brand_cms_connections
  for each row execute function public.sync_cms_connection_account();

-- A new brand uses the Account's Google sign-ins, as every brand did before.
create or replace function public.use_account_integrations_on_new_brand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.brand_integrations (brand_id, provider, account_id)
  select new.id, a.provider, a.id
  from public.integration_accounts a
  where a.organization_id = new.organization_id
    and a.integration_connection_id is not null
  on conflict (brand_id, provider) do nothing;
  return null;
end;
$$;

revoke all on function public.use_account_integrations_on_new_brand() from public, anon, authenticated;

drop trigger if exists brands_use_account_integrations on public.brands;
create trigger brands_use_account_integrations
  after insert on public.brands
  for each row execute function public.use_account_integrations_on_new_brand();

-- ── The switch-over: copy what there is (D7) ────────────────────────────────

-- The Account's Google rows (Search Console, Analytics, Merchant Center)…
insert into public.integration_accounts (
  organization_id, provider, composio_entity_id, composio_account_id, status,
  connected_by, integration_connection_id, created_at, updated_at
)
select
  ic.organization_id, ic.provider, ic.composio_entity_id, ic.composio_account_id, ic.status,
  ic.connected_by, ic.id, ic.created_at, ic.updated_at
from public.integration_connections ic
on conflict (integration_connection_id) do nothing;

-- …used by every brand of the Account.
insert into public.brand_integrations (brand_id, provider, account_id)
select b.id, a.provider, a.id
from public.integration_accounts a
join public.brands b on b.organization_id = a.organization_id
where a.integration_connection_id is not null
on conflict (brand_id, provider) do nothing;

-- Each brand's CMS site…
insert into public.integration_accounts (
  organization_id, provider, composio_entity_id, composio_account_id, label, status,
  connected_by, cms_connection_id, created_at, updated_at
)
select
  b.organization_id, c.provider, c.composio_entity_id, c.composio_account_id,
  left(coalesce(nullif(c.site_name, ''), c.site_url, c.site_id), 300), c.status,
  c.connected_by, c.id, c.created_at, c.updated_at
from public.brand_cms_connections c
join public.brands b on b.id = c.brand_id
on conflict (cms_connection_id) do nothing;

-- …used by its brand.
insert into public.brand_integrations (brand_id, provider, account_id)
select c.brand_id, c.provider, a.id
from public.brand_cms_connections c
join public.integration_accounts a on a.cms_connection_id = c.id
on conflict (brand_id, provider) do nothing;

notify pgrst, 'reload schema';
