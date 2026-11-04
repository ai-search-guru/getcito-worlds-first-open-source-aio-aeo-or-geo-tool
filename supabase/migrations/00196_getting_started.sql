-- ============================================================================
-- 00196: Getting started, per brand (New GetCito, AC-ALT2 §4)
-- ============================================================================
-- Getting started is a fixed set of 17 steps in the Actions page. It walks a
-- brand through setup (KPIs, competitors, topics, prompts, Search Console,
-- Analytics, the AI Traffic snippet), a first look at the analytics pages and
-- its first content. It sits beside the Action Center's generated actions
-- and never touches them: no signal, no Priority Score, no row in actions.
--
-- Most steps are done when the brand's own data says so (3 competitors, a
-- first AI visit, a finished audit…), so only what the data can't tell is
-- stored here:
--
--   * getting_started: one row per brand that runs it. Every brand created
--     from now on gets one (trigger below). An existing brand has none until
--     someone starts it from the Actions page. dismissed_at: skipped.
--   * getting_started_steps: what a person did that leaves no other trace.
--     They opened one of the analytics pages after the first answers came in
--     (the explore steps), skipped an optional step, or saved the KPIs from
--     the KPI screen. The ready-made KPIs (00163) appear on a visit, so they
--     don't count as set.
--
-- getting_started_facts reads everything the step list needs in one call;
-- the web turns it into the 17 steps (frontend/src/lib/getting-started/steps.ts).

create table if not exists public.getting_started (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  started_at timestamptz not null default now(),
  dismissed_at timestamptz
);

comment on table public.getting_started is
  'Getting started (AC-ALT2): brands that run the setup steps in the Actions page. dismissed_at = skipped.';

create table if not exists public.getting_started_steps (
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- A step key from the web's list. Not an enum: a new step must not take a
  -- migration.
  step text not null check (step ~ '^[a-z_]{1,40}$'),
  state text not null check (state in ('opened', 'skipped', 'done')),
  updated_at timestamptz not null default now(),
  primary key (brand_id, step)
);

comment on table public.getting_started_steps is
  'Getting started (AC-ALT2): steps a person finished that the brand''s data can''t show (a page opened, a step skipped, KPIs saved).';

alter table public.getting_started enable row level security;
alter table public.getting_started_steps enable row level security;

create policy "getting_started: member select"
  on public.getting_started
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "getting_started_steps: member select"
  on public.getting_started_steps
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- Any member records a page they opened; skipping a step or marking one
-- done is for admins and managers, who set the steps up (as kpi_definitions'
-- and getting_started's writes).
create policy "getting_started_steps: member insert"
  on public.getting_started_steps
  for insert
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
    and (
      state = 'opened'
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
      )
    )
  );

create policy "getting_started_steps: member update"
  on public.getting_started_steps
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  )
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
    and (
      state = 'opened'
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
      )
    )
  );

-- A new brand runs Getting started. Whoever adds it (onboarding, the brands
-- page, the API), its row is here before anyone opens the Actions page.
create or replace function public.start_brand_getting_started()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.getting_started (brand_id)
  values (new.id)
  on conflict (brand_id) do nothing;
  return new;
end;
$$;

revoke all on function public.start_brand_getting_started() from public, anon, authenticated;

drop trigger if exists trg_brands_start_getting_started on public.brands;
create trigger trg_brands_start_getting_started
  after insert on public.brands
  for each row execute function public.start_brand_getting_started();

-- An explore step is done when its page was opened once the brand's first
-- answers are in: opened before them, the page had nothing to show. True when
-- the step is recorded (now or earlier).
create or replace function public.getting_started_page_opened(p_brand_id uuid, p_step text)
returns boolean
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.prompt_results r where r.brand_id = p_brand_id) then
    insert into public.getting_started_steps (brand_id, step, state)
    values (p_brand_id, p_step, 'opened')
    on conflict (brand_id, step) do nothing;
  end if;
  return exists (
    select 1 from public.getting_started_steps s
    where s.brand_id = p_brand_id and s.step = p_step
  );
