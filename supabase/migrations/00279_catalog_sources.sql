-- ============================================================================
-- 00279: where a brand's catalog comes from (#1263, part 2)
-- ============================================================================
-- A brand's catalog sources: a product feed URL the server reads every day
-- (and on demand), or the CSV a person uploads. Each source's products are
-- kept in the catalog (00278) under its own `source` key,
-- `src_<the source's id without dashes>`, so two feeds of one brand never
-- mark each other's products removed.
--
--   * Members read their brands' sources; admins and managers add, change
--     and remove them (as the rest of a brand). A feed URL must be http(s);
--     the server fetches it only to public addresses.
--   * The last sync's outcome (`last_*`) is the server's to write.
--   * At most 10 sources a brand, one upload source each.
--   * Removing a source removes its products from the catalog: nothing of
--     a source outlives it.

create table if not exists public.catalog_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('feed_url', 'upload')),
  format text not null default 'auto'
    check (format in ('auto', 'google_xml', 'csv', 'meta_csv')),
  url text check (url is null or (char_length(url) <= 2048 and url ~ '^https?://')),
  label text check (label is null or char_length(label) between 1 and 200),
  last_synced_at timestamptz,
  last_status text check (last_status is null or last_status in ('ok', 'failed', 'format_error')),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  last_counts jsonb check (
    last_counts is null
    or (jsonb_typeof(last_counts) = 'object' and octet_length(last_counts::text) <= 4096)
  ),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint catalog_sources_url_kind check ((kind = 'feed_url') = (url is not null)),
  unique (brand_id, url)
);

create unique index if not exists catalog_sources_one_upload
  on public.catalog_sources (brand_id)
  where kind = 'upload';
create index if not exists catalog_sources_feed_due_idx
  on public.catalog_sources (last_synced_at nulls first)
  where kind = 'feed_url';

alter table public.catalog_sources enable row level security;
revoke all on table public.catalog_sources from anon, authenticated;
grant select on table public.catalog_sources to authenticated;
grant insert (brand_id, kind, format, url, label, created_by) on table public.catalog_sources to authenticated;
grant update (format, label) on table public.catalog_sources to authenticated;
grant delete on table public.catalog_sources to authenticated;
grant all on table public.catalog_sources to service_role;

drop policy if exists "catalog_sources: member select" on public.catalog_sources;
create policy "catalog_sources: member select"
  on public.catalog_sources
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

drop policy if exists "catalog_sources: admin/manager insert" on public.catalog_sources;
create policy "catalog_sources: admin/manager insert"
  on public.catalog_sources
  for insert
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
    and created_by = auth.uid()
  );

drop policy if exists "catalog_sources: admin/manager update" on public.catalog_sources;
create policy "catalog_sources: admin/manager update"
  on public.catalog_sources
  for update
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

drop policy if exists "catalog_sources: admin/manager delete" on public.catalog_sources;
create policy "catalog_sources: admin/manager delete"
  on public.catalog_sources
  for delete
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

-- At most 10 sources a brand. Serialized per brand, so two inserts at once
-- can't both pass.
create or replace function public.catalog_sources_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('catalog_sources'), hashtext(new.brand_id::text));
  if (select count(*) from public.catalog_sources where brand_id = new.brand_id) >= 10 then
    raise exception 'A brand has 10 catalog sources at most' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_sources_cap on public.catalog_sources;
create trigger catalog_sources_cap
  before insert on public.catalog_sources
  for each row execute function public.catalog_sources_cap();

-- A removed source takes its products with it. Members can't write the
-- catalog, so this runs as the table's owner; it touches only the removed
-- source's own rows (its brand and its source key).
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
  return old;
end;
$$;

revoke all on function public.catalog_sources_forget() from public, anon, authenticated;

drop trigger if exists catalog_sources_forget on public.catalog_sources;
create trigger catalog_sources_forget
  after delete on public.catalog_sources
  for each row execute function public.catalog_sources_forget();

comment on table public.catalog_sources is
  'Catalog (#1263, 00279): where a brand''s catalog comes from: a feed URL read daily, or an uploaded CSV. Its products are kept under source src_<id>. Members read; admins and managers add, change and remove; the server writes last_*. Removing one removes its products.';

notify pgrst, 'reload schema';
