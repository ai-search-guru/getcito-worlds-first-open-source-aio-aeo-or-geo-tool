-- ============================================================================
-- 00381: people can't write the demo brand's data (demo-guard)
-- ============================================================================
-- The demo brand (00380) is sample data the server writes (backend/src/lib/
-- demo) with the service role. People explore it, but nothing of theirs may
-- change it: the API refuses its writes (402 demo_brand, backend/src/
-- middleware/demoBrand.js) and so does the web app's lock, but members can
-- also write a brand's rows straight through Supabase, under RLS. This
-- refuses those writes in the database.
--
-- refuse_demo_brand_writes() is a BEFORE INSERT/UPDATE/DELETE row trigger:
--   * a role that bypasses RLS (the service role the server and the demo
--     generator use, migrations, the table owner behind a cascade) passes,
--     as in the other server-column guards (00204, 00228). Not, though, a
--     SECURITY DEFINER function a person calls (approve_action_task_review,
--     content_draft_restore, override_mention_sentiment, seed_kpi_presets):
--     it runs as its owner, who bypasses RLS, but the write is the person's.
--     So the session's own role decides (the one PostgREST sets per request:
--     authenticated or anon is a person), unless the write comes from inside
--     another trigger (a cascade, or a trigger of the server's);
--   * otherwise, a row of a demo brand is refused with SQLSTATE 42501 and
--     the message 'demo_brand' (an update is checked on its old and new row,
--     so a row can't be moved into or out of the demo brand either).
-- With no arguments, the row's brand is its own brand_id. A table without a
-- brand_id names the way to it: (column, table) pairs, each table's row found
-- by its id, the last one's brand_id being the brand, e.g. prompt_notes:
-- prompt_id → prompts, prompt_set_id → prompt_sets.
--
-- It is attached to every table people can write under RLS (an insert,
-- update, delete or all policy for a role other than service_role) that
-- belongs to a brand. backend/src/lib/demo/writeGuard.test.js reads the
-- migrations and fails on such a table without it: a new one attaches it in
-- its own migration.
--
-- It reads the brand (and a parent row) as the person, under RLS: a row of a
-- brand they can't see is refused by RLS itself. The brands themselves are
-- guarded by their own policies (00380).

create or replace function public.refuse_demo_brand_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_keys text[] := '{}';
  v_key text;
  v_column text;
  i integer;
begin
  -- A role that bypasses RLS is server-side (service role, migrations), unless
  -- it is the owner of a SECURITY DEFINER function a person called directly.
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user)
    and (
      pg_catalog.pg_trigger_depth() > 1
      or coalesce(pg_catalog.current_setting('role', true), 'none')
        not in ('authenticated', 'anon')
    )
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_nargs = 0 then
    if tg_op <> 'INSERT' then
      v_keys := v_keys || old.brand_id::text;
    end if;
    if tg_op <> 'DELETE' then
      v_keys := v_keys || new.brand_id::text;
    end if;
  else
    if tg_op <> 'INSERT' then
      execute format('select ($1).%I::text', tg_argv[0]) into v_key using old;
      v_keys := v_keys || v_key;
    end if;
    if tg_op <> 'DELETE' then
      execute format('select ($1).%I::text', tg_argv[0]) into v_key using new;
      v_keys := v_keys || v_key;
    end if;
    -- From each table on the way to the next one's id, the last one's brand_id.
    i := 1;
    while i < tg_nargs loop
      v_column := case when i + 1 < tg_nargs then tg_argv[i + 1] else 'brand_id' end;
      execute format(
        'select coalesce(array_agg(distinct t.%I::text), ''{}'') '
          || 'from public.%I t where t.id = any ($1::uuid[])',
        v_column,
        tg_argv[i]
      ) into v_keys using v_keys;
      i := i + 2;
    end loop;
  end if;

  if exists (
    select 1 from public.brands b
    where b.id = any (v_keys::uuid[])
      and b.is_demo
  ) then
    raise exception 'demo_brand'
      using errcode = '42501',
            detail = 'The demo brand holds sample data and can''t be changed.',
            hint = 'Choose a plan to do this for your own brand.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.refuse_demo_brand_writes() is
  'Demo brand (00381): refuses a write to a demo brand''s row (42501, ''demo_brand'') unless the role bypasses RLS (the server, which writes the demo''s sample data) and isn''t a person''s SECURITY DEFINER call. No arguments: the row''s brand_id; else (column, table) pairs leading to the brand.';

-- ─── Tables with a brand_id ────────────────────────────────────────────────

create or replace trigger actions_refuse_demo_brand_writes
  before insert or update or delete on public.actions
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger agent_conversations_refuse_demo_brand_writes
  before insert or update or delete on public.agent_conversations
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger brand_domains_refuse_demo_brand_writes
  before insert or update or delete on public.brand_domains
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger brand_facts_refuse_demo_brand_writes
  before insert or update or delete on public.brand_facts
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger brand_platforms_refuse_demo_brand_writes
  before insert or update or delete on public.brand_platforms
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger catalog_sources_refuse_demo_brand_writes
  before insert or update or delete on public.catalog_sources
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger competitors_refuse_demo_brand_writes
  before insert or update or delete on public.competitors
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger content_author_defaults_refuse_demo_brand_writes
  before insert or update or delete on public.content_author_defaults
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger content_drafts_refuse_demo_brand_writes
  before insert or update or delete on public.content_drafts
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger content_opportunities_refuse_demo_brand_writes
  before insert or update or delete on public.content_opportunities
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger content_plan_marks_refuse_demo_brand_writes
  before insert or update or delete on public.content_plan_marks
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger getting_started_refuse_demo_brand_writes
  before insert or update or delete on public.getting_started
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger getting_started_steps_refuse_demo_brand_writes
  before insert or update or delete on public.getting_started_steps
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger kpi_definitions_refuse_demo_brand_writes
  before insert or update or delete on public.kpi_definitions
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger prompt_sets_refuse_demo_brand_writes
  before insert or update or delete on public.prompt_sets
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger prompt_suggestions_refuse_demo_brand_writes
  before insert or update or delete on public.prompt_suggestions
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger pulse_settings_refuse_demo_brand_writes
  before insert or update or delete on public.pulse_settings
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger reports_refuse_demo_brand_writes
  before insert or update or delete on public.reports
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger sentiment_overrides_refuse_demo_brand_writes
  before insert or update or delete on public.sentiment_overrides
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger signals_refuse_demo_brand_writes
  before insert or update or delete on public.signals
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger site_audits_refuse_demo_brand_writes
  before insert or update or delete on public.site_audits
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger topic_suggestions_refuse_demo_brand_writes
  before insert or update or delete on public.topic_suggestions
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger topics_refuse_demo_brand_writes
  before insert or update or delete on public.topics
  for each row execute function public.refuse_demo_brand_writes();

create or replace trigger webhook_configs_refuse_demo_brand_writes
  before insert or update or delete on public.webhook_configs
  for each row execute function public.refuse_demo_brand_writes();

-- ─── Tables that reach their brand through another row ────────────────────

create or replace trigger action_events_refuse_demo_brand_writes
  before insert or update or delete on public.action_events
  for each row execute function public.refuse_demo_brand_writes('action_id', 'actions');

create or replace trigger action_task_reviews_refuse_demo_brand_writes
  before insert or update or delete on public.action_task_reviews
  for each row execute function public.refuse_demo_brand_writes('action_id', 'actions');

create or replace trigger action_tasks_refuse_demo_brand_writes
  before insert or update or delete on public.action_tasks
  for each row execute function public.refuse_demo_brand_writes('action_id', 'actions');

create or replace trigger agent_messages_refuse_demo_brand_writes
  before insert or update or delete on public.agent_messages
  for each row execute function public.refuse_demo_brand_writes('conversation_id', 'agent_conversations');

create or replace trigger audit_signal_results_refuse_demo_brand_writes
  before insert or update or delete on public.audit_signal_results
  for each row execute function public.refuse_demo_brand_writes('audit_id', 'site_audits');

create or replace trigger content_draft_confirmations_refuse_demo_brand_writes
  before insert or update or delete on public.content_draft_confirmations
  for each row execute function public.refuse_demo_brand_writes('draft_id', 'content_drafts');

create or replace trigger content_draft_inputs_refuse_demo_brand_writes
  before insert or update or delete on public.content_draft_inputs
  for each row execute function public.refuse_demo_brand_writes('draft_id', 'content_drafts');

create or replace trigger content_draft_own_images_refuse_demo_brand_writes
  before insert or update or delete on public.content_draft_own_images
  for each row execute function public.refuse_demo_brand_writes('draft_id', 'content_drafts');

create or replace trigger content_draft_ready_log_refuse_demo_brand_writes
  before insert or update or delete on public.content_draft_ready_log
  for each row execute function public.refuse_demo_brand_writes('draft_id', 'content_drafts');

create or replace trigger content_draft_sources_refuse_demo_brand_writes
  before insert or update or delete on public.content_draft_sources
  for each row execute function public.refuse_demo_brand_writes('draft_id', 'content_drafts');

create or replace trigger prompts_refuse_demo_brand_writes
  before insert or update or delete on public.prompts
  for each row execute function public.refuse_demo_brand_writes('prompt_set_id', 'prompt_sets');

create or replace trigger prompt_notes_refuse_demo_brand_writes
  before insert or update or delete on public.prompt_notes
  for each row execute function public.refuse_demo_brand_writes('prompt_id', 'prompts', 'prompt_set_id', 'prompt_sets');

create or replace trigger prompt_target_urls_refuse_demo_brand_writes
  before insert or update or delete on public.prompt_target_urls
  for each row execute function public.refuse_demo_brand_writes('prompt_id', 'prompts', 'prompt_set_id', 'prompt_sets');
