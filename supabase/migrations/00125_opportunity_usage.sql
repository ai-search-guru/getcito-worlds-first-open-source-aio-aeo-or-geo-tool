-- Monthly content opportunity quota (CONTENT-001).
--
-- One row per opportunity created, counted per organization per billing
-- period against plan.limits.maxOpportunitiesPerMonth (Starter 10, Growth 50,
-- Enterprise via organizations.plan_overrides). Separate from brief_usage:
-- creating an opportunity and generating its brief are two counters.
--
-- A row outlives its opportunity (ON DELETE SET NULL), so deleting or
-- dismissing an opportunity never hands its slot back. Self-hosted instances
-- bypass the quota entirely (IS_CLOUD !== "true").

create table if not exists public.opportunity_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid references public.content_opportunities(id) on delete set null,
  used_at timestamptz not null default now(),
  created_at timestamptz default now()
);

create index if not exists idx_opportunity_usage_org_period
  on public.opportunity_usage (organization_id, used_at);

-- RLS enabled with no policies: only the service role (aeo-server) reads and
-- writes usage rows, the same posture as brief_usage.
alter table public.opportunity_usage enable row level security;

grant all on table public.opportunity_usage to service_role;

-- Claims up to p_count slots in one transaction, under a per-organization
-- lock, so two generations running at once (several brands of one org, or a
-- double click) can never take the organization past its limit. Returns the
-- claimed usage row ids; the caller links each to the opportunity it creates
-- and deletes the ones it ends up not using, which hands those slots back.
create or replace function public.claim_opportunity_usage(
  p_organization_id uuid,
  p_since timestamptz,
  p_limit integer,
  p_count integer
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_take integer;
begin
  perform pg_advisory_xact_lock(hashtext('opportunity_usage:' || p_organization_id::text));

  select count(*) into v_used
  from public.opportunity_usage
  where organization_id = p_organization_id
    and used_at >= p_since;

  v_take := greatest(0, least(p_count, p_limit - v_used));

  return query
    insert into public.opportunity_usage (organization_id)
    select p_organization_id from generate_series(1, v_take)
    returning id;
end;
$$;

revoke all on function public.claim_opportunity_usage(uuid, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_opportunity_usage(uuid, timestamptz, integer, integer)
  to service_role;

comment on function public.claim_opportunity_usage(uuid, timestamptz, integer, integer) is
  'Atomically claims up to p_count monthly opportunity slots for an organization (CONTENT-001). Returns the claimed opportunity_usage ids.';
