-- ============================================================================
-- 00284: where a page was sent (Send to CMS #1331, phase 2)
-- ============================================================================
-- Phase 1 sent every page to the brand's webhook (00262). A page now goes to
-- the webhook or to the brand's Webflow collection (00283), so a delivery
-- says which:
--
--   * `target`: 'webhook' (every delivery so far) or 'webflow'.
--   * `target_collection`: the Webflow collection the item was written to.
--     The item's id is the delivery's external_id, as a CMS's own id is for
--     the webhook. A page sent again updates its item while the brand still
--     sends to that collection, and makes a new one after it changes.
--
-- reserve_content_deliveries takes the target, 'webhook' when it's left out:
-- the API before this change calls it with six arguments and still works,
-- so the migration goes first. For Webflow it refuses (delivery_in_progress)
-- pages a send still has queued: two sends of one page at once would both
-- make an item, the second refused on its slug.
--
-- Adding the columns checks content_draft_deliveries' rows once (the check
-- constraints), under its lock: a few hundred rows at most so far.

alter table public.content_draft_deliveries
  add column if not exists target text not null default 'webhook'
    check (target in ('webhook', 'webflow')),
  add column if not exists target_collection text
    check (target_collection is null or char_length(target_collection) between 1 and 100);

comment on column public.content_draft_deliveries.target is
  'Where the page was sent (00284): the brand''s webhook, or its Webflow collection (00283).';
comment on column public.content_draft_deliveries.target_collection is
  'The Webflow collection the page''s item was written to (00284); the item''s id is external_id.';

drop function if exists public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer);

-- ----------------------------------------------------------------------------
-- As 00262, with the target each queued row goes to, and no second Webflow
-- send of a page while one is queued.
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

  -- Under the lock, so two sends of one page can't both pass.
  if p_target = 'webflow' and exists (
    select 1
    from public.content_draft_deliveries d
    join jsonb_array_elements(p_items) as items(item)
      on d.draft_id = (item ->> 'draft_id')::uuid
    where d.organization_id = p_organization_id
      and d.target = 'webflow'
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