end;
$$;

revoke all on function public.getting_started_page_opened(uuid, text) from public, anon;
grant execute on function public.getting_started_page_opened(uuid, text) to authenticated;

-- Everything the step list reads, for one brand. Security invoker: RLS
-- decides the brand, and a brand the caller can't see returns null.
create or replace function public.getting_started_facts(p_brand_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'started_at', gs.started_at,
    'dismissed_at', gs.dismissed_at,
    'steps', coalesce((
      select jsonb_object_agg(s.step, jsonb_build_object('state', s.state, 'at', s.updated_at))
      from public.getting_started_steps s
      where s.brand_id = p_brand_id
    ), '{}'::jsonb),
    'kpi_setup_at', b.kpi_setup_at,
    'competitors', (
      select count(*) from public.competitors c where c.brand_id = p_brand_id
    ),
    -- Active prompts in each active topic, oldest topic first.
    'topic_prompts', coalesce((
      select jsonb_agg(n.prompts order by t.created_at, t.id)
      from public.topics t
      cross join lateral (
        select count(*) as prompts
        from public.prompts p
        join public.prompt_sets ps on ps.id = p.prompt_set_id
        where p.topic_id = t.id
          and p.is_active
          and ps.brand_id = p_brand_id
      ) n
      where t.brand_id = p_brand_id
        and t.is_active
    ), '[]'::jsonb),
    -- Connected for the organization and mapped to a property for the brand,
    -- as Settings › Integrations shows it.
    'gsc', nullif(b.gsc_property, '') is not null and exists (
      select 1 from public.integration_connections ic
      where ic.organization_id = b.organization_id
        and ic.provider = 'google-search-console'
        and ic.status = 'connected'
    ),
    'ga', nullif(b.ga_property_id, '') is not null and exists (
      select 1 from public.integration_connections ic
      where ic.organization_id = b.organization_id
        and ic.provider = 'google-analytics'
        and ic.status = 'connected'
    ),
    'first_answer', exists (
      select 1 from public.prompt_results r where r.brand_id = p_brand_id
    ),
    'first_visit', exists (
      select 1 from public.ai_traffic_logs l where l.brand_id = p_brand_id
    ),
    -- Prompt suggestions built from Search Console and Analytics data.
    'data_suggestions', (
      select count(*) from public.prompt_suggestions s
      where s.brand_id = p_brand_id and s.source in ('gsc', 'ga')
    ),
    'data_tracked', (
      select count(*) from public.prompt_suggestions s
      where s.brand_id = p_brand_id and s.source in ('gsc', 'ga') and s.status = 'added'
    ),
    'content_suggestions', (
      select count(*) from public.content_opportunities o where o.brand_id = p_brand_id
    ),
    -- Picked: reviewed, sent to the Action Center or given a brief (00106).
    'content_picked', (
      select count(*) from public.content_opportunities o
      where o.brand_id = p_brand_id
        and (o.status in ('reviewed', 'sent', 'in_progress', 'done') or o.brief is not null)
    ),
    -- Created: its work was completed, or it went to the CMS webhook. There
    -- is no published state until the Content Editor.
    'content_created', (
      select count(*) from public.content_opportunities o
      where o.brand_id = p_brand_id
        and (o.status = 'done' or o.webhook_sent_at is not null)
    ),
    -- Audits a person ran (not the automatic sweep, 00167) that finished.
    'audits', (
      select count(*) from public.site_audits a
      where a.brand_id = p_brand_id and a.source = 'user' and a.status = 'completed'
    )
  )
  from public.brands b
  left join public.getting_started gs on gs.brand_id = b.id
  where b.id = p_brand_id;
$$;

revoke all on function public.getting_started_facts(uuid) from public, anon;
grant execute on function public.getting_started_facts(uuid) to authenticated;

comment on function public.getting_started_facts(uuid) is
  'Getting started (AC-ALT2): the counts and flags the 17 steps read, for one brand. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
