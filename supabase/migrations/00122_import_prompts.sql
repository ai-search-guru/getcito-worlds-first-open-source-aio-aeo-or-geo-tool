-- Bulk import of prompts from a spreadsheet (PROMPT-005), capped at the plan
-- limit inside the database.
--
-- The single-prompt path checks the cap in the app tier and then inserts,
-- which leaves a window where two writes can both pass the check (00074).
-- One prompt at a time that window costs at most a location or two; a bulk
-- import can add hundreds, and the task requires that two imports running at
-- once still stop at the limit. So this function takes a per-organization
-- advisory lock, counts the org's tracked locations, and inserts the rows in
-- the order given until the next one would not fit. A second import waits for
-- the first to commit and then counts what it added.
--
-- The rows arrive already validated and resolved (topic ids, plan-filtered
-- platforms) by the server action, which runs the same preview the dialog
-- showed (frontend/src/lib/promptImport.ts). This function only stores them and
-- enforces the cap. -1 means unlimited.
--
-- SECURITY INVOKER: `prompts` keeps its admin/manager insert policy through
-- the prompt set's brand, so RLS still decides whether the caller may write.

create or replace function public.import_prompts(
  p_prompt_set_id uuid,
  p_organization_id uuid,
  p_max_locations integer,
  p_rows jsonb
)
returns table (idx integer, id uuid)
language plpgsql
volatile
security invoker
set search_path to 'public'
as $$
declare
  v_used bigint;
  v_row jsonb;
  v_regions text[];
  v_cost integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('import_prompts:' || p_organization_id::text, 0));

  select coalesce(sum(u.locations), 0) into v_used
  from public.org_prompt_location_usage(p_organization_id) u;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_regions := array(select jsonb_array_elements_text(v_row -> 'regions'));
    -- Same unit as org_prompt_location_usage: one per region, minimum one.
    v_cost := greatest(coalesce(array_length(v_regions, 1), 0), 1);
    exit when p_max_locations <> -1 and v_used + v_cost > p_max_locations;

    insert into public.prompts
      (prompt_set_id, text, category, topic_id, platforms, models, regions, is_active)
    values (
      p_prompt_set_id,
      v_row ->> 'text',
      nullif(v_row ->> 'category', ''),
      nullif(v_row ->> 'topic_id', '')::uuid,
      array(select jsonb_array_elements_text(v_row -> 'platforms')),
      array(select jsonb_array_elements_text(v_row -> 'models')),
      v_regions,
      true
    )
    returning prompts.id into v_id;

    v_used := v_used + v_cost;
    idx := (v_row ->> 'idx')::integer;
    id := v_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.import_prompts(uuid, uuid, integer, jsonb) from public;
grant execute on function public.import_prompts(uuid, uuid, integer, jsonb) to authenticated, service_role;

comment on function public.import_prompts(uuid, uuid, integer, jsonb) is
  'Bulk-inserts prompts [{idx, text, category, topic_id, platforms, models, regions}] in order under a per-organization advisory lock, stopping before the org would exceed p_max_locations tracked locations (-1 = unlimited). Returns the (idx, id) of each inserted row. PROMPT-005.';
