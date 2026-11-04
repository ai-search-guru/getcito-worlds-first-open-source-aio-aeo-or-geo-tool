-- ============================================================================
-- 00230: New content's prompts, marked where the brand already shows (CE-003)
-- ============================================================================
-- New content › Create from scratch › Prompt starts a page for a tracked
-- prompt. A prompt the brand is already named in or cited for needs no new
-- page, so Start lists the others; the editor's "Add source" still offers
-- every prompt.
--
--   * content_start_prompts(brand, days): the brand's active prompts, each
--     marked seen when an answer in the last p_days UTC days (today included)
--     named the brand or cited one of its pages, from the prompt-grain
--     Insights rollup (insights_prompt_daily, its (brand_id, day) index).
--     Those not seen come first, each group by text, up to p_limit; seen
--     counts every seen prompt, past the limit too, for Start's note.
--   * As the content reads (00226) are: plpgsql planned for its own values
--     (plan_cache_mode), security definer with the organization check made
--     explicit, null to a caller outside the brand's organization.

create or replace function public.content_start_prompts(
  p_brand_id uuid,
  p_days     integer default 30,
  p_limit    integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  with seen as (
    select distinct d.prompt_id
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and d.day > current_date - v_days
      and (d.has_mention or d.has_citation)
  ),
  active as (
    select p.id, p.text, (s.prompt_id is not null) as seen
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    left join seen s on s.prompt_id = p.id
    where ps.brand_id = p_brand_id
      and p.is_active
  ),
  listed as (
    select a.id, a.text, a.seen
    from active a
    order by a.seen, a.text
    limit v_limit
  )
  select jsonb_build_object(
           'prompts', coalesce(
             (select jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text, 'seen', l.seen)
                               order by l.seen, l.text)
              from listed l),
             '[]'::jsonb),
           'seen', (select count(*) from active a where a.seen))
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.content_start_prompts(uuid, integer, integer) from public, anon;
grant execute on function public.content_start_prompts(uuid, integer, integer) to authenticated, service_role;

comment on function public.content_start_prompts(uuid, integer, integer) is
  'Content Editor New content (CE-003): the brand''s active prompts, each marked seen when an answer in the last p_days UTC days named the brand or cited its pages (insights_prompt_daily); not seen first, by text, up to p_limit, with the count of seen ones. Security definer, planned with its arguments; null when the caller is not a member of the brand''s organization.';
