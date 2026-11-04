-- ============================================================================
-- 00163: ready-made KPIs on a brand's first visit (Action Center)
-- ============================================================================
-- A brand with no KPIs used to open on an empty KPI tab. It now opens with a
-- ready-made set (Visibility, Mentions, Citations, Share of Voice, Positive
-- Sentiment, and AI Referral Traffic when Google Analytics is mapped), each
-- aiming 20% above its last 30 days. The web computes the targets; this adds
-- what it can't do safely on its own:
--
--   * brands.kpi_setup_at: when the brand first had a KPI, from the presets
--     or set by hand. The presets are offered only before it, so a person who
--     removes every KPI doesn't get them back on their next visit. Set by a
--     trigger on kpi_definitions, and filled here for the brands that already
--     have KPIs;
--   * seed_kpi_presets: adds the set once, for an admin or manager of the
--     brand's organization (as kpi_definitions' write policies), with the
--     brand row locked so two people opening the tab at once add it once.

alter table public.brands
  add column if not exists kpi_setup_at timestamptz;

comment on column public.brands.kpi_setup_at is
  'When the brand first had a KPI (ready-made or set by hand); the ready-made set is offered only before it.';

update public.brands b
   set kpi_setup_at = d.first_at
  from (
    select brand_id, min(created_at) as first_at
    from public.kpi_definitions
    group by brand_id
  ) d
 where d.brand_id = b.id
   and b.kpi_setup_at is null;

-- The first KPI a brand gets, by any path, marks it set up.
create or replace function public.mark_brand_kpi_setup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.brands
     set kpi_setup_at = now()
   where id = new.brand_id
     and kpi_setup_at is null;
  return new;
end;
$$;

drop trigger if exists trg_kpi_definitions_mark_setup on public.kpi_definitions;
create trigger trg_kpi_definitions_mark_setup
  after insert on public.kpi_definitions
  for each row execute function public.mark_brand_kpi_setup();

-- Adds the ready-made KPIs, p_kpis = [{ "key": "mentions", "target": 129 }, …],
-- monthly. True when it added them; false when the brand was already set up
-- (or isn't there). Raises 42501 for a caller who isn't an admin or manager
-- of the brand's organization.
create or replace function public.seed_kpi_presets(p_brand_id uuid, p_kpis jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_setup   timestamptz;
begin
  select b.organization_id, b.kpi_setup_at
    into v_org, v_setup
  from public.brands b
  where b.id = p_brand_id
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = v_org
      and p.role = any (array['admin', 'manager']::public.user_role[])
  ) then
    raise exception 'Only admins and managers can set up KPIs' using errcode = '42501';
  end if;

  if v_setup is not null
     or exists (select 1 from public.kpi_definitions d where d.brand_id = p_brand_id) then
    return false;
  end if;

  insert into public.kpi_definitions (brand_id, kpi_key, target, timeframe, is_active)
  select p_brand_id, k.value->>'key', (k.value->>'target')::numeric, 'monthly', true
  from jsonb_array_elements(coalesce(p_kpis, '[]'::jsonb)) k
  where coalesce(k.value->>'key', '') <> ''
    and (k.value->>'target')::numeric > 0
  on conflict (brand_id, kpi_key) do nothing;

  return found;
end;
$$;

revoke execute on function public.seed_kpi_presets(uuid, jsonb) from public, anon;
grant execute on function public.seed_kpi_presets(uuid, jsonb) to authenticated;
