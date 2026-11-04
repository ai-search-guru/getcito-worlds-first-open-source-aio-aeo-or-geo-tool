-- Aggregate the tracked-location quota count in Postgres (#691 part 1).
--
-- The web tier first computed it by selecting every prompt row's `regions`
-- and summing in JavaScript. PostgREST silently caps an un-paginated select
-- at 1000 rows (the #427/#450/#464 trap), and the failure direction is the
-- bad one: a truncated sum UNDER-counts, so the quota guard would let an org
-- past its plan limit without an error anywhere. The largest org holds 552
-- prompt rows today, but part 2 of #691 multiplies rows into locations, so
-- the ceiling was already in reach. Aggregating here means no rows travel at
-- all — and the bulk-add path, which runs one guard check per prompt in
-- parallel, stops downloading the org's whole roster N times over.
--
-- One row per brand rather than a single org total: savePromptSet replaces a
-- brand's whole set, so its cap check and the wizards' capacity endpoint
-- need "the org minus this brand", which the caller derives from these rows.
--
-- A prompt's location count is `greatest(coalesce(array_length(regions,1),0),1)`
-- — one per region entry, minimum one, because the tracking worker runs a
-- prompt with no regions once (`regions or [null]`). This mirrors
-- `promptLocationCount` in frontend/src/lib/promptLocations.ts exactly; the two
-- definitions must not drift.
--
-- SECURITY INVOKER on purpose, unlike the citation RPCs (#780): prompts,
-- prompt_sets and brands all carry org-membership select policies, so RLS
-- already scopes the aggregation to the caller's own org — a foreign
-- organization id simply aggregates zero visible rows.
create or replace function public.org_prompt_location_usage(p_organization_id uuid)
returns table (brand_id uuid, locations bigint)
language sql
stable
set search_path to 'public'
as $$
  select b.id, sum(greatest(coalesce(array_length(p.regions, 1), 0), 1))::bigint
  from public.prompts p
  join public.prompt_sets ps on ps.id = p.prompt_set_id
  join public.brands b on b.id = ps.brand_id
  where b.organization_id = p_organization_id
  group by b.id;
$$;

revoke all on function public.org_prompt_location_usage(uuid) from public;
grant execute on function public.org_prompt_location_usage(uuid) to authenticated, service_role;

comment on function public.org_prompt_location_usage(uuid) is
  'Tracked prompt locations per brand for one org (#691) — the plan-quota unit, one per region entry per prompt, minimum one. Security invoker: RLS scopes it to the caller''s org.';
