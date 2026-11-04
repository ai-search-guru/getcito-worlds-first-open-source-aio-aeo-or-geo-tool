-- A re-opened opportunity's status follows only the work sent after it
-- re-opened (#857, Phase 4).
--
-- A finished opportunity whose signals move goes back to New and records
-- when in source_data.reopened.at. Its earlier actions are complete; counted
-- with a new one, they would show the new work as In Progress the moment it
-- was sent. sync_opportunity_status (00106) now ignores actions created
-- before that moment.

create or replace function public.sync_opportunity_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opp uuid := nullif(new.payload->>'opportunityId', '')::uuid;
  since timestamptz;
  next_status text;
begin
  if opp is null then
    return new;
  end if;

  select nullif(source_data->'reopened'->>'at', '')::timestamptz
    into since
    from content_opportunities
   where id = opp;

  select case
           when count(*) = 0 then null
           when count(*) filter (where a.status <> 'dismissed') = 0 then 'reviewed'
           when count(*) filter (where a.status not in ('completed', 'dismissed')) = 0 then 'done'
           when count(*) filter (where a.status in ('in_progress', 'on_hold', 'completed')) > 0
             then 'in_progress'
           else 'sent'
         end
    into next_status
    from actions a
   where a.kind = 'content_opportunity'
     and a.brand_id = new.brand_id
     and a.payload->>'opportunityId' = opp::text
     and (since is null or a.created_at >= since);

  -- Only earlier work changed: the re-opened opportunity stays as it is.
  if next_status is null then
    return new;
  end if;

  update content_opportunities
     set status = next_status, updated_at = now()
   where id = opp
     and brand_id = new.brand_id
     and status in ('new', 'reviewed', 'sent', 'in_progress', 'done')
     and status <> next_status;

  return new;
end;
$$;

revoke all on function public.sync_opportunity_status() from public, anon, authenticated;
