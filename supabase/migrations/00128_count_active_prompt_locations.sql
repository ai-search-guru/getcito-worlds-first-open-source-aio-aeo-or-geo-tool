-- Only active prompts count toward the plan's prompt-location limit.
--
-- The tracking worker only runs active prompts, so a paused prompt costs
-- nothing; counting it made users pay plan room for prompts that don't run.
-- Paused prompts now free their locations. The other side of that rule lives
-- in the app: resuming a paused prompt counts as adding its locations, so it
-- needs free room like any new prompt (frontend/src/lib/promptLocations.ts),
-- which closes the "pause, add new ones, resume the old ones" way past the
-- limit.
--
-- Same shape as 00070, plus `p.is_active`: one row per brand, a prompt's
-- locations are `greatest(coalesce(array_length(regions,1),0),1)`, mirrored
-- by promptLocationCount in frontend/src/lib/promptLocations.ts.
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
    and p.is_active
  group by b.id;
$$;

revoke all on function public.org_prompt_location_usage(uuid) from public;
grant execute on function public.org_prompt_location_usage(uuid) to authenticated, service_role;

comment on function public.org_prompt_location_usage(uuid) is
  'Active prompt locations per brand for one org (#691, 00128) — the plan-quota unit, one per region entry per active prompt, minimum one; paused prompts don''t count. Security invoker: RLS scopes it to the caller''s org.';
