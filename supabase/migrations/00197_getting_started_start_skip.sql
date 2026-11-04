-- ============================================================================
-- 00197: start and skip Getting started (New GetCito, AC-ALT2 §5)
-- ============================================================================
-- 00196 starts Getting started for every new brand. This lets a person start
-- and skip it from the Actions page, and asks first for a brand added to an
-- organization that already has one:
--
--   * getting_started.confirmed_at: when someone chose to run it. The first
--     brand of an organization (onboarding) runs it at once; a later brand
--     asks "Run Getting started for [brand]?" until someone answers, so its
--     row starts with confirmed_at null. dismissed_at stays "skipped", and
--     starting again clears it.
--   * admins and managers start and skip it (insert and update policies, as
--     for kpi_definitions); members keep reading it.
--   * getting_started_facts also returns confirmed_at and content_recent,
--     the content of the last 30 days, for the existing-customer rule: fewer
--     than 3 competitors or topics, no Search Console, or no content in 30
--     days offers "Start getting started".

alter table public.getting_started
  add column if not exists confirmed_at timestamptz;

comment on column public.getting_started.confirmed_at is
  'When someone chose to run Getting started for the brand; null while a later brand of the organization still asks.';

-- Rows from before this migration ran it at once.
update public.getting_started
   set confirmed_at = started_at
 where confirmed_at is null;

create or replace function public.start_brand_getting_started()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.getting_started (brand_id, confirmed_at)
  values (
    new.id,
    -- The organization's first brand runs it; a later one asks first.
    case
      when exists (
        select 1 from public.brands b
        where b.organization_id = new.organization_id and b.id <> new.id
      ) then null
      else now()
    end
  )
  on conflict (brand_id) do nothing;
  return new;
end;
$$;

revoke all on function public.start_brand_getting_started() from public, anon, authenticated;

create policy "getting_started: admin/manager insert"
  on public.getting_started
  for insert
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

create policy "getting_started: admin/manager update"
  on public.getting_started
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

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
    'confirmed_at', gs.confirmed_at,
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
    -- Content in the last 30 days, the same way: for the existing-customer
    -- rule (no content in 30 days → offer Getting started).
    'content_recent', (
      select count(*) from public.content_opportunities o
      where o.brand_id = p_brand_id
        and (
          o.webhook_sent_at >= now() - interval '30 days'
          or (o.status = 'done' and o.updated_at >= now() - interval '30 days')
        )
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

notify pgrst, 'reload schema';
