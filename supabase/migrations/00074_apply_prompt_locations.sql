-- Apply a bulk retargeting of prompt locations in one statement (#691).
--
-- Retargeting a selection is the one prompt edit that meters against the plan:
-- adding a location to forty prompts costs forty locations. Looping the
-- single-prompt action over the selection would read, check and write once per
-- prompt, and the failure mode is the bad one — the twenty-first write hits the
-- cap and the operation stops half-applied, with no way back and a bill for
-- what did land. One statement makes the batch all-or-nothing.
--
-- The caller passes the finished per-prompt result rather than the operation to
-- perform. Add/remove semantics, the "never leave a prompt with zero locations"
-- rule and the quota arithmetic all live in `planBulkLocationChange`
-- (frontend/src/lib/promptLocations.ts), which the dialog also runs to price the
-- change before the click. Re-implementing that here would give the preview and
-- the write two definitions that can drift; this function only stores what it
-- is given.
--
-- SECURITY INVOKER, like org_prompt_location_usage (00070): `prompts` carries
-- an admin/manager update policy through its prompt set's brand, so RLS decides
-- which ids a caller may touch. Ids outside the caller's organization simply
-- match no row, and the returned count reflects that.
--
-- The plan cap itself stays in the app tier, because the limit lives in the
-- plan config rather than the database (`maxPrompts`, with enterprise
-- overrides). A concurrent write between the check and this call could still
-- carry an org a few locations past its cap — the same window the single-prompt
-- path has always had, and bounded by what one batch can add.
create or replace function public.apply_prompt_locations(p_updates jsonb)
returns bigint
language sql
volatile
security invoker
set search_path to 'public'
as $$
  with wanted as (
    select (e ->> 'id')::uuid as id,
           array(select jsonb_array_elements_text(e -> 'regions')) as regions
    from jsonb_array_elements(p_updates) e
  ),
  applied as (
    update public.prompts p
    set regions = w.regions
    from wanted w
    -- The empty guard is defence in depth: a prompt with no location is not
    -- tracked at all, and the planner already refuses to produce one.
    where p.id = w.id
      and coalesce(array_length(w.regions, 1), 0) > 0
    returning 1
  )
  select count(*)::bigint from applied;
$$;

revoke all on function public.apply_prompt_locations(jsonb) from public;
grant execute on function public.apply_prompt_locations(jsonb) to authenticated, service_role;

comment on function public.apply_prompt_locations(jsonb) is
  'Bulk-writes prompt tracking locations from [{id, regions}] (#691), one statement so a batch cannot land half-applied. Security invoker: RLS decides which prompts the caller may retarget.';
