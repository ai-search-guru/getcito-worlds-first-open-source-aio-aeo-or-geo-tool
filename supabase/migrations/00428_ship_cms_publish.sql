-- ============================================================================
-- 00428: a CMS publish into the impact ledger, one draft at a time
-- ============================================================================
-- A page the CMS confirmed live (Send to CMS #1331) is a ship event, once
-- per send (00425), and the same draft live again within 90 days
-- (p_republish_days, the server's REPUBLISH_DAYS) of its first
-- cms_publish is that one, noted (republished_at), not a second. The
-- server decided this in separate reads and writes, so two sends of one
-- draft confirmed at the same moment could each miss the other and write
-- two ship events, which then make each other Not measurable
-- (overlapping_change).
--
--   * ship_cms_publish: the decision and its write in one transaction,
--     under a lock on the draft: the send's own ship event if it has one;
--     else the one it is noted on (republished_delivery_ids); else the
--     draft's latest cms_publish shipped within p_republish_days before
--     it, noted (republished_at only ever forward) with the send; else the
--     nearest one shipped within p_republish_days after it (a send whose own write
--     failed, filled in by the nightly job after a later send of the draft
--     wrote its ship event: a second ship event would make both Not
--     measurable, so the later one takes it in); else a new ship event.
--     Only a cms_publish takes a send in: a ship event of another kind on
--     the same draft (Mark as shipped, Chat) is its own.
--     Says the ship event's id and whether this call wrote it. Service role
--     only; the server reads the send and its draft first, and passes
--     the window (REPUBLISH_DAYS in ship.js), so it is set in one place.
--   * republished_delivery_ids: the sends noted on a ship event, so the
--     nightly job doesn't take them for sends whose ship event is missing,
--     and a send noted once is that ship event's even after its draft is
--     deleted (draft ids are set null then, so only these ids still tie
--     the send to it). At most 50; past that a send is noted by its date
--     only. A GIN index looks a send up among them.

alter table public.ship_events
  add column if not exists republished_delivery_ids uuid[] not null default '{}'
    check (cardinality(republished_delivery_ids) <= 50);

-- A send is looked up among them (ship_cms_publish, the nightly job).
create index if not exists ship_events_republished_delivery_ids_idx
  on public.ship_events using gin (republished_delivery_ids);

comment on column public.ship_events.republished_delivery_ids is
  'The CMS sends (content_draft_deliveries) of the same draft noted on this cms_publish as published again within REPUBLISH_DAYS (90), at most 50 (00428).';

create or replace function public.ship_cms_publish(
  p_delivery_id uuid,
  p_organization_id uuid,
  p_brand_id uuid,
  p_content_draft_id uuid,
  p_title text,
  p_url text,
  p_action_id uuid,
  p_shipped_at timestamptz,
  p_shipped_by uuid,
  p_execution_mode text,
  p_republish_days integer
)
returns table (ship_event_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_delivery_id is null or p_shipped_at is null then
    raise exception 'a send and its publish time are needed' using errcode = '22023';
  end if;
  if p_republish_days is null or p_republish_days < 1 then
    raise exception 'a republish window of a day or more is needed' using errcode = '22023';
  end if;
  -- Every send of one draft waits for the one before it.
  if p_content_draft_id is not null then
    perform pg_advisory_xact_lock(hashtext('ship_cms_publish:' || p_content_draft_id::text));
  end if;

  -- The send's own, written before (a confirmation read twice).
  select s.id into v_id
  from public.ship_events s
  where s.content_draft_delivery_id = p_delivery_id;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;
  -- The send noted on a cms_publish before: that one, also once its draft is
  -- deleted (content_draft_id set null), when the lookup below finds nothing.
  select s.id into v_id
  from public.ship_events s
  where s.republished_delivery_ids @> array[p_delivery_id]
  order by s.id
  limit 1;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  -- The same draft live again within the window: its first cms_publish goes on.
  -- The latest shipped before the send first, else the nearest after it.
  if p_content_draft_id is not null then
    select s.id into v_id
    from public.ship_events s
    where s.brand_id = p_brand_id
      and s.content_draft_id = p_content_draft_id
      and s.kind = 'cms_publish'
      and s.shipped_at >= p_shipped_at - make_interval(days => p_republish_days)
      and s.shipped_at <= p_shipped_at + make_interval(days => p_republish_days)
    order by s.shipped_at > p_shipped_at,
      greatest(s.shipped_at - p_shipped_at, p_shipped_at - s.shipped_at),
      s.id desc
    limit 1;
    if v_id is not null then
      update public.ship_events s
      set republished_at = case
            when p_shipped_at > coalesce(s.republished_at, s.shipped_at) then p_shipped_at
            else s.republished_at
          end,
          republished_delivery_ids = case
            when p_delivery_id = any (s.republished_delivery_ids)
              or cardinality(s.republished_delivery_ids) >= 50
              then s.republished_delivery_ids
            else s.republished_delivery_ids || p_delivery_id
          end
      where s.id = v_id;
      return query select v_id, false;
      return;
    end if;
  end if;

  insert into public.ship_events (
    organization_id, brand_id, kind, title, content_draft_id, content_draft_delivery_id,
    url, action_id, source, change_type, shipped_at, shipped_by, execution_mode
  ) values (
    p_organization_id, p_brand_id, 'cms_publish', p_title, p_content_draft_id, p_delivery_id,
    p_url, p_action_id, 'content_editor', 'content', p_shipped_at, p_shipped_by, p_execution_mode
  )
  on conflict (content_draft_delivery_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;
  -- A send without a draft, confirmed twice at once: the other call wrote it.
  select s.id into v_id
  from public.ship_events s
  where s.content_draft_delivery_id = p_delivery_id;
  return query select v_id, false;
end;
$$;

revoke all on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer)
  to service_role;

comment on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer) is
  'Impact ledger (00428): a CMS-confirmed publish as a ship event, under a lock on its draft: the send''s own, else the one it is noted on, else the draft''s cms_publish within p_republish_days (the latest before it, else the nearest after) noted, else a new one. Says the id and whether this call wrote it. Service role only.';

notify pgrst, 'reload schema';
