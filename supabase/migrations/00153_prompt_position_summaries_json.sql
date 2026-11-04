-- The Positions column's sums in one value (#1094 review).
--
-- prompt_position_summaries (00123) returns a row per prompt and platform. The
-- largest brand's 30 days come to 4,254 rows, past PostgREST's max_rows of
-- 1000, so the rest were dropped without an error and most of its prompts
-- read "—". Reading it a page at a time re-ran the whole aggregate per page:
-- 3.1 s for 30 days and 4.5 s for 90 days, five times over.
--
-- This returns the same rows as one jsonb array, which max_rows doesn't cut,
-- so the page gets every row in a single call. As 00147, 00148 and 00152 do,
-- it is plpgsql with force_custom_plan, so every call is planned with its real
-- window, and work_mem; and security definer with the organization check made
-- explicit. The rows and their counting rules are 00123's.
--
-- prompt_position_summaries (00123) stays for a web build deployed before this
-- migration, which falls back to it; drop it once no build calls it.

create or replace function public.prompt_position_summaries_json(
  p_brand_id  uuid,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null,
  p_region    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'prompt_id',       s.prompt_id,
           'platform',        s.platform,
           'runs',            s.runs,
           'mention_answers', s.mention_answers,
           'position_sum',    s.position_sum,
           'position_count',  s.position_count,
           'entity_sum',      s.entity_sum,
           'entity_count',    s.entity_count)), '[]'::jsonb)
  into v_result
  from (
    select pr.prompt_id,
           pr.platform,
           count(*) as runs,
           count(*) filter (where pr.mention_count > 0) as mention_answers,
           coalesce(sum(pr.mention_position) filter (
             where pr.mention_count > 0 and pr.mention_position > 0), 0)::double precision
                                                                as position_sum,
           count(*) filter (
             where pr.mention_count > 0 and pr.mention_position > 0) as position_count,
           coalesce(sum(pr.mentioned_entity_count) filter (
             where pr.mention_count > 0 and pr.mention_position > 0
               and pr.mentioned_entity_count > 0), 0)::double precision as entity_sum,
           count(*) filter (
             where pr.mention_count > 0 and pr.mention_position > 0
               and pr.mentioned_entity_count > 0) as entity_count
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.prompt_id is not null
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from is null or pr.created_at >= p_date_from)
      and (p_date_to   is null or pr.created_at <= p_date_to)
      and (p_region    is null or pr.region = p_region)
    group by pr.prompt_id, pr.platform
  ) s;

  return v_result;
end;
$$;

revoke execute on function public.prompt_position_summaries_json(
  uuid, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.prompt_position_summaries_json(
  uuid, timestamptz, timestamptz, text
) to authenticated, service_role;

comment on function public.prompt_position_summaries_json(uuid, timestamptz, timestamptz, text) is
  'Tracked Prompts Positions column (#1094): prompt_position_summaries (00123) as one jsonb array, so PostgREST''s max_rows does not cut a large brand''s rows; planned with its arguments, security definer. Null when the caller is not a member of the brand''s organization.';
