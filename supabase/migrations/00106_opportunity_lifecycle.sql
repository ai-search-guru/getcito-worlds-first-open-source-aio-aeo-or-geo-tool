-- An opportunity's status follows the Action Center work sent from it (#857,
-- Phase 4).
--
-- The lifecycle is New → Reviewed → Sent → In Progress → Done. Reviewed is
-- set by a person on the opportunity. The rest follow the actions sent from
-- it (#943), whatever changes them — the Action Center, MCP or anything
-- later — so this is a trigger rather than code in each of those paths:
--
--   every action dismissed           → reviewed (the work was called off)
--   every live action completed      → done
--   any action started or completed  → in_progress
--   otherwise (all still new)        → sent
--
-- Only an opportunity somewhere on that path is moved. One a person has
-- dismissed or that was archived stays where it is.

create or replace function public.sync_opportunity_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opp uuid := nullif(new.payload->>'opportunityId', '')::uuid;
  next_status text;
begin
  if opp is null then
    return new;
  end if;

  select case
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
     and a.payload->>'opportunityId' = opp::text;

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

create trigger actions_sync_opportunity_status
  after insert or update of status on public.actions
  for each row
  when (new.kind = 'content_opportunity')
  execute function public.sync_opportunity_status();

-- Bring opportunities already sent into line.
update public.actions set status = status where kind = 'content_opportunity';
