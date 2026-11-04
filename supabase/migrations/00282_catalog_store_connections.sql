-- ============================================================================
-- 00282: store connections for the catalog (#1263, part 3)
-- ============================================================================
-- A catalog source (00279) can now be a store or marketplace a connector
-- reads with the brand's own sign-in (WooCommerce, Etsy, …), next to a feed
-- URL and an upload.
--
--   * A source's kind is its connector's: any short slug. The server only
--     syncs kinds it has a connector for.
--   * Members still add only feed URLs and uploads themselves. A store is
--     connected through the API, which checks the sign-in with the store,
--     makes the source and keeps its credentials, so a store source never
--     exists without them.
--   * `account` names the store's account to the person: a shop's domain,
--     a seller id. A store's `url` is optional; a feed's is required, and an
--     upload has none.
--   * A brand connects each store account once.
--   * Members remove feed URLs and uploads themselves. A store is removed
--     through the API, which revokes its sign-in at the store first.
--   * `auth_failed`: the store refused the saved sign-in.
--   * The daily run reads every kind but uploads.
--
-- Credentials live in `catalog_source_credentials`, one row per source,
-- encrypted by the API with a key only it holds (AES-256-GCM, bound to the
-- source's id). Only the service role reads or writes them: members can't
-- even see that a row exists. They go with their source.

alter table public.catalog_sources drop constraint if exists catalog_sources_kind_check;
alter table public.catalog_sources
  add constraint catalog_sources_kind_check check (kind ~ '^[a-z][a-z0-9_]{1,39}$');

alter table public.catalog_sources drop constraint if exists catalog_sources_url_kind;
alter table public.catalog_sources
  add constraint catalog_sources_url_kind check (
    (kind <> 'feed_url' or url is not null) and (kind <> 'upload' or url is null)
  );

alter table public.catalog_sources
  add column if not exists account text
    check (account is null or char_length(account) between 1 and 200);

alter table public.catalog_sources drop constraint if exists catalog_sources_last_status_check;
alter table public.catalog_sources
  add constraint catalog_sources_last_status_check check (
    last_status is null or last_status in ('ok', 'failed', 'format_error', 'auth_failed')
  );

-- Members add feed URLs and uploads; stores come through the API.
drop policy if exists "catalog_sources: admin/manager insert" on public.catalog_sources;
create policy "catalog_sources: admin/manager insert"
  on public.catalog_sources
  for insert
  with check (
    kind in ('feed_url', 'upload')
    and brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
    and created_by = auth.uid()
  );

-- Members remove feed URLs and uploads; stores go through the API.
drop policy if exists "catalog_sources: admin/manager delete" on public.catalog_sources;
create policy "catalog_sources: admin/manager delete"
  on public.catalog_sources
  for delete
  using (
    kind in ('feed_url', 'upload')
    and brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

create unique index if not exists catalog_sources_one_account
  on public.catalog_sources (brand_id, kind, account)
  where account is not null;

drop index if exists public.catalog_sources_feed_due_idx;
create index if not exists catalog_sources_due_idx
  on public.catalog_sources (last_synced_at nulls first)
  where kind <> 'upload';

create table if not exists public.catalog_source_credentials (
  source_id uuid primary key references public.catalog_sources(id) on delete cascade,
  secret text not null check (char_length(secret) between 1 and 16384),
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles(id) on delete set null
);

alter table public.catalog_source_credentials enable row level security;
revoke all on table public.catalog_source_credentials from public, anon, authenticated;
grant all on table public.catalog_source_credentials to service_role;

comment on table public.catalog_source_credentials is
  'Catalog (#1263, 00282): a store source''s sign-in, encrypted by the API (AES-256-GCM, bound to the source id). Service role only; removed with its source.';
comment on column public.catalog_sources.account is
  'The store''s account as the person knows it (a shop domain, a seller id), set by the API when the store is connected.';

notify pgrst, 'reload schema';
