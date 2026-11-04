-- ============================================================================
-- 00372: Wix for Send to CMS (#1331, phase 2)
-- ============================================================================
-- After Webflow (00283, 00284), WordPress (00294) and Framer (00295), a brand
-- connects its Wix site: the site's id and an API key its owner made in Wix's
-- API Keys Manager, with the Wix Blog permissions. Pages go to the site's
-- Blog through Wix's REST API as draft posts.
--
--   * brand_cms_connections takes provider 'wix'. A Wix connection keeps the
--     site's id (`site_id`), its name (`site_name`) and the member who owns
--     the posts it writes (`account`: a Wix member id; Wix's Blog needs an
--     owner for a post).
--   * The API key is kept in brand_cms_credentials, sealed as WordPress's
--     sign-in is (00294); the table itself doesn't change.
--   * content_draft_deliveries.target takes 'wix'. `target_collection` keeps
--     the site's id the post was written to, as it keeps WordPress's site.
--   * reserve_content_deliveries: as 00295, a page already queued for the
--     same CMS (Webflow, WordPress, Framer or Wix) isn't sent there again
--     meanwhile.

alter table public.brand_cms_connections
  drop constraint if exists brand_cms_connections_provider_check,
  add constraint brand_cms_connections_provider_check
    check (provider in ('webflow', 'wordpress', 'framer', 'wix'));

alter table public.brand_cms_connections
  drop constraint if exists brand_cms_connections_provider_fields,
  add constraint brand_cms_connections_provider_fields check (
    case provider
      when 'webflow' then composio_account_id is not null and composio_entity_id is not null
      when 'wordpress' then site_url is not null and account is not null
      when 'framer' then site_id is not null
      when 'wix' then site_id is not null and account is not null
      else false
    end
  );

comment on column public.brand_cms_connections.site_id is
  'Webflow: the site pages go to (00283). Framer (00295): the project''s id, as Framer connects to it. Wix (00372): the site''s id.';
comment on column public.brand_cms_connections.site_name is
  'The site''s name (Webflow, WordPress, Wix (00372): its display name, when the API key may read it), or the Framer project''s (00295).';
comment on column public.brand_cms_connections.account is
  'WordPress (00294): the user the connection signs in as, with an Application Password. Framer (00295): the user the API key acts as. Both kept in brand_cms_credentials. Wix (00372): the member who owns the posts it writes.';

comment on table public.brand_cms_credentials is
  'Send to CMS (#1331, 00294, 00295, 00372): a CMS connection''s sign-in (WordPress: the user and the Application Password; Framer: the project''s API key; Wix: the site owner''s API key), encrypted by the API (AES-256-GCM, bound to the connection id). Service role only; removed with its connection.';

alter table public.content_draft_deliveries
  drop constraint if exists content_draft_deliveries_target_check,
  add constraint content_draft_deliveries_target_check
    check (target in ('webhook', 'webflow', 'wordpress', 'framer', 'wix'));

comment on column public.content_draft_deliveries.target is
  'Where the page was sent (00284, 00294, 00295, 00372): the brand''s webhook, its Webflow collection, its WordPress site, its Framer collection or its Wix site''s Blog (00283).';
comment on column public.content_draft_deliveries.target_collection is
  'The Webflow or Framer collection (00284, 00295), the WordPress site''s address (00294) or the Wix site''s id (00372) the page''s item or post was written to; its id is external_id.';

-- ----------------------------------------------------------------------------
-- As 00295, with Wix among the CMSs a page isn't sent to twice at once.
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
  if p_target in ('webflow', 'wordpress', 'framer', 'wix') and exists (
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
