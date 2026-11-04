-- ============================================================================
-- 00296: item issues from Google Merchant Center (#1270)
-- ============================================================================
-- The Merchant Center connector reads a brand's Merchant Center account into
-- its catalog (00278), and with each product the problems Merchant Center
-- reports for it: a missing GTIN, a price that doesn't match the landing
-- page, an image too small. Those decide whether the product can show in
-- Google's shopping results, AI Overviews and AI Mode among them, so we keep
-- them to tell the brand what to fix ("Feed fields complete", the readiness
-- cards, later).
--
--   * One row per issue per item (an offer, the catalog's variant), as
--     Merchant Center lists it: its code, severity (not_impacted, demoted,
--     disapproved), the attribute it concerns, the destination it affects
--     (reporting context) and its description. An item with no issues has
--     no rows.
--   * A sync replaces its source's rows; they go with their source.
--   * Members read their brands' rows; the server writes them.
--
-- A Merchant Center source has no credentials row (00282): it reads through
-- the workspace's Google sign-in, which Composio keeps
-- (integration_connections, 00045).

create table if not exists public.catalog_item_issues (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  source_id uuid not null references public.catalog_sources(id) on delete cascade,
  -- The item's id in the catalog (catalog_variants.external_id): Merchant Center's offer id.
  external_id text not null check (char_length(external_id) between 1 and 200),
  code text not null check (char_length(code) between 1 and 200),
  severity text not null check (severity in ('not_impacted', 'demoted', 'disapproved')),
  attribute text check (attribute is null or char_length(attribute) <= 200),
  reporting_context text check (reporting_context is null or char_length(reporting_context) <= 100),
  description text check (description is null or char_length(description) <= 1000),
  detail text check (detail is null or char_length(detail) <= 2000),
  documentation text check (documentation is null or char_length(documentation) <= 2048),
  resolution text check (resolution is null or char_length(resolution) <= 100),
  countries text[] not null default '{}' check (cardinality(countries) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists catalog_item_issues_source_idx
  on public.catalog_item_issues (source_id);
create index if not exists catalog_item_issues_brand_item_idx
  on public.catalog_item_issues (brand_id, external_id);

alter table public.catalog_item_issues enable row level security;
revoke all on table public.catalog_item_issues from anon, authenticated;
grant select on table public.catalog_item_issues to authenticated;
grant all on table public.catalog_item_issues to service_role;

drop policy if exists "catalog_item_issues: member select" on public.catalog_item_issues;
create policy "catalog_item_issues: member select"
  on public.catalog_item_issues
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.catalog_item_issues is
  'Catalog (#1270, 00296): the issues Google Merchant Center reports per item (offer) of a Merchant Center source: code, severity, attribute, destination (reporting context), description. Replaced by each sync, removed with the source. Server writes, members read.';

notify pgrst, 'reload schema';
