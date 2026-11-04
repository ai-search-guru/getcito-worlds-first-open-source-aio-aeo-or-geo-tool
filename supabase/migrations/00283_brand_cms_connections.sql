-- ============================================================================
-- 00283: a brand's CMS connection for Send to CMS (#1331, phase 2)
-- ============================================================================
-- Phase 1 sends pages to the brand's webhook. Phase 2 sends them to the CMS
-- itself, Webflow first: a brand connects its Webflow site with a site token,
-- picks the collection its pages go to and which of the collection's fields
-- takes what.
--
--   * One connection a brand and CMS. A Webflow site token is one site's, so
--     the connection is the brand's, not the workspace's.
--   * The token never touches this table: Composio keeps it (an API-key
--     connected account, as Search Console's OAuth tokens are kept, 00045).
--     We keep the connected account's id and its Composio user.
--   * `field_map`: which of the collection's fields takes each part of a page
--     ({ body, metaTitle, metaDescription, jsonLd } → a field's slug). The
--     item's name and slug always go to Webflow's own `name` and `slug`.
--   * `auth_failed`: Webflow refused the saved token; the person connects again.
--   * Members read their brands' connections (the Send dialog and Settings
--     show them); only the server writes them, for admins and managers.

create table if not exists public.brand_cms_connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  provider text not null check (provider in ('webflow')),
  composio_account_id text not null check (char_length(composio_account_id) between 1 and 200),
  composio_entity_id text not null check (char_length(composio_entity_id) between 1 and 200),
  status text not null default 'connected' check (status in ('connected', 'auth_failed')),
  site_id text check (site_id is null or char_length(site_id) between 1 and 100),
  site_name text check (site_name is null or char_length(site_name) <= 300),
  collection_id text check (collection_id is null or char_length(collection_id) between 1 and 100),
  collection_name text check (collection_name is null or char_length(collection_name) <= 300),
  field_map jsonb not null default '{}'::jsonb check (
    jsonb_typeof(field_map) = 'object' and octet_length(field_map::text) <= 2048
  ),
  connected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A collection is picked on its site.
  constraint brand_cms_connections_collection_site check (collection_id is null or site_id is not null),
  unique (brand_id, provider)
);

alter table public.brand_cms_connections enable row level security;
revoke all on table public.brand_cms_connections from anon, authenticated;
grant select on table public.brand_cms_connections to authenticated;
grant all on table public.brand_cms_connections to service_role;

drop policy if exists "brand_cms_connections: member select" on public.brand_cms_connections;
create policy "brand_cms_connections: member select"
  on public.brand_cms_connections
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.brand_cms_connections is
  'Send to CMS, phase 2 (#1331, 00283): a brand''s CMS connection (Webflow first): its Composio connected account (the token stays at Composio), the site and collection pages go to, and field_map (body, metaTitle, metaDescription, jsonLd → the collection''s field slugs). Members read; the server writes for admins and managers.';

notify pgrst, 'reload schema';
