-- Site Audit auto-audit (SA-006): 25% of the monthly audit quota audits the
-- Opportunities inbox's top pages by itself, in five runs of 5% on days 1, 7,
-- 14, 21 and 28 of the billing month.
--
-- site_audit_settings: the organization's switch and e-mail choice. No row,
-- or a null auto_audit, is the plan's default: on for a plan with a monthly
-- quota, off for one without (Self-hosted, Enterprise without a contract
-- limit).
--
-- site_audit_brand_settings: a brand's exclude patterns ("/legal/*"), kept
-- out of the inbox and the runs.
--
-- site_audit_auto_runs: one row per organization, billing period and run
-- day. The sweep claims a run by inserting its row, so a second sweep the
-- same day does nothing; the runs still to come keep their share of the
-- quota out of the user's pool.
--
-- source on site_audits and site_audit_usage tells the audits a run started
-- from the ones a user did, for the quota card (auto used / you used).

create table if not exists public.site_audit_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  auto_audit boolean,
  email_after_run boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_audit_brand_settings (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  exclude_patterns text[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_audit_auto_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start timestamptz not null,
  run_day smallint not null check (run_day in (1, 7, 14, 21, 28)),
  -- The run's share of the quota, and the audits it started.
  slots integer not null check (slots >= 0),
  audit_ids uuid[] not null default '{}',
  status text not null default 'running' check (status in ('running', 'completed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, period_start, run_day)
);

alter table public.site_audits
  add column if not exists source text not null default 'user'
  check (source in ('user', 'auto'));

alter table public.site_audit_usage
  add column if not exists source text not null default 'user'
  check (source in ('user', 'auto'));

alter table public.site_audit_settings enable row level security;
alter table public.site_audit_brand_settings enable row level security;
alter table public.site_audit_auto_runs enable row level security;

-- Org members may read; the server writes with the service role.
create policy site_audit_settings_member_select on public.site_audit_settings
  for select using (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
  );

create policy site_audit_brand_settings_member_select on public.site_audit_brand_settings
  for select using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy site_audit_auto_runs_member_select on public.site_audit_auto_runs
  for select using (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
  );

notify pgrst, 'reload schema';
