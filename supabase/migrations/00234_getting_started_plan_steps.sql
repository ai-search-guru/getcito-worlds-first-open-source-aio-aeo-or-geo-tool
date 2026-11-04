-- ============================================================================
-- 00234: Getting started's content steps open the Content Plan (AC-ALT2)
-- ============================================================================
-- The user's request: Getting started's "Create your first content" and
-- "Optimize a page" steps now open two items of the Content Plan (CE-014)
-- in New content's Start, the Plan's top Create row and its top Optimize
-- row, instead of Content Opportunities and Site Audit.
--
-- getting_started_facts (00197) counts what the Content Editor finished
-- too, so those steps complete there:
--   * drafts_created: the brand's "create" drafts made ready or published;
--   * drafts_optimized: its "optimize" drafts made ready or published.
-- Everything else is 00197's: the old ways to complete the steps (content
-- sent to the CMS or done, a page audited) still count, so a step already
-- done stays done.

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
    -- Content Editor drafts (00204) made ready or published, by method: the
    -- create and optimize steps now open the Content Plan's rows (00234).
    'drafts_created', (
      select count(*) from public.content_drafts d
      where d.brand_id = p_brand_id
        and d.method = 'create'
        and d.status in ('ready', 'published')
    ),
    'drafts_optimized', (
      select count(*) from public.content_drafts d
      where d.brand_id = p_brand_id
        and d.method = 'optimize'
        and d.status in ('ready', 'published')
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
