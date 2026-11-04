-- Relevance of a prompt suggestion to the brand (VIS-011).
--
-- The Insights Opportunities card ranks suggestions by relevance × demand ×
-- gap and hides any under a fixed 0.6 (Visibility spec v2). The refresh's
-- model already writes each suggestion; relevance is one more field of that
-- same answer, stored 0–1. Rows generated before this, or once the month's
-- allowance below is spent, stay null, and the card doesn't list a suggestion
-- it can't place against the threshold.
alter table public.prompt_suggestions
  add column if not exists relevance real
    constraint prompt_suggestions_relevance_check
      check (relevance is null or (relevance >= 0 and relevance <= 1));

-- Monthly relevance allowance: one row per refresh that rated relevance,
-- charged an upper estimate of what rating added to it (a full list, for
-- every attempt), summed per organization over the subscription period
-- against plan.limits.relevanceMonthlyBudgetUsd, 0.1% of the plan price
-- (Starter $0.049, Growth $0.249, Enterprise $0.499 or 0.1% of
-- plan_overrides.contractMonthlyUsd). A refresh rates only once its worst
-- case is reserved below, so the month never passes it. Separate from the
-- Improve budget (prompt_improve_usage, 00120). The call's own token counts
-- are kept to check the estimate against. Self-hosted isn't limited and
-- records nothing.

create table if not exists public.suggestion_relevance_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  model text,
  attempts integer not null default 1,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6) not null default 0,
  used_at timestamptz not null default now()
);

create index if not exists suggestion_relevance_usage_org_used_idx
  on public.suggestion_relevance_usage (organization_id, used_at);

-- Service-role only, no policy (as prompt_improve_usage).
alter table public.suggestion_relevance_usage enable row level security;

grant all on table public.suggestion_relevance_usage to service_role;

-- Reserves a refresh's worst case (p_cost) in one transaction, under a
-- per-organization lock, so two refreshes running at once (several brands of
-- one org, or a double click) can never take the organization past
-- p_budget. Returns the usage row id, or null when what's left can't cover
-- it; the caller then refreshes without rating, and once the model answers
-- lowers the row to what the attempts it made cost.
create or replace function public.reserve_suggestion_relevance(
  p_organization_id uuid,
  p_brand_id uuid,
  p_model text,
  p_since timestamptz,
  p_budget numeric,
  p_cost numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('suggestion_relevance:' || p_organization_id::text));

  select coalesce(sum(cost_usd), 0) into v_spent
  from public.suggestion_relevance_usage
  where organization_id = p_organization_id
    and used_at >= p_since;

  if v_spent + p_cost > p_budget then
    return null;
  end if;

  insert into public.suggestion_relevance_usage (organization_id, brand_id, model, cost_usd)
  values (p_organization_id, p_brand_id, p_model, p_cost)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.reserve_suggestion_relevance(uuid, uuid, text, timestamptz, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_suggestion_relevance(uuid, uuid, text, timestamptz, numeric, numeric)
  to service_role;

comment on function public.reserve_suggestion_relevance(uuid, uuid, text, timestamptz, numeric, numeric) is
  'Atomically reserves a suggestion refresh''s worst-case relevance cost against the organization''s monthly allowance (VIS-011). Returns the suggestion_relevance_usage id, or null when it does not fit.';
