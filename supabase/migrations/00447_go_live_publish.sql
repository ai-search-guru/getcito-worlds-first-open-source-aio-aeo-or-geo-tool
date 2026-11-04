-- ============================================================================
-- 00447: a page an agent publishes on its own, in the impact ledger and its slots
-- ============================================================================
-- AUTONOMOUS-GO-LIVE §6.4, §10.5 (PR 9). Pages now go live from GetCito:
-- a person's Publish in Chat, or an agent an Admin allowed to publish on its
-- own (Webflow, WordPress and Wix; new pages only).
--
--   * ship_cms_publish (00428) takes the run, the agent and the agent run a
--     publish came from, so "What GetCito did for you" and the agent's page
--     can say "Published by {agent} on its own". The 11-argument function
--     is dropped and the 14-argument one made in its place, so PostgREST
--     sees one; the server passes the three (null for a person's own send)
--     and execution_mode `automated` for an agent's.
--   * reserve_agent_go_live (00443): a step of another kind on a page and
--     destination already counted in the last 24 hours (a publish after its
--     CMS draft) gets its own row, so it has its own record and notice, but
--     takes no new slot: the pair is counted once. The same kind again is
--     still the row it had.

drop function if exists public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer);

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
  p_republish_days integer,
  p_run_id uuid,
  p_agent_id uuid,
  p_agent_run_id uuid
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
    url, action_id, source, change_type, shipped_at, shipped_by, execution_mode,
    run_id, agent_id, agent_run_id
  ) values (
    p_organization_id, p_brand_id, 'cms_publish', p_title, p_content_draft_id, p_delivery_id,
    p_url, p_action_id, 'content_editor', 'content', p_shipped_at, p_shipped_by, p_execution_mode,
    p_run_id, p_agent_id, p_agent_run_id
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

revoke all on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer, uuid, uuid, uuid)
  to service_role;

comment on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text, integer, uuid, uuid, uuid) is
  'Impact ledger (00428, 00447): a CMS-confirmed publish as a ship event, under a lock on its draft: the send''s own, else the one it is noted on, else the draft''s cms_publish within p_republish_days (the latest before it, else the nearest after) noted, else a new one, with the run, agent and agent run it came from. Says the id and whether this call wrote it. Service role only.';
create or replace function public.reserve_agent_go_live(
  p_organization_id uuid,
  p_agent_id uuid,
  p_run_id uuid,
  p_agent_run_id uuid,
  p_brand_id uuid,
  p_content_draft_id uuid,
  p_tool_key text,
  p_kind text,
  p_target text,
  p_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_used integer;
  v_counted boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'reserve_agent_go_live: the limit must be 1 to 20';
  end if;

  perform pg_advisory_xact_lock(hashtext('agent_go_live:' || p_agent_id::text));

  -- The same step again (this page, destination and kind): its row, no second slot.
  select e.id
    into v_id
    from public.chat_agent_go_live_events e
   where e.agent_id = p_agent_id
     and e.content_draft_id is not distinct from p_content_draft_id
     and e.target = p_target
     and e.kind = p_kind
     and e.status in ('reserved', 'done', 'taken_down')
     and e.created_at > now() - interval '24 hours'
   order by e.created_at desc
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- A step of another kind on a page and destination counted already: a row of its own, no new slot.
  select exists (
    select 1
      from public.chat_agent_go_live_events e
     where e.agent_id = p_agent_id
       and e.content_draft_id is not distinct from p_content_draft_id
       and e.target = p_target
       and e.status in ('reserved', 'done', 'taken_down')
       and e.created_at > now() - interval '24 hours'
  ) into v_counted;

  if not v_counted then
    select count(*)
      into v_used
      from (
        select distinct e.content_draft_id, e.target
          from public.chat_agent_go_live_events e
         where e.agent_id = p_agent_id
           and e.status in ('reserved', 'done', 'taken_down')
           and e.created_at > now() - interval '24 hours'
      ) counted;
    if v_used >= p_limit then
      return null;
    end if;
  end if;

  insert into public.chat_agent_go_live_events (
    organization_id, agent_id, run_id, agent_run_id, brand_id,
    content_draft_id, tool_key, kind, target
  )
  values (
    p_organization_id, p_agent_id, p_run_id, p_agent_run_id, p_brand_id,
    p_content_draft_id, p_tool_key, p_kind, p_target
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.reserve_agent_go_live(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_agent_go_live(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer)
  to service_role;

notify pgrst, 'reload schema';
