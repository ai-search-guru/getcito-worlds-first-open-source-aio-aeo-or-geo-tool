-- A call's share of the workspace's AI budget, held before the call runs.
--
-- The budget (plan.limits.improveMonthlyBudgetUsd: Improve, the Content
-- Editor's AI, the Action Center's task writer) was checked by reading the
-- period's spend, and each call's cost written once the model answered. Calls
-- running at once for one workspace (two tabs, a teammate, an Action Center
-- sweep over several actions) all read the same spend and all ran, so the
-- budget could be passed by as many calls as were in flight.
--
-- reserve_ai_usage takes a per-organization lock, reads the period's spend
-- (reservations included), and, while it is under the budget, writes a row
-- for the call at its estimated cost and returns its id. The server turns
-- that row into the call's real cost once the model answers, or deletes it
-- when nothing was charged. The rule stays the one before: a call runs while
-- the spend is under the budget; only now the calls in flight count too.

create or replace function public.reserve_ai_usage(
  p_organization_id  uuid,
  p_since            timestamptz,
  p_budget           numeric,
  p_cost             numeric,
  p_feature          text,
  p_model            text,
  p_prompt_id        uuid default null,
  p_action_id        uuid default null,
  p_content_draft_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
  v_id    uuid;
begin
  -- One reservation at a time per organization: the next waits and sees this one.
  perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_organization_id::text));

  select coalesce(sum(cost_usd), 0) into v_spent
  from public.prompt_improve_usage
  where organization_id = p_organization_id
    and used_at >= p_since;

  if v_spent >= p_budget then
    return null;
  end if;

  insert into public.prompt_improve_usage (
    organization_id, feature, model, prompt_id, action_id, content_draft_id, cost_usd)
  values (
    p_organization_id, p_feature, p_model, p_prompt_id, p_action_id, p_content_draft_id,
    greatest(p_cost, 0))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.reserve_ai_usage(uuid, timestamptz, numeric, numeric, text, text, uuid, uuid, uuid) is
  'Holds an AI call''s estimated cost on its organization''s budget under a per-organization lock, while the period''s spend since p_since is under p_budget; returns the usage row to settle (reserveAiBudget), or null when the budget is spent.';

revoke all on function public.reserve_ai_usage(uuid, timestamptz, numeric, numeric, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, timestamptz, numeric, numeric, text, text, uuid, uuid, uuid)
  to service_role;
