-- ============================================================================
-- 00294: WordPress for Send to CMS (#1331, phase 2)
-- ============================================================================
-- After Webflow (00283, 00284), a brand connects its WordPress site: the
-- site's address, a user and an Application Password (WordPress 5.6+, made
-- under Users › Profile). Pages go to it through the REST API as draft posts.
--
--   * brand_cms_connections takes provider 'wordpress'. Composio's ids are
--     Webflow's only (Composio keeps its token); a WordPress connection has
--     the site's address (`site_url`), its name (`site_name`) and the user
--     it signs in as (`account`).
--   * brand_cms_credentials: the connection's sign-in (the user and the
--     Application Password), encrypted by the API as a store's is
--     (catalog_source_credentials, 00282): AES-256-GCM under
--     CONNECTOR_CREDENTIALS_KEY, bound to the connection's id. Service role
--     only; removed with its connection.
--   * content_draft_deliveries.target takes 'wordpress'. `target_collection`
--     keeps the site's address the post was written to, as it keeps
--     Webflow's collection: a page sent again updates its post on that site
--     only (two sites in folders of one domain number their posts each from
--     1), so it takes an address's length now.
--   * reserve_content_deliveries: as 00284, a page already queued for the
--     same CMS (Webflow or WordPress) isn't sent there again meanwhile.

alter table public.brand_cms_connections
  drop constraint if exists brand_cms_connections_provider_check,
  add constraint brand_cms_connections_provider_check
    check (provider in ('webflow', 'wordpress')),
  alter column composio_account_id drop not null,
  alter column composio_entity_id drop not null,
  add column if not exists site_url text
    check (site_url is null or (char_length(site_url) <= 2048 and site_url ~* '^https://')),
  add column if not exists account text
    check (account is null or char_length(account) between 1 and 200);

alter table public.brand_cms_connections
  drop constraint if exists brand_cms_connections_provider_fields,
  add constraint brand_cms_connections_provider_fields check (
    case provider
      when 'webflow' then composio_account_id is not null and composio_entity_id is not null
      when 'wordpress' then site_url is not null and account is not null
      else false
    end
  );

comment on column public.brand_cms_connections.site_url is
  'WordPress (00294): the site''s address, its REST API at /wp-json/.';
comment on column public.brand_cms_connections.account is
  'WordPress (00294): the user the connection signs in as, with an Application Password (kept in brand_cms_credentials).';

create table if not exists public.brand_cms_credentials (
  connection_id uuid primary key references public.brand_cms_connections(id) on delete cascade,
  secret text not null check (char_length(secret) between 1 and 16384),
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles(id) on delete set null
);

alter table public.brand_cms_credentials enable row level security;
revoke all on table public.brand_cms_credentials from public, anon, authenticated;
grant all on table public.brand_cms_credentials to service_role;

comment on table public.brand_cms_credentials is
  'Send to CMS (#1331, 00294): a CMS connection''s sign-in (WordPress: the user and the Application Password), encrypted by the API (AES-256-GCM, bound to the connection id). Service role only; removed with its connection.';

alter table public.content_draft_deliveries
  drop constraint if exists content_draft_deliveries_target_check,
  add constraint content_draft_deliveries_target_check
    check (target in ('webhook', 'webflow', 'wordpress')),
  drop constraint if exists content_draft_deliveries_target_collection_check,
  add constraint content_draft_deliveries_target_collection_check
    check (target_collection is null or char_length(target_collection) between 1 and 2048);

comment on column public.content_draft_deliveries.target is
  'Where the page was sent (00284, 00294): the brand''s webhook, its Webflow collection or its WordPress site (00283).';
comment on column public.content_draft_deliveries.target_collection is
  'The Webflow collection (00284), or the WordPress site''s address (00294), the page''s item or post was written to; its id is external_id.';

-- ----------------------------------------------------------------------------
-- As 00284, with no second send of a page to the same CMS while one is queued.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_content_deliveries(
  p_organization_id uuid,
  p_brand_id uuid,
  p_sent_by uuid,
  p_batch_id uuid,
  p_items jsonb,
  p_limit integer,
  p_target text default 'webhook'
)
returns setof public.content_draft_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
  room integer;
begin
  perform pg_advisory_xact_lock(hashtext('content_deliveries:' || p_organization_id::text));

  -- sent_at stays empty: it was never sent, and its time stays its own.
  update public.content_draft_deliveries
  set status = 'failed', error = 'Not sent: interrupted'
  where organization_id = p_organization_id
    and status = 'queued'
    and created_at < now() - interval '30 minutes';

  select count(*) into used
  from public.content_draft_deliveries
  where organization_id = p_organization_id
    and created_at > now() - interval '24 hours';

  room := greatest(0, p_limit - used);
  if room = 0 or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  -- Under the lock, so two sends of one page can't both pass: both would
  -- make an item (Webflow refuses the second on its slug) or a post.
  if p_target in ('webflow', 'wordpress') and exists (
    select 1
    from public.content_draft_deliveries d
    join jsonb_array_elements(p_items) as items(item)
      on d.draft_id = (item ->> 'draft_id')::uuid
    where d.organization_id = p_organization_id
      and d.target = p_target
      and d.status = 'queued'
  ) then
    raise exception 'delivery_in_progress' using errcode = 'P0001';
  end if;

  return query
  insert into public.content_draft_deliveries
    (organization_id, brand_id, draft_id, sent_by, batch_id, title, slug, target)
  select p_organization_id, p_brand_id, (item ->> 'draft_id')::uuid, p_sent_by, p_batch_id,
         left(item ->> 'title', 300), nullif(left(item ->> 'slug', 200), ''),
         coalesce(p_target, 'webhook')
  from jsonb_array_elements(p_items) with ordinality as items(item, position)
  order by position
  limit room
  returning *;
end;
$$;

revoke all on function public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer, text)
  to service_role;

notify pgrst, 'reload schema';
